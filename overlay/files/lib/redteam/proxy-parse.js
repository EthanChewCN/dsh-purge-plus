/* [dsh-purge-plus] 代理配置解析（纯函数，零依赖）。
 *
 * 为什么单独一个模块：safe 2.0.2 的代理池**只有前端**（12 个 op 在服务端全部
 * 返回 `unknown op`，见 docs/audit/AUDIT-3WAY-2026-11-25-R3.md §1），所以没有
 * 上游实现可移植。解析这一段是整块里唯一「错一位就静默导入错节点」的地方，
 * 必须能脱离 store 单测。
 *
 * 支持三种输入（自动判别）：
 *   1. Clash / mihomo 配置的 `proxies:` 段（块式与流式两种写法）；
 *   2. URI 列表：vmess / vless / trojan / ss / socks5 / socks5h / http / https；
 *   3. 上面两种的 base64 包装（机场订阅的常见形态）。
 *
 * 纪律：
 *   · 认不出的条目**逐条**给 warning 并跳过，绝不猜一个能用的值出来；
 *   · 端口必须 1–65535，主机不许带 scheme 或路径；
 *   · 同名节点保留但用 id 区分，不静默覆盖（用户可能真有两条同名）。
 */

/** 需要本地引擎才能用的协议；其余可以直连（改命令行 `--proxy` 参数即可）。 */
const ENGINE_PROTOCOLS = new Set(['vmess', 'vless', 'hysteria', 'hysteria2', 'tuic', 'ssr'])

/** Clash 的 type 值 → 我们用的短协议名。 */
const TYPE_MAP = {
  ss: 'ss',
  shadowsocks: 'ss',
  vmess: 'vmess',
  vless: 'vless',
  trojan: 'trojan',
  socks5: 'socks5',
  socks: 'socks5',
  http: 'http',
  https: 'https',
  hysteria: 'hysteria',
  hysteria2: 'hysteria2',
  hy2: 'hysteria2',
  tuic: 'tuic',
  ssr: 'ssr',
}

const MAX_CANDIDATES = 500

function text(value) {
  return value === undefined || value === null ? '' : String(value)
}

/** 去掉 YAML/URI 里的引号与首尾空白。 */
function unquote(raw) {
  let s = text(raw).trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s.trim()
}

function safeDecodeBase64(raw) {
  const cleaned = text(raw).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length < 4) return null
  try {
    const out = Buffer.from(cleaned, 'base64').toString('utf8')
    /* Buffer 对非法输入不抛，只返回乱码；用可打印比例做一次粗筛。 */
    if (!out) return null
    const printable = out.replace(/[^\x20-\x7e\u4e00-\u9fa5\r\n]/g, '').length
    return printable / out.length >= 0.9 ? out : null
  } catch {
    return null
  }
}

function parsePort(raw) {
  const n = Number(text(raw).trim())
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0
}

