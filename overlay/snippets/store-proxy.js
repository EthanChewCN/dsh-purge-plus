  /* ---------- [dsh-purge-plus] P30 代理池（12 个 op 的子系统） ---------- */
  //
  // 背景：safe 2.0.2 的代理池**只有前端**。它的 12 个 op 在服务端 dispatch 里
  // 一条都不存在，调用只会得到 `unknown op: proxyPoolGet`（见
  // docs/audit/AUDIT-3WAY-2026-11-25-R3.md §1）。所以这一块没有上游实现可移植，
  // 是从零写的；字段名尽量对齐 safe 的前端，将来要接它那套界面不用改协议。
  //
  // 三条纪律：
  //   ① **不假成功**：连不上就是 `ok:false` + 原因，不返回「已连接」；
  //   ② **不改本机网络**：不写系统代理、不起全局 TUN。所谓「连接」= 记下当前
  //      生效的节点 + 探一次延迟，实际走代理由命令行 `--proxy` 参数完成
  //      （与技能文本里「代理只在单条命令上临时用」的口径一致）；
  //   ③ **口令不回传**：接口只给 `passwordSet`，明文只留在本机 pool.json。

  static PROXY_LIMITS = {
    max_profiles: 200,
    max_config_bytes: 1024 * 1024,
    max_log: 200,
    default_timeout_ms: 8000,
    min_timeout_ms: 500,
    max_timeout_ms: 60000,
  }

  #proxyFile() { return join(this.root, 'proxy', 'pool.json') }

  /** 读池子。文件缺失/坏掉都退成空池，绝不抛 —— 一个诊断型面板不该把服务打挂。 */
  #proxyRead() {
    const empty = {
      version: 1,
      profiles: [],
      policy: { enabled: false, autoConnect: false, timeoutMs: RedteamStore.PROXY_LIMITS.default_timeout_ms, enginePath: '' },
      activeId: '',
      log: [],
    }
    try {
      if (!existsSync(this.#proxyFile())) return empty
      const parsed = JSON.parse(readFileSync(this.#proxyFile(), 'utf8'))
      if (!parsed || typeof parsed !== 'object') return empty
      const policy = parsed.policy && typeof parsed.policy === 'object' ? parsed.policy : {}
      const timeout = Number(policy.timeoutMs)
      return {
        version: 1,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles.filter((p) => p && typeof p === 'object' && p.id) : [],
        policy: {
          enabled: policy.enabled === true,
          autoConnect: policy.autoConnect === true,
          timeoutMs: Number.isFinite(timeout) && timeout >= RedteamStore.PROXY_LIMITS.min_timeout_ms && timeout <= RedteamStore.PROXY_LIMITS.max_timeout_ms
            ? Math.round(timeout)
            : RedteamStore.PROXY_LIMITS.default_timeout_ms,
          enginePath: typeof policy.enginePath === 'string' ? policy.enginePath : '',
        },
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
        log: Array.isArray(parsed.log) ? parsed.log.slice(-RedteamStore.PROXY_LIMITS.max_log) : [],
      }
    } catch { return empty }
  }

  #proxyWrite(state) {
    mkdirSync(join(this.root, 'proxy'), { recursive: true })
    /* 原子写：面板与工具可能同时写，半截 JSON 会让整池「消失」。 */
    atomicWriteSync(this.#proxyFile(), JSON.stringify(state, null, 2) + '\n')
    return state
  }

  /** 对外形状：**不含 secret**，只给 passwordSet。 */
  #proxyPublic(profile) {
    return {
      id: String(profile.id || ''),
      name: String(profile.name || ''),
      kind: String(profile.kind || 'direct'),
      protocol: String(profile.protocol || ''),
      host: String(profile.host || ''),
      port: Number(profile.port) || 0,
      username: String(profile.username || ''),
      passwordSet: typeof profile.secret === 'string' && profile.secret !== '',
      cipher: String(profile.cipher || ''),
      enabled: profile.enabled !== false,
      createdAt: Number(profile.createdAt) || 0,
      updatedAt: Number(profile.updatedAt) || 0,
      status: String(profile.status || 'idle'),
      latencyMs: Number.isFinite(profile.latencyMs) ? profile.latencyMs : null,
      lastTestAt: Number(profile.lastTestAt) || 0,
    }
  }

  #proxyLog(state, entry) {
    state.log = (Array.isArray(state.log) ? state.log : []).concat([Object.assign({ at: nowIso() }, entry)])
      .slice(-RedteamStore.PROXY_LIMITS.max_log)
  }

  /** 池子快照（面板首屏 / 工具 status 共用）。 */
  proxyPoolSnapshot() {
    const state = this.#proxyRead()
    const profiles = state.profiles.map((p) => this.#proxyPublic(p))
    const active = profiles.find((p) => p.id === state.activeId) || null
    return {
      profiles,
      total: profiles.length,
      enabled: state.policy.enabled,
      autoConnect: state.policy.autoConnect,
      timeoutMs: state.policy.timeoutMs,
      enginePath: state.policy.enginePath,
      activeId: state.activeId,
      active,
      log: state.log.slice(-20),
      limits: RedteamStore.PROXY_LIMITS,
      /* 明说这一层的边界：本包不起代理引擎，也不改系统代理。 */
      note: '本包只管理节点与连通性，不修改本机网络设置。实际走代理请给单条命令加 --proxy。',
    }
  }

  proxyPoolSavePolicy(settings = {}) {
    const state = this.#proxyRead()
    const timeout = Number(settings.timeoutMs)
    const before = Object.assign({}, state.policy)
    state.policy = {
      enabled: settings.enabled === true,
      autoConnect: settings.autoConnect === true,
      timeoutMs: Number.isFinite(timeout)
        ? Math.min(Math.max(Math.round(timeout), RedteamStore.PROXY_LIMITS.min_timeout_ms), RedteamStore.PROXY_LIMITS.max_timeout_ms)
        : state.policy.timeoutMs,
      enginePath: String(settings.enginePath || '').trim(),
    }
    this.#proxyLog(state, {
      action: 'policy', ok: true,
      changed: Object.keys(state.policy).filter((k) => state.policy[k] !== before[k]),
    })
    this.#proxyWrite(state)
    return { enabled: state.policy.enabled, autoConnect: state.policy.autoConnect, timeoutMs: state.policy.timeoutMs, enginePath: state.policy.enginePath }
  }

  /**
   * 新增或更新一个节点。
   *
   * `secret` 省略时保留旧值（面板编辑时不会把口令回传给前端，所以「没改」和
   * 「清空」必须能区分：传 `secret: ''` 才是清空）。
   */
  proxyProfileSave(input = {}) {
    const state = this.#proxyRead()
    const id = String(input.id || '').trim()
    const existing = id ? state.profiles.find((p) => String(p.id) === id) : null
    if (id && !existing) throw new Error('节点不存在：' + id)

    const host = String(input.host || '').trim().replace(/^\[|\]$/g, '')
    if (!host) throw new Error('主机不能为空')
    if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw new Error('主机名不合法（不要带 scheme、路径或空格）：' + host)
    const port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 的整数')
    const protocol = String(input.protocol || existing && existing.protocol || 'socks5').trim().toLowerCase()
    if (!/^[a-z0-9]+$/.test(protocol)) throw new Error('协议名不合法：' + protocol)

    const name = String(input.name || existing && existing.name || '').trim() || `${protocol} ${host}:${port}`
    const kind = input.kind === 'mihomo' || (input.kind === undefined && existing && existing.kind === 'mihomo') ? 'mihomo' : 'direct'
    const secret = input.secret === undefined
      ? (existing && typeof existing.secret === 'string' ? existing.secret : '')
      : String(input.secret)

    if (!existing && state.profiles.length >= RedteamStore.PROXY_LIMITS.max_profiles) {
      throw new Error(`节点数已达上限 ${RedteamStore.PROXY_LIMITS.max_profiles}，先删掉不用的`)
    }

    const now = Date.now()
    const record = {
      id: existing ? existing.id : 'p-' + createHash('sha256').update(name + '\u0000' + host + '\u0000' + port + '\u0000' + now).digest('hex').slice(0, 10),
      name,
      kind,
      protocol,
      host,
      port,
      username: String(input.username === undefined ? (existing && existing.username) || '' : input.username),
      secret,
      cipher: String(input.cipher === undefined ? (existing && existing.cipher) || '' : input.cipher),
      enabled: input.enabled === undefined ? (existing ? existing.enabled !== false : true) : input.enabled !== false,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      status: existing ? existing.status : 'idle',
      latencyMs: existing && Number.isFinite(existing.latencyMs) ? existing.latencyMs : null,
      lastTestAt: existing ? existing.lastTestAt : 0,
    }
    state.profiles = existing
      ? state.profiles.map((p) => (String(p.id) === record.id ? record : p))
      : state.profiles.concat([record])
    /* 改配置也要留痕：事后要能回答「这个节点什么时候加的、谁改的端口」。 */
    this.#proxyLog(state, { action: existing ? 'update' : 'save', id: record.id, name: record.name, ok: true })
    this.#proxyWrite(state)
    return { savedId: record.id, profiles: state.profiles.map((p) => this.#proxyPublic(p)) }
  }

  proxyProfileDelete(id) {
    const state = this.#proxyRead()
    const key = String(id || '').trim()
    if (!key) throw new Error('proxyProfileDelete 需要 id')
    const before = state.profiles.length
    state.profiles = state.profiles.filter((p) => String(p.id) !== key)
    if (state.profiles.length === before) throw new Error('节点不存在：' + key)
    if (state.activeId === key) state.activeId = ''
    this.#proxyLog(state, { action: 'delete', id: key, ok: true })
    this.#proxyWrite(state)
    return { deleted: 1, profiles: state.profiles.map((p) => this.#proxyPublic(p)) }
  }

  proxyProfilesDelete(ids) {
    const state = this.#proxyRead()
    const wanted = new Set((Array.isArray(ids) ? ids : []).map((v) => String(v)).filter(Boolean))
    if (wanted.size === 0) throw new Error('proxyProfilesDelete 需要 ids 数组')
    const before = state.profiles.length
    state.profiles = state.profiles.filter((p) => !wanted.has(String(p.id)))
    const deleted = before - state.profiles.length
    if (deleted === 0) throw new Error('没有节点被删除：ids 都不存在')
    if (wanted.has(state.activeId)) state.activeId = ''
    this.#proxyLog(state, { action: 'delete-many', count: deleted, ok: true })
    this.#proxyWrite(state)
    return { deleted, profiles: state.profiles.map((p) => this.#proxyPublic(p)) }
  }

  /** 解析配置，不写盘（导入预览）。 */
  proxyConfigParse(raw) {
    const textValue = typeof raw === 'string' ? raw : ''
    const bytes = Buffer.byteLength(textValue, 'utf8')
    if (bytes > RedteamStore.PROXY_LIMITS.max_config_bytes) {
      throw new Error(`配置超过上限 ${RedteamStore.PROXY_LIMITS.max_config_bytes} 字节（实际 ${bytes}）`)
    }
    return parseProxyConfig(textValue)
  }

  proxyPoolImport(raw, options = {}) {
    const parsed = this.proxyConfigParse(raw)
    if (!parsed.ok) return { importedCount: 0, warnings: parsed.warnings, format: parsed.format, profiles: this.#proxyRead().profiles.map((p) => this.#proxyPublic(p)) }
    const state = this.#proxyRead()
    const seen = new Set(state.profiles.map((p) => [p.protocol, p.host, p.port, p.username || ''].join('\u0000')))
    let imported = 0
    const warnings = parsed.warnings.slice()
    for (const candidate of parsed.candidates) {
      const key = [candidate.protocol, candidate.host, candidate.port, candidate.username || ''].join('\u0000')
      if (seen.has(key)) { warnings.push(`已存在，跳过：${candidate.name}`); continue }
      if (state.profiles.length >= RedteamStore.PROXY_LIMITS.max_profiles) { warnings.push(`已达上限 ${RedteamStore.PROXY_LIMITS.max_profiles}，其余未导入`); break }
      const now = Date.now()
      state.profiles.push({
        id: 'p-' + createHash('sha256').update(key + '\u0000' + now + '\u0000' + imported).digest('hex').slice(0, 10),
        name: candidate.name,
        kind: candidate.kind,
        protocol: candidate.protocol,
        host: candidate.host,
        port: candidate.port,
        username: candidate.username || '',
        secret: candidate.secret || '',
        cipher: candidate.cipher || '',
        enabled: true,
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        latencyMs: null,
        lastTestAt: 0,
      })
      seen.add(key)
      imported += 1
    }
    this.#proxyLog(state, { action: 'import', count: imported, format: parsed.format, ok: imported > 0 })
    this.#proxyWrite(state)
    return { importedCount: imported, warnings, format: parsed.format, profiles: state.profiles.map((p) => this.#proxyPublic(p)) }
  }

  /** 一次 TCP 连通性探测（不改网络、不建隧道）。 */
  #proxyProbe(profile, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now()
      let settled = false
      let socket = null
      const finish = (okFlag, error) => {
        if (settled) return
        settled = true
        try { if (socket) socket.destroy() } catch { /* 已关闭 */ }
        resolve({ ok: okFlag, latencyMs: okFlag ? Date.now() - started : null, error: error || '' })
      }
      try {
        socket = tcpConnect({ host: profile.host, port: profile.port })
      } catch (error) {
        finish(false, String((error && error.message) || error))
        return
      }
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false, 'timeout'))
      socket.once('error', (error) => finish(false, String((error && error.code) || (error && error.message) || error)))
    })
  }

  async proxyProfileTest(id, options = {}) {
    const state = this.#proxyRead()
    const key = String(id || '').trim()
    const profile = state.profiles.find((p) => String(p.id) === key)
    if (!profile) throw new Error('节点不存在：' + (key || '(空)'))
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Math.min(Math.max(Math.round(Number(options.timeoutMs)), RedteamStore.PROXY_LIMITS.min_timeout_ms), RedteamStore.PROXY_LIMITS.max_timeout_ms)
      : state.policy.timeoutMs
    const got = await this.#proxyProbe(profile, timeoutMs)
    const target = state.profiles.find((p) => String(p.id) === key)
    target.status = got.ok ? 'ok' : 'failed'
    target.latencyMs = got.latencyMs
    target.lastTestAt = Date.now()
    this.#proxyLog(state, { action: 'test', id: key, ok: got.ok, latency_ms: got.latencyMs, error: got.error })
    this.#proxyWrite(state)
    return { latencyMs: got.latencyMs, ok: got.ok, error: got.error, profiles: state.profiles.map((p) => this.#proxyPublic(p)) }
  }

  async proxyPoolTest(ids, options = {}) {
    const state = this.#proxyRead()
    const wanted = Array.isArray(ids) && ids.length > 0
      ? new Set(ids.map((v) => String(v)))
      : null
    const targets = state.profiles.filter((p) => (wanted ? wanted.has(String(p.id)) : p.enabled !== false))
    if (targets.length === 0) throw new Error('没有可测的节点（池子为空，或选中的都不存在）')
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Math.min(Math.max(Math.round(Number(options.timeoutMs)), RedteamStore.PROXY_LIMITS.min_timeout_ms), RedteamStore.PROXY_LIMITS.max_timeout_ms)
      : state.policy.timeoutMs
    /* 串行探测：并发几十个 TCP 连接会触发本机连接表/对端限速，测出来的延迟没有意义。 */
    const results = []
    for (const profile of targets) {
      const got = await this.#proxyProbe(profile, timeoutMs)
      results.push({ id: profile.id, name: profile.name, ok: got.ok, latencyMs: got.latencyMs, error: got.error })
    }
    const byId = new Map(results.map((r) => [r.id, r]))
    const now = Date.now()
    state.profiles = state.profiles.map((p) => {
      const r = byId.get(String(p.id))
      if (!r) return p
      return Object.assign({}, p, { status: r.ok ? 'ok' : 'failed', latencyMs: r.latencyMs, lastTestAt: now })
    })
    const passed = results.filter((r) => r.ok).length
    const summary = { total: results.length, passed, failed: results.length - passed, cancelled: 0 }
    this.#proxyLog(state, { action: 'test-many', ok: passed > 0, passed, failed: summary.failed })
    this.#proxyWrite(state)
    return {
      ok: passed > 0,
      batchTest: Object.assign({ status: 'finished' }, summary),
      testSummary: summary,
      results,
      profiles: state.profiles.map((p) => this.#proxyPublic(p)),
    }
  }

  /**
   * 让某个节点成为「当前生效节点」。
   *
   * **不建立隧道**：本包不管理代理引擎进程，也不改系统代理。这里做的是
   * 记下 activeId + 探一次延迟，让后续命令知道该给 `--proxy` 传什么。
   * 需要引擎的协议（vmess/vless/…）会明确告诉调用方要自己起引擎。
   */
  async proxyProfileConnect(id, options = {}) {
    const state = this.#proxyRead()
    const key = String(id || '').trim()
    const profile = state.profiles.find((p) => String(p.id) === key)
    if (!profile) throw new Error('节点不存在：' + (key || '(空)'))
    const timeoutMs = Number(options.timeoutMs) > 0 ? Math.round(Number(options.timeoutMs)) : state.policy.timeoutMs
    const got = await this.#proxyProbe(profile, timeoutMs)
    if (!got.ok) {
      profile.status = 'failed'
      profile.latencyMs = null
      profile.lastTestAt = Date.now()
      this.#proxyLog(state, { action: 'connect', id: key, ok: false, error: got.error })
      this.#proxyWrite(state)
      throw new Error(`连不上 ${profile.host}:${profile.port}（${got.error}），没有切换生效节点`)
    }
    profile.status = 'ok'
    profile.latencyMs = got.latencyMs
    profile.lastTestAt = Date.now()
    state.activeId = key
    const warning = profile.kind === 'mihomo'
      ? `节点 ${profile.name} 需要本地代理引擎（${state.policy.enginePath || '未配置 enginePath'}）；本包不启动引擎，请自行拉起后用 --proxy 指向它`
      : ''
    this.#proxyLog(state, { action: 'connect', id: key, ok: true, latency_ms: got.latencyMs, kind: profile.kind })
    this.#proxyWrite(state)
    return {
      ok: true, activeId: key, latencyMs: got.latencyMs, warning,
      proxy_hint: profile.kind === 'mihomo' ? '' : `${profile.protocol}://${profile.host}:${profile.port}`,
      profiles: state.profiles.map((p) => this.#proxyPublic(p)),
    }
  }

  /** 测所有启用的节点，挑延迟最低的那个设为生效节点。 */
  async proxyPoolConnect(options = {}) {
    const tested = await this.proxyPoolTest(options.ids, options)
    const alive = (tested.results || []).filter((r) => r.ok).sort((a, b) => (a.latencyMs || 0) - (b.latencyMs || 0))
    if (alive.length === 0) throw new Error('没有可用节点：全部探测失败，未切换生效节点')
    const state = this.#proxyRead()
    state.activeId = alive[0].id
    this.#proxyLog(state, { action: 'connect-best', id: alive[0].id, latency_ms: alive[0].latencyMs, ok: true })
    this.#proxyWrite(state)
    return {
      ok: true, activeId: alive[0].id, latencyMs: alive[0].latencyMs,
      tested: tested.testSummary, results: tested.results,
      profiles: state.profiles.map((p) => this.#proxyPublic(p)),
    }
  }

  proxyPoolDisconnect() {
    const state = this.#proxyRead()
    const was = state.activeId
    state.activeId = ''
    this.#proxyLog(state, { action: 'disconnect', id: was || '', ok: true })
    this.#proxyWrite(state)
    return { ok: true, activeId: '', previous: was, profiles: state.profiles.map((p) => this.#proxyPublic(p)) }
  }
