  /* ---------- [dsh-purge-plus] P11 复合工具入口 ---------- */
  //
  // 为什么要有这一层：P7/P9 把覆盖度做成了「一个维度一个 op」，
  // 智能体要推进一台主机得连着调四五次。复合入口把同一件事收成一次调用，
  // 但**不改变任何后端口径**——它们只是把已有 store 方法按使用场景拼起来。
  //
  // 与 safe 的三处刻意差异：
  //   ① 范围核对不解析域名。safe 的 scopeCheck 会把域名解析成 IP 再判，
  //      于是「核对」这个动作本身产生了网络副作用，而且 CDN 地址会被判成"在范围内"。
  //      这里只认字面 IP，域名返回 unresolved 并提示用户自己确认。
  //   ② 隧道实测按**目标**给结果，不是只给一个总数。safe 返回 reachable/total，
  //      看不出是哪几个不通——而"哪几个不通"才是判断隧道是否只通了半边网段的依据。
  //   ③ 模板保鲜**不联网**。status 读本地库现状，refresh 只重新探一遍并记录时间；
  //      真去下载是另一件事（要出口、要代理、要确认授权范围），不该藏在探针里。


  /** 范围核对：统一走 store（IP 数学只有一份实现）。 */
  function scopeOfTarget(store2, engagementId, target) {
    try {
      return store2.scopeCheckTarget(engagementId, target)
    } catch (e) {
      return { status: 'unresolved', scope: [], ip: null, error: String((e && e.message) || e) }
    }
  }

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_asset',
    description: '【单资产深挖】外部资产覆盖度：op=coverage 看 surface/web/auth/cve/app 缺哪项；op=update 标记进度；op=close 收口（没收完会拒绝）。'
      + '按单个资产推进，不要用批量扫描代替深挖。状态只能是 ' + COV_STATUSES + '。',
    parameters: {
      engagement: { type: 'string' },
      op: { type: 'string', description: 'coverage / update / close' },
      asset_id: { type: 'number', description: '资产 id（必填）' },
      surface: { type: 'string', description: 'update：端口/服务面' },
      web: { type: 'string', description: 'update：Web 应用面' },
      auth: { type: 'string', description: 'update：认证面' },
      cve: { type: 'string', description: 'update：漏洞面' },
      app: { type: 'string', description: 'update：业务面' },
      note: { type: 'string' },
      status: { type: 'string', description: 'close：closed / blocked' },
      reason: { type: 'string', description: 'close：blocked 必填' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: false, error: '还没有靶标' }, null, 2)
      if (args.asset_id === undefined || args.asset_id === null) {
        return JSON.stringify({ ok: false, error: 'asset_id 必填' }, null, 2)
      }
      const op2 = String(args.op || 'coverage').trim()
      try {
        if (op2 === 'coverage') {
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.getAssetCoverage(t.id, args.asset_id) }, null, 2)
        }
        if (op2 === 'update') {
          const patch = {}
          for (const k of ['surface', 'web', 'auth', 'cve', 'app', 'note']) {
            if (args[k] !== undefined) patch[k] = args[k]
          }
          if (Object.keys(patch).length === 0) return JSON.stringify({ ok: false, error: 'update 至少给一个字段' }, null, 2)
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.updateAssetCoverage(t.id, args.asset_id, patch, agentOf(args)) }, null, 2)
        }
        if (op2 === 'close') {
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.closeAssetCoverage(t.id, args.asset_id, { status: args.status, reason: args.reason, actor: agentOf(args) }) }, null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 op：' + op2 + '（coverage/update/close）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_asset_next',
    description: '外部单资产深挖队列：返回还没做完的资产与缺失项（surface/web/auth/cve/app）。'
      + '用于主会话按单资产派 vuln-scan；它不是扫描器。',
    parameters: {
      engagement: { type: 'string' },
      asset_id: { type: 'number', description: '只看一个资产（可选）' },
      limit: { type: 'number', description: '默认 8，最多 30' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, items: [], total: 0, note: '还没有靶标' }, null, 2)
      try {
        const out = store.assetNextActions(t.id, { assetId: args && args.asset_id, limit: args && args.limit })
        return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_host',
    description: '【主机后渗透】主机覆盖度与结构化发现：op=coverage 看这台主机还缺 文件/凭据/提权/Web/DB/横向 哪些面；'
      + 'op=finding 记录 file/credential/privesc/lateral/web/db/config/share 发现；op=update 手动标记；op=close 收口（没收完会拒绝）。',
    parameters: {
      engagement: { type: 'string' },
      op: { type: 'string', description: 'coverage / finding / update / close' },
      asset_id: { type: 'number', description: '资产 id（必填）' },
      kind: { type: 'string', description: 'finding：file/credential/privesc/lateral/web/db/config/share' },
      title: { type: 'string' },
      detail: { type: 'string' },
      evidence_ref: { type: 'string' },
      access: { type: 'string', description: 'update：none/user/admin/root 等' },
      files: { type: 'string', description: 'update：' + COV_STATUSES },
      privesc: { type: 'string', description: 'update：' + COV_STATUSES },
      web: { type: 'string', description: 'update：' + COV_STATUSES },
      db: { type: 'string', description: 'update：' + COV_STATUSES },
      lateral: { type: 'string', description: 'update：' + COV_STATUSES },
      credentials: { type: 'number', description: 'update：已知凭据数' },
      status: { type: 'string', description: 'close：closed / blocked' },
      reason: { type: 'string', description: 'close：收口/阻塞原因' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: false, error: '还没有靶标' }, null, 2)
      if (args.asset_id === undefined || args.asset_id === null) {
        return JSON.stringify({ ok: false, error: 'asset_id 必填' }, null, 2)
      }
      const op2 = String(args.op || 'coverage').trim()
      try {
        if (op2 === 'coverage') {
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.getHostCoverage(t.id, args.asset_id) }, null, 2)
        }
        if (op2 === 'finding') {
          const out = store.addHostFinding(t.id, {
            asset_id: args.asset_id, kind: args.kind, title: args.title,
            detail: args.detail, evidence_ref: args.evidence_ref, created_by: agentOf(args),
          })
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
        }
        if (op2 === 'update') {
          const patch = {}
          for (const k of ['access', 'files', 'privesc', 'web', 'db', 'lateral', 'credentials']) {
            if (args[k] !== undefined) patch[k] = args[k]
          }
          if (args.reason !== undefined) patch.blocked_reason = args.reason
          if (Object.keys(patch).length === 0) return JSON.stringify({ ok: false, error: 'update 至少给一个字段' }, null, 2)
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.updateHostCoverage(t.id, args.asset_id, patch, agentOf(args)) }, null, 2)
        }
        if (op2 === 'close') {
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.closeHostCoverage(t.id, args.asset_id, { status: args.status, reason: args.reason, actor: agentOf(args) }) }, null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 op：' + op2 + '（coverage/finding/update/close）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_next_action',
    description: '内网下一动作队列：按资产/服务/当前得分返回还缺什么（文件、凭据、提权、Web、DB、横向），不是自动利用。'
      + '有动作就继续做，队列空再收口。',
    parameters: {
      engagement: { type: 'string' },
      asset_id: { type: 'number', description: '只看一台主机（可选）' },
      limit: { type: 'number', description: '默认 8，最多 30' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, items: [], total: 0, note: '还没有靶标' }, null, 2)
      try {
        const out = store.hostNextActions(t.id, { assetId: args && args.asset_id, limit: args && args.limit })
        return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_scope_check',
    description: '检查一个 IP / URL 是否在当前靶标的授权范围内。'
      + '返回 in（命中某个 CIDR）/ out（不在范围）/ unscoped（靶标没记范围）/ unresolved（给的是域名或主机名）。'
      + '**不解析域名**：核对动作不该产生网络副作用，CDN 地址也不该被判成"在范围内"。'
      + 'out 的条目不要碰。',
    parameters: {
      engagement: { type: 'string' },
      target: { type: 'string', description: '要检查的 IP / URL（必填）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: false, error: '还没有靶标' }, null, 2)
      if (!args || typeof args.target !== 'string' || args.target.trim() === '') {
        return JSON.stringify({ ok: false, error: 'target 必填' }, null, 2)
      }
      try {
        const check = scopeOfTarget(store, t.id, args.target)
        /* ok 的含义是「核对动作本身成功」，不是「在范围内」——
           把 out 也报成 ok:false 会让智能体以为工具坏了而重试。 */
        return JSON.stringify(Object.assign({ ok: true, engagement: t.id, target: args.target }, check), null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_batch',
    description: '批量落库，减少逐条调用：kind=assets 批量资产（最多 500，复用 asset_add 的字段与去重）；'
      + 'kind=assess 批量评估（最多 200）；kind=vulns 批量漏洞（最多 200，带 request/response 自动存 HTTP 证据）。'
      + '超出 scope 的条目会跳过并在 rejected 里说明原因——不会静默丢弃。',
    parameters: {
      engagement: { type: 'string' },
      kind: { type: 'string', description: 'assets / assess / vulns' },
      items: {
        type: 'array',
        description: 'assets: [{ip, provenance, tool, state, primary_name, names, ports, discovered_at}]；'
          + 'assess: [{asset_id|ip, priority, potential, reason}]；'
          + 'vulns: [{title, severity, asset_id, cve, target, evidence, status, gained, request, response, method}]',
        items: { type: 'object', additionalProperties: true },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: false, error: '还没有靶标' }, null, 2)
      const kind = String((args && args.kind) || '').trim()
      const items = Array.isArray(args && args.items) ? args.items : []
      const limit = kind === 'assets' ? 500 : 200
      if (items.length === 0 || items.length > limit) {
        return JSON.stringify({ ok: false, error: 'items 数量必须在 1..' + limit }, null, 2)
      }
      const rejected = []
      const results = []
      try {
        if (kind === 'assets') {
          const accepted = []
          for (const it of items) {
            if (!it || typeof it.ip !== 'string' || it.ip.trim() === '') { rejected.push({ item: it, reason: 'ip required' }); continue }
            const check = scopeOfTarget(store, t.id, it.ip)
            if (check.status === 'out') { rejected.push({ ip: it.ip, reason: 'out_of_scope', scope: check.scope }); continue }
            accepted.push(it)
          }
          const out = accepted.length > 0
            ? store.importBundle(t.id, { scan: { tool: 'redteam_batch', argv: ['assets'] }, assets: accepted })
            : { counts: { assets: 0 } }
          return JSON.stringify({
            ok: true, engagement: t.id, kind,
            accepted: accepted.length, rejected: rejected.length, counts: out.counts, rejected,
          }, null, 2)
        }
        if (kind === 'assess') {
          for (const it of items) {
            try { results.push(store.assessAsset(t.id, it || {})) } catch (e) {
              rejected.push({ item: it, reason: String((e && e.message) || e) })
            }
          }
          return JSON.stringify({
            ok: true, engagement: t.id, kind,
            assessed: results.length, rejected: rejected.length, results, rejected,
          }, null, 2)
        }
        if (kind === 'vulns') {
          for (const it of items) {
            const check = scopeOfTarget(store, t.id, it && it.target)
            if (check.status === 'out') { rejected.push({ target: it && it.target, reason: 'out_of_scope', scope: check.scope }); continue }
            try {
              const v = store.addVuln(t.id, Object.assign({}, it, { agent: agentOf(args), found_by_agent: (it && it.found_by_agent) || (it && it.agent) || agentOf(args) }))
              let httpEvidenceId = null
              const request = it && typeof it.request === 'string' ? it.request.trim() : ''
              if (request !== '') {
                try {
                  const ev = store.addHttpEvidence(t.id, {
                    vuln_id: v.id, asset_id: it.asset_id, label: it.title,
                    method: it.method || 'GET', url: it.target, request, response: it.response,
                    captured_by: agentOf(args),
                  })
                  httpEvidenceId = ev.id
                } catch { /* 漏洞已落库，证据失败不阻断 */ }
              }
              results.push({ id: v.id, updated: v.updated === true, http_evidence_id: httpEvidenceId })
            } catch (e) {
              rejected.push({ item: it, reason: String((e && e.message) || e) })
            }
          }
          return JSON.stringify({
            ok: true, engagement: t.id, kind,
            inserted: results.length, rejected: rejected.length, results, rejected,
          }, null, 2)
        }
        return JSON.stringify({ ok: false, error: 'kind 只接受 assets / assess / vulns' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_pivot_probe',
    description: '通过一个本地 SOCKS5 隧道实测多个内网目标（host:port），返回**逐个目标**的可达矩阵。'
      + '用来判断「隧道进程活着」是不是真的能到内网——本地端口在监听不等于后端还在。'
      + '只做 CONNECT 握手，不做端口扫描、不发业务请求。',
    parameters: {
      engagement: { type: 'string' },
      listen: { type: 'string', description: '隧道本地 SOCKS5 监听，如 127.0.0.1:1080（必填）' },
      targets: { type: 'array', items: { type: 'string' }, description: '内网目标 host:port 列表，最多 50 个' },
      timeoutMs: { type: 'number', description: '单目标超时，默认 6000ms' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: false, error: '还没有靶标' }, null, 2)
      if (!args || typeof args.listen !== 'string' || args.listen.trim() === '') {
        return JSON.stringify({ ok: false, error: 'listen 必填（如 127.0.0.1:1080）' }, null, 2)
      }
      const targets = (Array.isArray(args.targets) ? args.targets : []).filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, 50)
      if (targets.length === 0) return JSON.stringify({ ok: false, error: 'targets 必填' }, null, 2)
      try {
        const out = await store.pivotProbe(args.listen, targets, args.timeoutMs)
        return JSON.stringify(Object.assign({ ok: out.error === undefined, engagement: t.id }, out), null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_template_refresh',
    description: '资源保鲜：看本机 KEV 目录 / nuclei 模板库 / 字典库在不在、多久没动过、有没有过期，并可重新探一遍。'
      + 'action=status 只看、refresh 重新探并记录检查时间（两者都**不联网**）；'
      + 'update 才会真下载（带大小上限与超时，失败逐条报）。'
      + '引用「最新 KEV」之前先看这里，别凭印象说用的是最新的。',
    parameters: {
      action: { type: 'string', description: 'status / refresh / update，默认 status' },
      force: { type: 'boolean', description: 'refresh 时忽略保鲜窗口（仍然只做本地探测）' },
      target: { type: 'string', description: 'update 时刷哪个：kev / nuclei / all，默认 all' },
      dry_run: { type: 'boolean', description: 'update 时只校验、不落盘' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const action = String((args && args.action) || 'status').trim()
      try {
        if (action === 'status') return JSON.stringify(Object.assign({ ok: true }, store.intelStatus()), null, 2)
        if (action === 'refresh') return JSON.stringify(Object.assign({ ok: true }, store.intelRefresh()), null, 2)
        if (action === 'update') {
          const out = await store.intelUpdate(String((args && args.target) || 'all'), { dry_run: args && args.dry_run === true })
          const failed = (out.results || []).filter((r) => r.action === 'failed')
          return JSON.stringify(Object.assign({ ok: failed.length === 0 }, out), null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（status/refresh/update）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))