/** 主机名 / IP / IPv6 字面量；不许带 scheme、路径、空白。 */
function cleanHost(raw) {
  let h = unquote(raw)
  if (!h) return ''
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (/[\s/\\?#@]/.test(h)) return ''
  if (!/^[A-Za-z0-9._:-]+$/.test(h)) return ''
  return h
}

function candidateOf(fields, warnings, label) {
  const protocol = TYPE_MAP[String(fields.type || fields.protocol || '').toLowerCase()] || ''
  if (!protocol) {
    warnings.push(`${label}：不支持的协议 ${text(fields.type || fields.protocol) || '(空)'}`)
    return null
  }
  const host = cleanHost(fields.server || fields.host || fields.add)
  if (!host) {
    warnings.push(`${label}：主机名不合法（${text(fields.server || fields.host || fields.add) || '(空)'}）`)
    return null
  }
  const port = parsePort(fields.port)
  if (!port) {
    warnings.push(`${label}：端口不合法（${text(fields.port) || '(空)'}）`)
    return null
  }
  const name = unquote(fields.name || fields.ps || fields.remarks || '') || `${protocol} ${host}:${port}`
  return {
    name,
    protocol,
    host,
    port,
    username: unquote(fields.username || fields.uuid || fields.id || fields.user || ''),
    /* `password` 是 Clash 配置里这一项的**真实键名**（不是占位符），别改名。 */
    secret: unquote(fields.password || fields.pass || fields.pwd || fields.secret || ''),
    cipher: unquote(fields.cipher || fields.method || ''),
    kind: ENGINE_PROTOCOLS.has(protocol) ? 'mihomo' : 'direct',
  }
}

/* ── Clash / mihomo ─────────────────────────────────────────────── */

/** 把 `{a: 1, b: "x"}` 这种流式映射拆成对象（只处理一层，值里不许有逗号）。 */
function parseFlowMap(body) {
  const out = {}
  let depth = 0
  let quote = ''
  let cell = ''
  const cells = []
  for (const ch of text(body)) {
    if (quote) {
      if (ch === quote) quote = ''
      cell += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cell += ch; continue }
    if (ch === '{' || ch === '[') depth += 1
    if (ch === '}' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) { cells.push(cell); cell = ''; continue }
    cell += ch
  }
  if (cell.trim()) cells.push(cell)
  for (const raw of cells) {
    const at = raw.indexOf(':')
    if (at < 0) continue
    out[raw.slice(0, at).trim()] = unquote(raw.slice(at + 1))
  }
  return out
}

function parseClashProxies(source, warnings) {
  const lines = source.split(/\r?\n/)
  const candidates = []
  let inProxies = false
  let current = null
  let label = ''

  const flush = () => {
    if (!current) return
    const got = candidateOf(current, warnings, label)
    if (got) candidates.push(got)
    current = null
  }

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const topKey = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (topKey) {
      /* 回到顶层：离开 proxies 段。 */
      if (inProxies && topKey[1] !== 'proxies') { flush(); inProxies = false }
      if (topKey[1] === 'proxies') {
        inProxies = true
        /* 支持 `proxies: [{...}, {...}]` 的整行写法 */
        const rest = topKey[2].trim()
        if (rest.startsWith('[')) {
          const inner = rest.replace(/^\[/, '').replace(/\]\s*$/, '')
          for (const piece of inner.split(/\},\s*\{/)) {
            const body = piece.replace(/^\{/, '').replace(/\}$/, '')
            const got = candidateOf(parseFlowMap(body), warnings, 'proxies[]')
            if (got) candidates.push(got)
          }
          inProxies = false
        }
      }
      continue
    }
    if (!inProxies) continue

    const flow = line.match(/^\s*-\s*\{(.*)\}\s*$/)
    if (flow) {
      flush()
      const got = candidateOf(parseFlowMap(flow[1]), warnings, 'proxies[]')
      if (got) candidates.push(got)
      continue
    }
    const item = line.match(/^\s*-\s*([A-Za-z0-9_-]+):\s*(.*)$/)
    if (item) {
      flush()
      current = {}
      label = `proxies[]`
      current[item[1]] = unquote(item[2])
      label = `proxies[] ${current.name || current.server || ''}`.trim()
      continue
    }
    const kv = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv && current) {
      current[kv[1]] = unquote(kv[2])
      if (kv[1] === 'name') label = `proxies[] ${unquote(kv[2])}`
      continue
    }
    /* 缩进回到 0 且不是列表项：结束 proxies 段。 */
    if (/^\S/.test(line)) { flush(); inProxies = false }
  }
  flush()
  return candidates
}

/* ── URI 列表 ───────────────────────────────────────────────────── */

function splitFragment(uri) {
  const at = uri.indexOf('#')
  if (at < 0) return { body: uri, name: '' }
  return { body: uri.slice(0, at), name: decodeURIComponent(uri.slice(at + 1)) }
}

