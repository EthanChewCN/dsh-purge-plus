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
      return [
        home ? join(home, '.local', 'nuclei-templates') : '',
        home ? join(home, 'nuclei-templates') : '',
      ].filter(Boolean)
    }
    return [
      join(this.root, 'wordlists'),
      home ? join(home, '.dsh', 'redteam', 'wordlists') : '',
    ].filter(Boolean)
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
        out.push({
          key: res.key, label: res.label, kind: res.kind, exists: false,
          path: paths[0] || '', age_days: null, stale_after_days: res.stale_days,
          stale: true, missing: true,
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
      /* 一句话结论，界面徽章直接用，不再让每个调用方自己拼 */
      badge: missingCount > 0
        ? '缺 ' + missingCount + ' 项资源'
        : staleCount > 0 ? staleCount + ' 项资源过期' : '资源新鲜',
    }
  }

  /** 重新探一遍并记录检查时间。不下载、不联网、不改任何资源文件。 */
  intelRefresh() {
    const checkedAt = nowIso()
    try {
      mkdirSync(join(this.root, 'intel'), { recursive: true })
      writeFileSync(join(this.root, 'intel', '.checked'), checkedAt + '\n', 'utf8')
    } catch { /* 写不进标记不影响结论 */ }
    return Object.assign({ checked_at: checkedAt }, this.intelStatus())
  }
