  /* [dsh-purge-plus] CVE 底库（本机公开漏洞情报，只读）。
     为什么需要它：redteam_poc_search 查的是「本机沉淀的经验 + 本机 nuclei 模板」，
     它回答不了「这个组件历史上有什么洞」——那是全网公开数据，40 万条量级，
     不该塞进知识库，也不该每次都去互联网翻。这一层补的就是那个空档。
     与 safe 的差异：safe 只带了读取层（lib/redteam/cve-db.js），没有构建器，
     装到机器上永远是 available:false —— 面板上看得见入口、点进去什么都没有。
     本包补了 scripts/build-cve-db.mjs（NVD 年度 feed + KEV + EPSS），
     没建库时这个工具会**明确说没建**，而不是返回空数组让人以为「查无此洞」。 */
  ctx.tools.register(withStructuredErrors(defineTool({
    name: 'redteam_cve',
    description: '【拿到组件/版本后的第二步】本机 CVE 底库（公开情报，只读）：'
      + '按关键字/产品/厂商/CVSS/是否在野利用检索 CVE，按编号取详情，'
      + '按产品铺开高危面，查某个 CVE 的 ExploitDB 条目 / nuclei 模板 / GitHub PoC。'
      + '排序就是「先打哪个」：KEV（已在野利用）→ 有模板 → 有 EXP → CVSS → EPSS → 新。'
      + 'op=status 先看底库在不在、多少条、多久没更新。'
      + '**它不等于打过**：命中只代表「历史上存在这个洞」，能不能打要自己去验证。',
    parameters: {
      op: { type: 'string', description: 'search（默认）/ get / product / exploits / templates / poc / status' },
      q: { type: 'string', description: '关键字：组件+版本、漏洞名、正文特征串；也可以是 CVE 编号' },
      cve: { type: 'string', description: 'CVE 编号，可多个（逗号/空格分隔），get 时用' },
      product: { type: 'string', description: '产品名（CPE 里的 product），如 weblogic_server、struts' },
      vendor: { type: 'string', description: '厂商名（CPE 里的 vendor），如 oracle、apache' },
      severity: { type: 'string', description: 'critical,high,medium,low（逗号分隔）' },
      minCvss: { type: 'number', description: 'CVSS 下限，例如 7 只要高危以上' },
      kevOnly: { type: 'boolean', description: 'true 只看 CISA KEV（已在野利用）' },
      hasPoc: { type: 'boolean', description: 'true 只看有 EXP 或 nuclei 模板的' },
      since: { type: 'string', description: '发布日期下限，如 2023-01-01' },
      type: { type: 'string', description: 'exploits 时按 EXP 类型筛：remote / local / webapps / dos' },
      limit: { type: 'number', description: '返回条数上限，默认 30，最大 200' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const op = String((args && args.op) || 'search').trim()
      const limit = Math.min(Math.max(Number(args && args.limit) || 30, 1), 200)
      const root = store.root
      let cve = null
      try {
        cve = await import('./cve-db.js')
      } catch (e) {
        return JSON.stringify({ ok: false, error: 'cve-db 模块加载失败：' + String((e && e.message) || e) }, null, 2)
      }
      const status = (() => { try { return cve.cveDbStatus(root) } catch (e) { return { available: false, note: String((e && e.message) || e) } } })()

      const missing = () => JSON.stringify({
        ok: false,
        available: false,
        error: '本机没有 CVE 底库（kb/cve.db 不存在）。这不是「查无此洞」，是这一层还没建。',
        how_to_build: '在插件目录跑 `node scripts/build-cve-db.mjs --install`（NVD 年度 feed + CISA KEV + EPSS，公开数据，约 240MB 下载）。',
        fallback: '没有底库时改用 redteam_poc_search（本机经验 + 本机 nuclei 模板），或直接 web_search。',
        status,
      }, null, 2)

      try {
        if (op === 'status') {
          const out = {
            ok: true,
            cve: status,
            exploits: (() => { try { return cve.exploitStatus(root) } catch { return null } })(),
            templates: (() => { try { return cve.templateCatalogStatus(root) } catch { return null } })(),
            poc_github: (() => { try { return cve.pocGitHubStatus(root) } catch { return null } })(),
          }
          if (!status.available) out.how_to_build = 'node scripts/build-cve-db.mjs --install'
          return JSON.stringify(out, null, 2)
        }

        if (!status.available) return missing()

        if (op === 'get') {
          const ids = String((args && (args.cve || args.q)) || '')
          if (!ids.trim()) return JSON.stringify({ ok: false, error: 'get 需要 cve 参数（可多个）' }, null, 2)
          const rows = cve.lookupCve(root, ids)
          return JSON.stringify({
            ok: true, count: rows.length, items: rows,
            missing: String(ids).match(/CVE-\d{4}-\d{4,7}/gi)?.filter((id) => !rows.some((r) => r.cve === id.toUpperCase())) || [],
          }, null, 2)
        }

        if (op === 'product') {
          const product = String((args && args.product) || (args && args.q) || '').trim()
          if (!product) return JSON.stringify({ ok: false, error: 'product 需要 product 或 q' }, null, 2)
          const rows = cve.cvesOfProduct(root, product, limit)
          return JSON.stringify({
            ok: true, product, count: rows.length, items: rows,
            hint: rows.length === 0
              ? '这个 product 名在 CPE 里没有高危记录。CPE 的 product 名常与产品名不同（weblogic → weblogic_server），先 search 一下确认拼写。'
              : '按「先打哪个」排好了：KEV 优先，其次有模板/EXP 的。',
          }, null, 2)
        }

        if (op === 'exploits') {
          const rows = cve.searchExploits(root, {
            q: String((args && (args.q || args.cve)) || ''),
            type: String((args && args.type) || ''),
            limit,
          })
          const exp = (() => { try { return cve.exploitStatus(root) } catch { return null } })()
          return JSON.stringify({
            ok: true, count: rows.length, items: rows, status: exp,
            hint: exp && Number(exp.count) === 0
              ? '底库里 EXP 表是空的（构建时没给 --edb）。有 ExploitDB 的 files_exploits.csv 就重建一次，没有就走 web_search。'
              : 'EXP 只存索引元数据（编号/路径/类型/平台/日期），正文要自己去公开仓库取；本包不下载也不执行 EXP 正文。',
          }, null, 2)
        }

        if (op === 'templates') {
          const rows = cve.searchTemplates(root, {
            q: String((args && (args.q || args.cve)) || ''),
            severity: String((args && args.severity) || ''),
            limit,
          })
          const tpl = (() => { try { return cve.templateCatalogStatus(root) } catch { return null } })()
          return JSON.stringify({
            ok: true, count: rows.length, items: rows, status: tpl,
            hint: '这是**底库里的清单**（兜底用），路径不一定在本机磁盘上。'
              + '要真打先用 redteam_poc_search 查本机模板库（那份带真实路径、与磁盘一致），'
              + '本机有就直接 `nuclei -t <相对路径>`；本机没有再看这里决定要不要 redteam_intel update。',
          }, null, 2)
        }

        if (op === 'poc') {
          const id = String((args && (args.cve || args.q)) || '')
          if (!id.trim()) return JSON.stringify({ ok: false, error: 'poc 需要 cve 或 q' }, null, 2)
          const rows = /^CVE-/i.test(id.trim())
            ? cve.pocReposOfCve(root, id)
            : cve.searchPocRepos(root, { q: id, limit })
          const st = (() => { try { return cve.pocGitHubStatus(root) } catch { return null } })()
          return JSON.stringify({
            ok: true, count: rows.length, items: rows, status: st,
            hint: st && Number(st.count) === 0
              ? '底库里没有 GitHub PoC 索引（构建时没给 --poc-github）。'
              : '仓库列表只是线索：star 高不等于能打，先读代码再跑。',
          }, null, 2)
        }

        /* search */
        const rows = cve.searchCve(root, {
          q: String((args && args.q) || ''),
          cve: args && args.cve ? String(args.cve) : '',
          product: String((args && args.product) || ''),
          vendor: String((args && args.vendor) || ''),
          severity: String((args && args.severity) || ''),
          minCvss: args && args.minCvss !== undefined ? Number(args.minCvss) : undefined,
          kevOnly: args && args.kevOnly === true,
          hasPoc: args && args.hasPoc === true,
          since: args && args.since ? String(args.since) : '',
          limit,
        })
        return JSON.stringify({
          ok: true,
          count: rows.length,
          items: rows,
          db: { count: status.count, built_at: status.built_at, age_days: status.age_days, stale: status.stale },
          hint: rows.length === 0
            ? (status.stale
              ? '底库超过 ' + (status.age_days ?? '?') + ' 天没更新了：先 redteam_cve op=status 看，再决定要不要重建，别把「旧库没有」当成「不存在」。'
              : '底库里没有匹配项。CPE 的 product/vendor 名常与产品名不同，换个拼法再搜；再没有就去 web_search。')
            : '命中不代表能打：确认版本是否落在受影响区间，再走验证。KEV=1 的优先。',
        }, null, 2)
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2)
      }
    },
  })))