function parseUriLine(uri, warnings) {
  const { body, name } = splitFragment(uri.trim())
  const scheme = (body.match(/^([a-z0-9+.-]+):\/\//i) || [])[1]
  if (!scheme) return null
  const protocol = TYPE_MAP[scheme.toLowerCase()] || ''
  if (!protocol) { warnings.push(`不支持的协议：${scheme}`); return null }

  if (protocol === 'vmess' || protocol === 'vless') {
    const payload = body.slice(scheme.length + 3)
    /* vmess 是 base64(JSON)；vless 是明文 uuid@host:port?params */
    const decoded = safeDecodeBase64(payload)
    if (decoded && decoded.trim().startsWith('{')) {
      let json = null
      try { json = JSON.parse(decoded) } catch { json = null }
      if (!json) { warnings.push(`vmess 载荷不是合法 JSON：${name || payload.slice(0, 16)}`); return null }
      return candidateOf({
        type: protocol, name: name || json.ps, add: json.add, port: json.port,
        uuid: json.id, cipher: json.scy,
      }, warnings, name || 'vmess')
    }
    const at = payload.indexOf('@')
    if (at < 0) { warnings.push(`${protocol} 载荷无法解析：${name || payload.slice(0, 16)}`); return null }
    const uuid = payload.slice(0, at)
    const hostPort = payload.slice(at + 1).split('?')[0]
    const [host, port] = hostPort.split(':')
    return candidateOf({ type: protocol, name, uuid, host, port }, warnings, name || protocol)
  }

  if (protocol === 'ss') {
    const payload = body.slice(5)
    const at = payload.lastIndexOf('@')
    if (at < 0) {
      /* 旧式：整体 base64(method:pass@host:port) */
      const decoded = safeDecodeBase64(payload)
      if (!decoded) { warnings.push(`ss 载荷无法解析：${name || payload.slice(0, 16)}`); return null }
      const inner = decoded.lastIndexOf('@')
      if (inner < 0) { warnings.push(`ss 载荷缺主机：${name || payload.slice(0, 16)}`); return null }
      const cred = decoded.slice(0, inner)
      const [host, port] = decoded.slice(inner + 1).split(':')
      const [method, ...rest] = cred.split(':')
      return candidateOf({ type: 'ss', name, host, port, cipher: method, secret: rest.join(':') }, warnings, name || 'ss')
    }
    const userinfo = payload.slice(0, at)
    const [host, port] = payload.slice(at + 1).split(':')
    const decoded = safeDecodeBase64(userinfo)
    const cred = decoded || userinfo
    const colon = cred.indexOf(':')
    return candidateOf({
      type: 'ss', name, host, port,
      cipher: colon >= 0 ? cred.slice(0, colon) : cred,
      secret: colon >= 0 ? cred.slice(colon + 1) : '',
    }, warnings, name || 'ss')
  }

  /* trojan / socks5 / http(s)：`scheme://[user[:pass]@]host:port` */
  const rest = body.slice(scheme.length + 3).split('?')[0]
  const at = rest.lastIndexOf('@')
  const userinfo = at >= 0 ? rest.slice(0, at) : ''
  const hostPort = at >= 0 ? rest.slice(at + 1) : rest
  const colon = hostPort.lastIndexOf(':')
  if (colon < 0) { warnings.push(`${protocol} 缺端口：${name || rest}`); return null }
  const host = hostPort.slice(0, colon)
  const port = hostPort.slice(colon + 1)
  let username = ''
  let secret = ''
  if (userinfo) {
    /* **不试 base64**：只有 ss 的 userinfo 按协议是 base64，trojan / socks5 / http 的
       userinfo 就是明文字段。无条件试解码会把「看起来像 base64 的口令」静默换成别的字符串
       —— 例如 trojan://dGVzdHBhc3M@host:443 会被解成 testpass，节点永久连不上，
       而 proxyProfileTest 只探 TCP 端口，照样报 ok:true。 */
    const c = userinfo.indexOf(':')
    username = c >= 0 ? userinfo.slice(0, c) : userinfo
    secret = c >= 0 ? userinfo.slice(c + 1) : ''
  }
  if (protocol === 'trojan') { secret = username; username = '' }
  return candidateOf({ type: protocol, name, host, port, username, secret }, warnings, name || protocol)
}

/* ── 入口 ───────────────────────────────────────────────────────── */

/**
 * 解析一份代理配置文本。
 *
 * @param raw - Clash YAML / URI 列表 / 两者的 base64 包装。
 * @returns `{ ok, format, candidates, warnings }`；`ok:false` 只在「一条都认不出」时为假。
 */
export function parseProxyConfig(raw) {
  const warnings = []
  const source = text(raw)
  if (source.trim() === '') return { ok: false, format: 'empty', candidates: [], warnings: ['配置内容为空'] }

  let body = source
  let format = ''
  let decodedFromSubscription = false

  if (/^\s*proxies\s*:/m.test(body)) {
    format = 'clash'
  } else if (/^[a-z0-9+.-]+:\/\//im.test(body)) {
    format = 'uri-list'
  } else {
    /* 没有明显特征：可能是机场订阅的 base64 整体包装。 */
    const decoded = safeDecodeBase64(body)
    if (!decoded) {
      return { ok: false, format: 'unknown', candidates: [], warnings: ['认不出格式：既不是 Clash 的 proxies 段，也不是 URI 列表或 base64 订阅'] }
    }
    body = decoded
    decodedFromSubscription = true
    format = /^\s*proxies\s*:/m.test(body) ? 'clash' : 'uri-list'
  }

  let candidates = format === 'clash' ? parseClashProxies(body, warnings) : []
  if (format === 'uri-list') {
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue
      const got = parseUriLine(trimmed, warnings)
      if (got) candidates.push(got)
    }
  }

  /* 去重：同一协议+主机+端口+账号只留第一条，但保留同名不同地址的。 */
  const seen = new Set()
  const unique = []
  for (const c of candidates) {
    const key = [c.protocol, c.host, c.port, c.username].join('\u0000')
    if (seen.has(key)) { warnings.push(`重复节点已跳过：${c.name}`); continue }
    seen.add(key)
    unique.push(c)
    if (unique.length >= MAX_CANDIDATES) { warnings.push(`最多导入 ${MAX_CANDIDATES} 个节点，其余已忽略`); break }
  }

  return {
    ok: unique.length > 0,
    format: decodedFromSubscription ? `${format}+base64` : format,
    candidates: unique,
    warnings,
  }
}
