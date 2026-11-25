/* [dsh-purge-plus] 取自 dsh-purge-safe v2.0.2（Apache-2.0）原样移植；仅加本行来源标注。
 * 上游许可与 NOTICE 见包内 LICENSE-SAFE-APACHE-2.0.txt / NOTICE-SAFE.txt；移植清单见 NOTICE-PLUS.md §8。 */
/**
 * 公告层：CISA KEV（已知在野利用漏洞）本地缓存。
 *
 * 为什么只有这一层：
 *   · 模板层（nuclei-templates）靠刷新拿「有哪些检查」；
 *   · 知识库（poc 表）是本机验证过的「经验」，不承担"最新"；
 *   · 公告层回答的是另一个问题：**这个 CVE 现在有没有人真在打**。
 *
 * 数据源是静态 JSON、无鉴权、约 1.6 万条，一次拉完落盘即可。
 * 失败一律静默（返回 unavailable），绝不阻断任何工具——离线机器照常开工。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { join, dirname } from 'node:path'

const KEV_URLS = [
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json?download=1',
]

/** 缓存多久算过期（小时）。0 或 REDTEAM_KEV=0 关闭公告层。 */
const KEV_TTL_HOURS = 24

function kevEnabled(env = process.env) {
  return String(env.REDTEAM_KEV ?? '') !== '0'
}

/* [dsh-purge-plus] 路径统一（原样移植后唯一改动）。
 *
 * safe 原版把 KEV 存在 `<root>/kb/cve-kev.json`；本包基座 community 的情报层
 * （store-core.js 的 INTEL_SOURCES + intelStatus + intelUpdate）存在
 * `<root>/intel/kev.json`，而且存的是 CISA 原始载荷（`vulnerabilities` 数组），
 * 不是本文件规范化的 `items`。
 *
 * 不统一会出现两个副本：面板说「KEV 已更新」，查询读的却是另一份旧数据 ——
 * 正是 docs/audit/AUDIT-3WAY-2026-11-25.md §4 记的那类「看起来接上了、其实没接」。
 *
 * 所以：读认两条路径 + 认两种形状；写只写本包主路径。
 */
function kevReadPaths(root) {
  return [join(root, 'intel', 'kev.json'), join(root, 'kb', 'cve-kev.json')]
}

/** 写路径固定为本包主路径，避免「有旧文件就写到旧文件」的漂移。 */
function kevPath(root) {
  return kevReadPaths(root)[0]
}

/** 找第一条存在的缓存路径。 */
function kevExistingPath(root) {
  for (const p of kevReadPaths(root)) {
    if (existsSync(p)) return p
  }
  return ''
}

/** 规范化：CISA 原始载荷（vulnerabilities[]）与 safe 规范化后的（items[]）都认。 */
function normalizeKevData(raw) {
  if (!raw || typeof raw !== 'object') return { fetched_at: 0, count: 0, items: [] }
  if (Array.isArray(raw.items)) return raw
  const vulns = Array.isArray(raw.vulnerabilities) ? raw.vulnerabilities : []
  const items = vulns
    .map((v) => ({
      cve: String(v?.cveID ?? '').toUpperCase(),
      vendor: v?.vendorProject ?? '',
      product: v?.product ?? '',
      name: v?.vulnerabilityName ?? '',
      dateAdded: v?.dateAdded ?? '',
      dueDate: v?.dueDate ?? '',
      ransomware: String(v?.knownRansomwareCampaignUse ?? '').toLowerCase() === 'known',
    }))
    .filter((x) => x.cve)
  return {
    fetched_at: Date.parse(raw.dateReleased || '') || 0,
    count: items.length,
    items,
  }
}

/** 进程内缓存：{ root → { mtimeMs, data } }，避免每次检索都读 1.6 万条 JSON。 */
const memo = new Map()

function normalizeCve(text) {
  const m = String(text ?? '').match(/CVE-\d{4}-\d{4,7}/i)
  return m ? m[0].toUpperCase() : ''
}

function fetchJson(url, timeoutMs, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) { reject(new Error('redirect')); return }
    const lib = url.startsWith('http:') ? http : https
    const req = lib.get(url, { headers: { 'User-Agent': 'dsh-purge-safe-redteam' } }, (res) => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume()
        resolve(fetchJson(new URL(res.headers.location, url).href, timeoutMs, hops + 1))
        return
      }
      if (code !== 200) { res.resume(); reject(new Error('HTTP ' + code)); return }
      const chunks = []
      let bytes = 0
      res.on('data', (chunk) => {
        bytes += chunk.length
        /* 单文件不该超过 64MB：异常大说明拿到的是错误页/镜像首页，直接放弃 */
        if (bytes > 64 * 1024 * 1024) { req.destroy(); reject(new Error('too large')); return }
        chunks.push(chunk)
      })
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

