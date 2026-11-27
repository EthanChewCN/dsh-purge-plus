    /* ---------- [dsh-purge-plus] R22 safe 2.0.2 的 op 名兼容层 ---------- */
    /*
     * 这三个不是新能力：`searchCve` / `lookupCve` / `templateCatalogStatus` 一直在
     * （lib/redteam/cve-db.js，redteam_cve 工具的 search / lookup / status 三个 action
     * 调的就是它们）。缺的只是**同名 op**。
     *
     * 后果是「能力在、名字不认」：外部自动化、脚本、别人的面板按 safe 的 op 名发请求，
     * 拿到的是 `unknown op: cveSearch` —— 用户会以为我们少了 CVE 检索能力。
     *
     * 与 safe 的三处**有意不同**：
     *   ① safe 在 catch 里 `return { ok: true, status, items: [] }`（R11-safe 的 SF-10），
     *      查询抛错被伪装成「没命中」。这里返回 `ok:false` + error，同时仍带 `status`
     *      与 `items: []`，所以按 safe 形状读的调用方不会因为缺键而崩。
     *   ② 参数做类型收敛：safe 把 `req.minCvss` 原样透传，字符串 'x' 会进 SQL 参数。
     *      这里只收有限数字。
     *   ③ 底库**读不出来**（没构建 / 文件坏了）时 `searchCve` 自己会吞掉异常返回 []，
     *      所以那条路径上 `ok` 仍是 true —— 光看 ok 分不清「没命中」和「库不在」。
     *      因此只要 `status.available === false` 就一定带 `note`，把原因写在返回值里。
     */
    if (op === 'cveSearch' || op === 'cveLookup' || op === 'templateCatalogStatus') {
      /* 底库状态是这三个 op 的公共返回字段（safe 同形）。读不出来也不能让整个 op 失败：
         状态读失败时检索本身往往仍然可用。 */
      let cveStatus = { available: false, count: 0 }
      try { cveStatus = cveDbStatus(store.root) } catch (e) {
        cveStatus = { available: false, count: 0, note: String((e && e.message) || e) }
      }
      /* 「库不在」必须说出来，不能只回一个空数组。 */
      const dbNote = cveStatus && cveStatus.available === false
        ? { note: String(cveStatus.note || '公开漏洞底库不可用：kb/cve.db 还没构建出来') }
        : null;

      if (op === 'templateCatalogStatus') {
        /* safe 的键名就是反的：`status` 是模板清单，`cve_db` 是底库状态。照抄，
           改过来会让按 safe 写的调用方读空。 */
        let catalog = { available: false, count: 0 }
        try { catalog = templateCatalogStatus(store.root) || catalog } catch (e) {
          catalog = { available: false, count: 0, note: String((e && e.message) || e) }
        }
        return Object.assign({ ok: true, cve_db: cveStatus, status: catalog }, dbNote)
      }

      if (op === 'cveLookup') {
        const raw = req.ids ?? req.cve ?? req.id ?? []
        const ids = (Array.isArray(raw) ? raw : [raw])
          .filter((x) => typeof x === 'string' && x.trim())
        try {
          const items = lookupCve(store.root, ids)
          return Object.assign({ ok: true, status: cveStatus, items: Array.isArray(items) ? items : [] }, dbNote)
        } catch (e) {
          return Object.assign({ ok: false, error: String((e && e.message) || e), status: cveStatus, items: [] }, dbNote)
        }
      }

      /* cveSearch */
      const minCvss = Number(req.minCvss)
      try {
        const items = searchCve(store.root, {
          q: typeof req.q === 'string' ? req.q : '',
          cve: typeof req.cve === 'string' ? req.cve : undefined,
          vendor: typeof req.vendor === 'string' ? req.vendor : undefined,
          product: typeof req.product === 'string' ? req.product : undefined,
          severity: typeof req.severity === 'string' ? req.severity : undefined,
          minCvss: Number.isFinite(minCvss) ? minCvss : undefined,
          kevOnly: req.kevOnly === true,
          hasPoc: req.hasPoc === true,
          since: typeof req.since === 'string' ? req.since : undefined,
          limit: Math.min(Number(req.limit) || 30, 200),
        })
        return Object.assign({ ok: true, status: cveStatus, items: Array.isArray(items) ? items : [] }, dbNote)
      } catch (e) {
        return Object.assign({ ok: false, error: String((e && e.message) || e), status: cveStatus, items: [] }, dbNote)
      }
    }
