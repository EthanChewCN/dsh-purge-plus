  /* ---------- [dsh-purge-plus] P7 覆盖度工具 ---------- */

  /**
   * 把「靶标有歧义」统一转成可读结果，而不是让六个工具各写一遍 try/catch。
   *
   * 读操作不该因为靶标不唯一就抛错：抛出去会被上层包成一条通用错误，
   * 智能体看不出「该传 engagement」还是「该先绑定会话」，于是原地重试。
   */
  function covTarget(store, exec, wanted) {
    try {
      return { id: resolveEngagement(store, exec, wanted) || '', error: '' }
    } catch (e) {
      return { id: '', error: String((e && e.message) || e) }
    }
  }
  function covAmbiguous(error) {
    return JSON.stringify({
      ok: false,
      reason: 'engagement_ambiguous',
      error,
      note: '传 engagement 参数指定靶标，或先 redteam_session_bind 绑定本会话。',
    }, null, 2)
  }
  const COV_STATUSES = 'untested / partial / done / blocked / not_applicable'

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_asset_coverage',
    description: '外部单资产深挖覆盖度（surface 面 / web 应用 / auth 认证 / cve 漏洞 / app 业务）。'
      + 'action=get 读一台；update 标某一项；close 收口（五项全 done/blocked/not_applicable 才允许）；next 看待办队列。'
      + '状态只能是 ' + COV_STATUSES + '。批量扫完就 close 会被拒绝并点名缺哪几项。',
    parameters: {
      action: { type: 'string', description: 'get / update / close / next，默认 get' },
      asset_id: { type: 'number', description: '资产 id（get/update/close 必填）' },
      surface: { type: 'string', description: 'update：面覆盖情况' },
      web: { type: 'string', description: 'update：Web 应用' },
      auth: { type: 'string', description: 'update：认证/登录' },
      cve: { type: 'string', description: 'update：已知漏洞验证' },
      app: { type: 'string', description: 'update：业务逻辑' },
      note: { type: 'string', description: 'update：备注' },
      reason: { type: 'string', description: 'close：收口原因（blocked 必填）' },
      status: { type: 'string', description: 'close：closed 或 blocked，默认 closed' },
      limit: { type: 'number', description: 'next：最多几条（默认 8）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, note: '还没有靶标' }, null, 2)
      const action = String((args && args.action) || 'get').trim()
      try {
        if (action === 'next') {
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, store.assetNextActions(t.id, { limit: args && args.limit })), null, 2)
        }
        if (args.asset_id === undefined || args.asset_id === null) {
          return JSON.stringify({ ok: false, error: action + ' 需要 asset_id' }, null, 2)
        }
        if (action === 'get') {
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.getAssetCoverage(t.id, args.asset_id) }, null, 2)
        }
        if (action === 'update') {
          const patch = {}
          for (const f of ['surface', 'web', 'auth', 'cve', 'app', 'note']) {
            if (args[f] !== undefined) patch[f] = args[f]
          }
          if (Object.keys(patch).length === 0) {
            return JSON.stringify({ ok: false, error: 'update 至少给一个字段：surface/web/auth/cve/app/note' }, null, 2)
          }
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.updateAssetCoverage(t.id, args.asset_id, patch, exec && exec.agentId) }, null, 2)
        }
        if (action === 'close') {
          const coverage = store.closeAssetCoverage(t.id, args.asset_id, {
            status: args.status, reason: args.reason, actor: exec && exec.agentId,
          })
          return JSON.stringify({ ok: true, engagement: t.id, coverage }, null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（get/update/close/next）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_host_coverage',
    description: '内网主机覆盖度（files 文件 / privesc 提权 / web / db / lateral 横向）。'
      + 'action=get 读一台；update 标某一项；close 收口（没权限只能 blocked 且必须写 reason）；next 看待办队列。'
      + '状态只能是 ' + COV_STATUSES + '；credentials 是计数不是状态。',
    parameters: {
      action: { type: 'string', description: 'get / update / close / next，默认 get' },
      asset_id: { type: 'number', description: '资产 id（get/update/close 必填）' },
      files: { type: 'string', description: 'update：文件收集' },
      privesc: { type: 'string', description: 'update：提权' },
      web: { type: 'string', description: 'update：Web 侧' },
      db: { type: 'string', description: 'update：数据库' },
      lateral: { type: 'string', description: 'update：横向' },
      access: { type: 'string', description: 'update：当前权限（none / user / root …）' },
      credentials: { type: 'number', description: 'update：已拿到凭据条数（非负整数）' },
      reason: { type: 'string', description: 'close：收口原因（没权限或 blocked 必填）' },
      status: { type: 'string', description: 'close：closed 或 blocked，默认 closed' },
      limit: { type: 'number', description: 'next：最多几条（默认 8）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, note: '还没有靶标' }, null, 2)
      const action = String((args && args.action) || 'get').trim()
      try {
        if (action === 'next') {
          return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, store.hostNextActions(t.id, { limit: args && args.limit })), null, 2)
        }
        if (args.asset_id === undefined || args.asset_id === null) {
          return JSON.stringify({ ok: false, error: action + ' 需要 asset_id' }, null, 2)
        }
        if (action === 'get') {
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.getHostCoverage(t.id, args.asset_id) }, null, 2)
        }
        if (action === 'update') {
          const patch = {}
          for (const f of ['files', 'privesc', 'web', 'db', 'lateral', 'access', 'credentials']) {
            if (args[f] !== undefined) patch[f] = args[f]
          }
          if (Object.keys(patch).length === 0) {
            return JSON.stringify({ ok: false, error: 'update 至少给一个字段：files/privesc/web/db/lateral/access/credentials' }, null, 2)
          }
          return JSON.stringify({ ok: true, engagement: t.id, coverage: store.updateHostCoverage(t.id, args.asset_id, patch, exec && exec.agentId) }, null, 2)
        }
        if (action === 'close') {
          const coverage = store.closeHostCoverage(t.id, args.asset_id, {
            status: args.status, reason: args.reason, actor: exec && exec.agentId,
          })
          return JSON.stringify({ ok: true, engagement: t.id, coverage }, null, 2)
        }
        return JSON.stringify({ ok: false, error: '未知 action：' + action + '（get/update/close/next）' }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_host_finding',
    description: '在主机侧记一条**结构化**发现（文件 / 凭据 / 提权 / 横向 / Web / DB / 配置 / 共享）。'
      + '标题必填。记完会自动把对应维度从 untested 推到 partial（只升不降，也不会直接标 done）。'
      + '不要用自由文本代替：下一步该做什么要靠 kind 判断，自由文本判断不了。',
    parameters: {
      asset_id: { type: 'number', description: '资产 id（必填）' },
      kind: { type: 'string', description: 'file / credential / privesc / lateral / web / db / config / share' },
      title: { type: 'string', description: '一句话说清发现了什么（必填）' },
      detail: { type: 'string', description: '细节：路径、账号、命令行、结论' },
      evidence_ref: { type: 'string', description: '证据引用（截图 id / http_evidence id / 文件路径）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, note: '还没有靶标' }, null, 2)
      try {
        const out = store.addHostFinding(t.id, {
          asset_id: args && args.asset_id,
          kind: args && args.kind,
          title: args && args.title,
          detail: args && args.detail,
          evidence_ref: args && args.evidence_ref,
          created_by: exec && exec.agentId,
        })
        return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_host_findings',
    description: '按资产或类型列主机侧结构化发现（倒序）。写报告、做归属证明、判断「这台到底挖到了什么」都读这一份。',
    parameters: {
      asset_id: { type: 'number', description: '只看这台资产' },
      kind: { type: 'string', description: '只看这类发现' },
      limit: { type: 'number', description: '最多几条（默认 50，上限 200）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, total: 0, findings: [], note: '还没有靶标' }, null, 2)
      const out = store.listHostFindings(t.id, {
        asset_id: args && args.asset_id, kind: args && args.kind, limit: args && args.limit,
      })
      return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, out), null, 2)
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_coverage_gaps',
    description: '两侧覆盖度缺口合并队列：外部资产还缺哪几项深挖、内网主机还缺哪几项收口，按优先级排。'
      + '派下一个智能体之前先看这个 —— 它回答「现在该打谁、打什么」，而不是「谁在等我」。',
    parameters: {
      limit: { type: 'number', description: '每侧最多几条（默认 8）' },
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, external: { total: 0, actions: [] }, internal: { total: 0, actions: [] }, note: '还没有靶标' }, null, 2)
      const external = store.assetNextActions(t.id, { limit: args && args.limit })
      const internal = store.hostNextActions(t.id, { limit: args && args.limit })
      return JSON.stringify({
        ok: true, engagement: t.id, external, internal,
        pending: external.total + internal.total,
      }, null, 2)
    },
  })))

  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_coverage_summary',
    description: '覆盖度快照：内外网各有多少资产、已收口/受阻/未动，以及主机侧发现条数与缺口数。'
      + '只给计数不给百分比 —— 分母里有大量「扫出来但没打算打」的资产，百分比会误导。',
    parameters: {
      engagement: { type: 'string', description: '靶标 id（一般不用传）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const t = covTarget(store, exec, args && args.engagement)
      if (t.error) return covAmbiguous(t.error)
      if (!t.id) return JSON.stringify({ ok: true, note: '还没有靶标' }, null, 2)
      return JSON.stringify(Object.assign({ ok: true, engagement: t.id }, store.coverageSummary(t.id)), null, 2)
    },
  })))