/** 把 CISA 原始 JSON 收敛成最小结构（原始字段很长，没必要全留）。 */
function slim(body) {
  const list = Array.isArray(body?.vulnerabilities) ? body.vulnerabilities : []
  const items = []
  for (const row of list) {
    const cve = normalizeCve(row?.cveID)
    if (!cve) continue
    items.push({
      cve,
      vendor: String(row.vendorProject ?? ''),
      product: String(row.product ?? ''),
      name: String(row.vulnerabilityName ?? ''),
      added: String(row.dateAdded ?? ''),
      ransomware: String(row.knownRansomwareCampaignUse ?? '') === 'Known',
    })
  }
  return { fetched_at: Date.now(), count: items.length, items }
}

/**
 * 读缓存。返回 `{ available, fetched_at, age_hours, stale, count, note }`，
 * 命中查询用 `lookupKev()` 另行按需建索引。
 */
export function kevStatus(root) {
  if (!kevEnabled()) return { available: false, enabled: false, note: '公告层已关闭（REDTEAM_KEV=0）' }
  const path = kevExistingPath(root)
  if (!path) return { available: false, enabled: true, count: 0, note: '还没有公告数据（跑一次 redteam_template_refresh action=refresh 或等自动刷新）' }
  try {
    const stat = statSync(path)
    const cached = memo.get(root)
    const data = cached && cached.mtimeMs === stat.mtimeMs ? cached.data : normalizeKevData(JSON.parse(readFileSync(path, 'utf8')))
    if (!cached || cached.mtimeMs !== stat.mtimeMs) memo.set(root, { mtimeMs: stat.mtimeMs, data })
    const ageHours = Math.max(0, (Date.now() - Number(data.fetched_at || 0)) / 3600000)
    return {
      available: true,
      enabled: true,
      count: Number(data.count || (data.items || []).length),
      fetched_at: Number(data.fetched_at || 0),
      age_hours: Math.round(ageHours * 10) / 10,
      stale: ageHours > KEV_TTL_HOURS,
      note: ageHours > KEV_TTL_HOURS ? '公告数据已过期，命中仅供参考' : undefined,
    }
  } catch (error) {
    return { available: false, enabled: true, count: 0, note: '公告数据读不出来：' + String(error?.message ?? error) }
  }
}

/**
 * 按 CVE 编号查「是否已知在野利用」。
 *
 * @param root - 红队数据根（$DSH_HOME/redteam）
 * @param cves - 任意字符串数组，内部会从中筛出 CVE 编号
 * @returns 命中列表；没有数据/关掉开关时返回空数组（调用方不需要区分）
 */
export function lookupKev(root, cves) {
  if (!kevEnabled() || !root) return []
  const wanted = new Set()
  for (const raw of Array.isArray(cves) ? cves : [cves]) {
    for (const hit of String(raw ?? '').match(/CVE-\d{4}-\d{4,7}/gi) || []) wanted.add(hit.toUpperCase())
  }
  if (wanted.size === 0) return []
  const path = kevExistingPath(root)
  if (!path) return []
  try {
    const stat = statSync(path)
    const cached = memo.get(root)
    const data = cached && cached.mtimeMs === stat.mtimeMs ? cached.data : normalizeKevData(JSON.parse(readFileSync(path, 'utf8')))
    if (!cached || cached.mtimeMs !== stat.mtimeMs) memo.set(root, { mtimeMs: stat.mtimeMs, data })
    return (data.items || []).filter((item) => wanted.has(item.cve)).slice(0, 50)
  } catch { return [] }
}

/**
 * 按龄拉取（默认 24h）。`force` 忽略新鲜度。
 * 返回 `{ action: 'refreshed'|'skipped'|'failed', reason?, count? }`，**从不抛错**。
 */
export async function refreshKevIfStale(options = {}) {
  if (!kevEnabled()) return { action: 'skipped', reason: 'disabled' }
  const root = options.root
  if (!root) return { action: 'skipped', reason: 'no-root' }
  if (options.force !== true) {
    const status = kevStatus(root)
    if (status.available && status.stale !== true) {
      return { action: 'skipped', reason: 'fresh', age_hours: status.age_hours }
    }
  }
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 60000
  let lastError = ''
  for (const url of KEV_URLS) {
    try {
      const body = await fetchJson(url, timeoutMs)
      const payload = slim(body)
      if (payload.count === 0) throw new Error('返回里没有漏洞条目')
      /* 写路径是本包主路径（<root>/intel/kev.json），目录要按它建 */
      mkdirSync(dirname(kevPath(root)), { recursive: true })
      writeFileSync(kevPath(root), JSON.stringify(payload), 'utf8')
      memo.delete(root)
      return { action: 'refreshed', count: payload.count }
    } catch (error) {
      lastError = String(error?.message ?? error)
    }
  }
  return { action: 'failed', error: lastError || '公告拉取失败' }
}

/** 测试用：清掉进程内缓存（换文件后不必等 mtime 变化）。 */
export function resetKevMemo() {
  memo.clear()
}
