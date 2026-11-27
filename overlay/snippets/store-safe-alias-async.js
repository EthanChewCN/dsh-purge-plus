  /* ---------- [dsh-purge-plus] R22 `intelSync` 兼容名（异步）----------
   *
   * safe 2.0.2 把「把 CVE 底库整库换成远端那一份」叫 `intelSync`，返回
   * `{ok, result, status}`。本包这项能力在 `intelUpdate('cve')`（走 intel-sync.js：
   * 清单 → sha256 → 解压校验 → 原子顶替），只是 op 名不同。
   *
   * 为什么不直接调 syncIntel：intelUpdate 那条路多两件事 —— 记一行 update-log、
   * 并且把结果并进统一的 results 形状。绕过它等于让同一个动作有两套账。
   *
   * 与 safe 的差异：`action=skipped`（没配数据源）时 safe 只给 ok:true + reason，
   * 读起来像「同步过了」。这里补一句 note 说明**没联网也没落盘**。
   */
  if (req.op === 'intelSync') {
    try {
      const out = await store.intelUpdate('cve', {
        base: typeof req.base === 'string' && req.base ? req.base : undefined,
        force: req.force === true,
        dry_run: req.dry_run === true,
        allow_downgrade: req.allow_downgrade === true,
        timeout_ms: req.timeout_ms,
      })
      const list = Array.isArray(out && out.results) ? out.results : []
      const result = list.find((r) => r && r.key === 'cve') || null
      const action = result && result.action ? String(result.action) : 'failed'
      const payload = { ok: action !== 'failed', result, status: out ? out.status : null }
      if (action === 'failed' && result && result.error) payload.error = String(result.error)
      if (action === 'skipped') {
        payload.note = '没有配置数据源（REDTEAM_INTEL_BASE）：本次没有联网，也没有落盘'
      }
      return payload
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), status: null }
    }
  }
