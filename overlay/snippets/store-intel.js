  /* ---------- [dsh-purge-plus] P10 资源保鲜 ---------- */
  //
  // 干什么：把「情报资源是不是新的」变成可查询的事实，而不是让智能体凭印象说
  // 「我用了最新的 KEV」。判据只有两个：文件在不在、多久没动过。
  //
  // 刻意**不联网**：这个 op 只做本地探针 + 记录检查时间。真去下载 KEV / 更新
  // nuclei 模板是另一件事（要出口、要代理、要确认授权范围），塞进这里会让一个
  // 纯读的探针变成会写外网请求的副作用。要刷新就配外部命令，别偷偷做。

  static INTEL_RESOURCES = [
    { key: 'kev', label: 'KEV 已利用漏洞目录', kind: 'file', stale_days: 7 },
    { key: 'nuclei', label: 'nuclei 模板', kind: 'dir', stale_days: 14 },
    { key: 'wordlists', label: '字典库', kind: 'dir', stale_days: 30 },
  ]

  /** 每个资源可能落盘的几个位置（按顺序取第一个存在的）。 */
  #intelPaths(key) {
    const home = process.env.HOME || ''
    if (key === 'kev') {
      return [
        join(this.root, 'intel', 'kev.json'),
        home ? join(home, '.dsh', 'redteam', 'intel', 'kev.json') : '',
      ].filter(Boolean)
    }
    if (key === 'nuclei') {
      /* [dsh-purge-plus] 插件自己那份排在最前（与 safe 的 templatesStatus 同序）：
         它才是 refreshTemplates 会替换、面板上能说「可刷新」的那一份。
         过去只找 home 下的两份，于是插件自带的模板库被当成「外部目录，不碰」。 */
      /* 用户在环境适配页显式配过 nucleiTemplatesDir 就先用它 —— 与
         bootstrap-runtime 的 templatesStatus 同一优先级，否则面板显示的目录
         与实际刷新的目录会是两个（R21 审计 RB-06）。 */
      const configured = (() => {
        try { return String(nucleiTemplatesDirOf(this.root) || '') } catch { return '' }
      })()
      return [
        configured,
        join(this.root, 'toolkit', 'nuclei-templates'),
        home ? join(home, '.local', 'nuclei-templates') : '',
        home ? join(home, 'nuclei-templates') : '',
      ].filter(Boolean)
    }
    return [
      join(this.root, 'wordlists'),
      home ? join(home, '.dsh', 'redteam', 'wordlists') : '',
    ].filter(Boolean)
  }

  /* ---------- 计数摘要（safe 的 templates / kev 两段） ----------
     safe 的 intelStatus 带两个「计数摘要」对象，环境适配页靠它们显示
     「14481 个模板 / 上次刷新 45 小时前」「CISA KEV 1805 条」。
     我们过去只给文件级探针（resources[]），页面只能说「4 天没动」，
     说不出「一共多少个」——规模信息恰恰是判断模板库值不值得刷新的依据。

     计数有成本（1.4 万个文件要遍历、KEV 要解析 1.8MB JSON），所以带缓存：
     目录计数 60 秒一次；KEV 按 (mtime,size) 缓存，文件变了才重读。 */
  static INTEL_COUNT_CACHE = new Map()

  #countYamlCached(dir) {
    if (!dir) return 0
    const cache = RedteamStore.INTEL_COUNT_CACHE
    const key = 'yaml:' + dir
    const now = Date.now()
    const hit = cache.get(key)
    if (hit !== undefined && now - hit.at < 60000) return hit.n
    /* 与 intelUpdate 用**同一个**计数器（#countTemplates）：它跳过点目录、并要求文件
       里真有 `id:` 行。曾经这里自己数「所有 .yaml」，于是同一棵模板树，
       环境适配页报 14445 个、更新日志报 14423 个 —— 同一概念两份实现（R21 审计 RB-05）。 */
    let n = 0
    try { n = this.#countTemplates(dir) } catch { n = 0 }
    cache.set(key, { at: now, n })
    return n
  }

  #intelTemplatesSummary(res) {
    const dir = res && res.exists && res.is_dir ? res.path : ''
    let cfg = {}
    try { cfg = JSON.parse(readFileSync(join(this.root, 'config.json'), 'utf8')) } catch { cfg = {} }
    /* 配置里的 count 只有「刷新过」才有；装完没刷过的机器按磁盘实数一遍，
       否则 1.4 万个模板会被报成 0 个（safe 的 templatesStatus 同一取舍）。 */
    const stored = Number(cfg.templatesCount) || 0
    const count = stored > 0 ? stored : this.#countYamlCached(dir)
    const refreshedAt = Number(cfg.templatesRefreshedAt) || 0
    const ageHours = refreshedAt > 0 ? Math.round(((Date.now() - refreshedAt) / 3600000) * 10) / 10 : null
    const limit = 72
    return {
      dir: dir || null,
      count,
      refreshed_at: refreshedAt,
      age_hours: ageHours,
      /* 有库但从没刷新过也算过期（老机器装完就没动过）；没有库不谈过期 */
      stale: dir !== '' && (ageHours === null || ageHours >= limit),
      auto_refresh_hours: limit,
      owned: dir !== '' && dir.startsWith(this.root),
      last_error: String(cfg.templatesLastError || ''),
    }
  }

  #intelKevSummary(res) {
    const path = res && res.exists ? res.path : ''
    let count = 0
    let updatedAt = 0
    if (path !== '') {
      const cache = RedteamStore.INTEL_COUNT_CACHE
      const key = 'kev:' + path
      let stamp = ''
      try { const st = statSync(path); stamp = String(st.mtimeMs) + ':' + String(st.size) } catch { stamp = '' }
      const hit = cache.get(key)
      if (hit !== undefined && hit.stamp === stamp) {
        count = hit.n
        updatedAt = hit.updated_at
      } else {
        try {
          const raw = JSON.parse(readFileSync(path, 'utf8'))
          const list = Array.isArray(raw) ? raw : (Array.isArray(raw.vulnerabilities) ? raw.vulnerabilities : [])
          count = list.length
          /* dateReleased 是 "2021-11-03" 这种日期串，Number() 会得到 0，
             于是「上次更新」永远是「0 小时前」—— 伪造新鲜度比没有更糟。
             解析失败就退回文件 mtime（至少是真的）。 */
          const released = raw && raw.dateReleased
          const parsedReleased = typeof released === 'number' ? released : Date.parse(String(released || ''))
          if (Number.isFinite(parsedReleased) && parsedReleased > 0) updatedAt = parsedReleased
          else {
            try { updatedAt = statSync(path).mtimeMs } catch { updatedAt = 0 }
          }
        } catch { count = 0 }
        cache.set(key, { stamp, n: count, updated_at: updatedAt })
      }
    }
    const ageHours = updatedAt > 0
      ? Math.round(((Date.now() - updatedAt) / 3600000) * 10) / 10
      : (res && res.age_days !== null && res.age_days !== undefined ? res.age_days * 24 : null)
    return {
      available: path !== '' && count > 0,
      /* safe 的 kevStatus 带 enabled：面板据此决定要不要显示「已启用」标签。
         我们恒为 true（没有单独的开关），但键必须在，否则按 safe 写的 UI 读到 undefined。 */
      enabled: true,
      count,
      path: path || null,
      updated_at: updatedAt,
      age_hours: ageHours,
      stale: res ? res.stale === true : true,
      note: path === ''
        ? '未找到 KEV 目录；命中只作优先级提示，不阻断开工'
        : (count > 0
          ? '上次更新 ' + (ageHours === null ? '未知' : Math.round(ageHours) + ' 小时前') + '；命中只作优先级提示，不阻断开工'
          : '文件在但读不出条目；命中只作优先级提示，不阻断开工'),
    }
  }

  /**
   * 资源状态。
   *
   * `stale` 与 `missing` 分开报：过期是「该更新了」，缺失是「根本没有」——
   * 两者对下一步的影响完全不同（前者可以继续用，后者用不了）。
   */
  intelStatus() {
    const out = []
    let staleCount = 0
    let missingCount = 0
    for (const res of RedteamStore.INTEL_RESOURCES) {
      const paths = this.#intelPaths(res.key)
      let found = null
      for (const p of paths) {
        try {
          if (!existsSync(p)) continue
          const st = statSync(p)
          /* kind=dir 时目录本身也可能「新」，但真正有意义的是里面最近改过的文件；
             这里只取目录 mtime —— 深入遍历会让一个读探针变成慢操作。 */
          found = { path: p, mtime: st.mtime, size: st.size, is_dir: st.isDirectory() }
          break
        } catch { /* 权限不足就当没找到 */ }
      }
      if (found === null) {
        missingCount += 1
        /* [dsh-purge-plus] 缺失 ≠ 过期：这里曾经 stale:true 而 stale_count 不数它，
           于是同一个响应里 stale_count=0 与 resources[].stale=true 各说各话，
           任何按 resources.filter(r=>r.stale) 统计的调用方都会算出 1。 */
        out.push({
          key: res.key, label: res.label, kind: res.kind, exists: false,
          path: paths[0] || '', age_days: null, stale_after_days: res.stale_days,
          stale: false, missing: true,
        })
        continue
      }
      const ageDays = Math.max(0, Math.round((Date.now() - found.mtime.getTime()) / 86400000))
      const stale = ageDays > res.stale_days
      if (stale) staleCount += 1
      out.push({
        key: res.key, label: res.label, kind: res.kind, exists: true,
        path: found.path, mtime: found.mtime.toISOString(),
        size: found.size, is_dir: found.is_dir,
        age_days: ageDays, stale_after_days: res.stale_days,
        stale, missing: false,
      })
    }
    return {
      resources: out,
      stale_count: staleCount,
      missing_count: missingCount,
      /* [dsh-purge-plus] 与 safe 同形的两段计数摘要。老调用方只读 resources[]，
         不受影响；环境适配页读这两个对象显示「N 个模板 / N 条 KEV」。 */
      templates: this.#intelTemplatesSummary(out.find((r) => r.key === 'nuclei')),
      kev: this.#intelKevSummary(out.find((r) => r.key === 'kev')),
      /* 一句话结论，界面徽章直接用，不再让每个调用方自己拼 */
      badge: missingCount > 0
        ? '缺 ' + missingCount + ' 项资源'
        : staleCount > 0 ? staleCount + ' 项资源过期' : '资源新鲜',
    }
  }

  /**
   * 重新探一遍并记录检查时间。不下载、不联网、不改任何资源文件。
   *
   * [dsh-purge-plus] 名字里的 refresh 容易被读成「把资源刷新成新的」——safe 的同名 op
   * 就是真去拉 KEV 与 nuclei 模板。这里必须把「做了什么」写进返回值，否则调用方
   * （工具 action=refresh、面板刷新按钮）会以为资源更新过了，而磁盘上一个字节没变。
   * 真下载是 intelUpdate（target=kev/nuclei/all），它有自己的出口纪律与 update-log。
   */
  intelRefresh() {
    const checkedAt = nowIso()
    try {
      mkdirSync(join(this.root, 'intel'), { recursive: true })
      writeFileSync(join(this.root, 'intel', '.checked'), checkedAt + '\n', 'utf8')
    } catch { /* 写不进标记不影响结论 */ }
    const status = this.intelStatus()
    return Object.assign({
      checked_at: checkedAt,
      probe_only: true,
      downloaded: false,
      note: '只重新探测本地资源状态，未发起任何下载；要真下载请用 intelUpdate（target=kev/nuclei/all）',
    }, status)
  }
