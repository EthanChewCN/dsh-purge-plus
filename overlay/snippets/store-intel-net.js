  /* ---------- [dsh-purge-plus] P21 情报资源刷新（真下载） ---------- */
  //
  // 与 intelStatus 的分工必须清楚：
  //   intelStatus —— 只读探针，**永不联网**（看一眼状态不该变成一次出口动作）
  //   intelUpdate —— 真发请求、真落盘，只在显式调用时执行
  //
  // 四条纪律（缺一条就会变成"看起来更新了、其实写坏了"）：
  //   ① 大小上限 + 超时：不设上限的下载会把磁盘写满，不设超时会把请求挂死
  //   ② 先落到临时文件、校验通过再 rename：中途失败不留半截 JSON
  //   ③ 校验内容形状（KEV 必须有 vulnerabilities 数组且条数 > 0）：
  //      CISA 返回一页 HTML 错误页时，`JSON.parse` 会抛，但 200 + `{}` 不会
  //   ④ 每次更新记一行 update-log.jsonl：谁在什么时候把什么换成了什么版本

  static INTEL_SOURCES = {
    kev: {
      label: 'CISA KEV',
      url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      max_bytes: 48 * 1024 * 1024,
      timeout_ms: 120000,
    },
    nuclei: {
      label: 'nuclei-templates',
      url: 'https://codeload.github.com/projectdiscovery/nuclei-templates/tar.gz/refs/heads/main',
      max_bytes: 256 * 1024 * 1024,
      timeout_ms: 300000,
    },
  }

  /** 带大小上限与超时的 GET。超上限立刻中断读取，不把内存吃满。 */
  async #fetchCapped(url, maxBytes, timeoutMs) {
    if (typeof fetch !== 'function') throw new Error('当前 Node 运行时没有全局 fetch，无法下载')
    const ac = new AbortController()
    const timer = setTimeout(() => { try { ac.abort() } catch { /* 已结束 */ } }, timeoutMs)
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'dsh-purge-plus/intel', accept: '*/*' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : ''))
      const chunks = []
      let total = 0
      const reader = res.body.getReader()
      for (;;) {
        const step = await reader.read()
        if (step.done) break
        const chunk = step.value
        total += chunk.length
        if (total > maxBytes) {
          try { await reader.cancel() } catch { /* 已关闭 */ }
          throw new Error('响应超过上限 ' + maxBytes + ' 字节（可能是错误的镜像或重定向到 HTML）')
        }
        chunks.push(Buffer.from(chunk))
      }
      return {
        buf: Buffer.concat(chunks),
        bytes: total,
        etag: res.headers.get('etag'),
        last_modified: res.headers.get('last-modified'),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 记一行更新日志。写不进不影响本次更新的结论。 */
  #intelLog(entry) {
    try {
      const dir = join(this.root, 'intel')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'update-log.jsonl'), JSON.stringify(Object.assign({ at: nowIso() }, entry)) + '\n', 'utf8')
    } catch { /* 日志失败不影响主流程 */ }
  }

  /**
   * 刷新一个资源。
   *
   * @param target - `kev` / `nuclei` / `all`
   * @param options - `{ dest?: string, dry_run?: boolean }`
   * @returns `{ ok, results: [{ key, action, ... }] }`；单个资源失败不影响另一个。
   */
  async intelUpdate(target, options = {}) {
    const want = String(target || 'all').trim()
    const keys = want === 'all' ? ['kev', 'nuclei'] : [want]
    const results = []
    for (const key of keys) {
      if (key === 'kev') results.push(await this.#updateKev(options))
      else if (key === 'nuclei') results.push(await this.#updateNuclei(options))
      else if (key === 'wordlists') {
        results.push({ key: 'wordlists', action: 'skipped', reason: '字典库没有权威上游，不做自动下载（放自己的字典到 wordlists/ 即可）' })
      } else {
        results.push({ key: key, action: 'failed', error: '未知资源：' + key + '（kev/nuclei/wordlists/all）' })
      }
    }
    return { results: results, status: this.intelStatus() }
  }

  async #updateKev(options = {}) {
    const src = RedteamStore.INTEL_SOURCES.kev
    const dest = options.dest || this.#intelPaths('kev')[0]
    try {
      const got = await this.#fetchCapped(src.url, src.max_bytes, src.timeout_ms)
      let parsed = null
      try { parsed = JSON.parse(got.buf.toString('utf8')) } catch (e) {
        throw new Error('返回的不是 JSON（' + String((e && e.message) || e) + '），可能是错误页')
      }
      const list = parsed && Array.isArray(parsed.vulnerabilities) ? parsed.vulnerabilities : null
      if (list === null) throw new Error('JSON 里没有 vulnerabilities 数组 —— 形状不对，拒绝落盘')
      if (list.length === 0) throw new Error('vulnerabilities 是空数组 —— 拒绝用空目录覆盖已有数据')
      const shapeOk = list.every((v) => v && typeof v.cveID === 'string' && v.cveID !== '')
      if (!shapeOk) throw new Error('vulnerabilities 里有条目缺 cveID —— 形状不对，拒绝落盘')
      const sha = createHash('sha256').update(got.buf).digest('hex')
      if (options.dry_run === true) {
        return { key: 'kev', action: 'dry-run', bytes: got.bytes, count: list.length, sha256: sha, dest: dest, catalog: parsed.catalogVersion || null }
      }
      mkdirSync(dirname(dest), { recursive: true })
      const tmp = dest + '.tmp-' + process.pid
      writeFileSync(tmp, got.buf)
      renameSync(tmp, dest)
      /* meta 路径必须与数据文件**不同**：dest 不以 .json 结尾时，
         `dest.replace(/\.json$/,'.meta.json')` 会返回 dest 本身 —— 48MB 数据被
         11 字节元数据覆盖，函数还返回 updated。 */
      const metaPath = /\.json$/i.test(dest) ? dest.replace(/\.json$/i, '.meta.json') : dest + '.meta.json'
      writeFileSync(metaPath, JSON.stringify({
        source: src.url, fetched_at: nowIso(), bytes: got.bytes, count: list.length,
        sha256: sha, etag: got.etag, last_modified: got.last_modified,
        catalog_version: parsed.catalogVersion || null, date_released: parsed.dateReleased || null,
      }, null, 2), 'utf8')
      this.#intelLog({ key: 'kev', action: 'updated', bytes: got.bytes, count: list.length, sha256: sha, dest: dest })
      return {
        key: 'kev', action: 'updated', dest: dest, bytes: got.bytes, count: list.length,
        sha256: sha, catalog_version: parsed.catalogVersion || null,
        date_released: parsed.dateReleased || null,
      }
    } catch (e) {
      const error = String((e && e.message) || e)
      this.#intelLog({ key: 'kev', action: 'failed', error: error })
      return { key: 'kev', action: 'failed', error: error, dest: dest }
    }
  }

  async #updateNuclei(options = {}) {
    const src = RedteamStore.INTEL_SOURCES.nuclei
    const dest = options.dest || this.#intelPaths('nuclei')[0]
    try {
      if (!dest) throw new Error('找不到可写的模板目录（HOME 为空？）')
      /* 已经是 git 仓库就走增量拉取：几百 MB 的 tar 每次全量下载太浪费。 */
      if (existsSync(join(dest, '.git'))) {
        if (options.dry_run === true) return { key: 'nuclei', action: 'dry-run', mode: 'git', dest: dest }
        try {
          execFileSync('git', ['-C', dest, 'pull', '--ff-only'], { stdio: 'pipe', timeout: src.timeout_ms })
          const count = this.#countTemplates(dest)
          this.#intelLog({ key: 'nuclei', action: 'git-pull', dest: dest, templates: count })
          return { key: 'nuclei', action: 'updated', mode: 'git-pull', dest: dest, templates: count }
        } catch (e) {
          /* git 失败就退回整包下载 —— 但要说清是哪种方式成功的 */
          this.#intelLog({ key: 'nuclei', action: 'git-pull-failed', error: String((e && e.message) || e) })
        }
      }
      const got = await this.#fetchCapped(src.url, src.max_bytes, src.timeout_ms)
      if (got.bytes < 1024) throw new Error('下载内容过小（' + got.bytes + ' 字节），不像模板包')
      /* gzip 魔数：200 + HTML 错误页也会 > 1024 字节，靠 tar 报错太晚且文案难懂 */
      if (!(got.buf[0] === 0x1f && got.buf[1] === 0x8b)) throw new Error('下载内容不是 gzip（可能是错误页），拒绝解压')
      if (options.dry_run === true) return { key: 'nuclei', action: 'dry-run', mode: 'tar', bytes: got.bytes, dest: dest }
      const stage = join(this.root, 'intel', '.nuclei-stage-' + process.pid)
      rmSync(stage, { recursive: true, force: true })
      mkdirSync(stage, { recursive: true })
      /* 临时目录**无论成败都要清掉**：一个残留就是 ≤256MB，而且下次同名同 pid 还会撞上。 */
      try {
        const tarPath = join(stage, 'templates.tgz')
        writeFileSync(tarPath, got.buf)
        execFileSync('tar', ['-xzf', tarPath, '-C', stage], { stdio: 'pipe', timeout: src.timeout_ms })
        const entries = readdirSync(stage, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '.git')
        if (entries.length !== 1) throw new Error('解压后应当恰好一个顶层目录，实际 ' + entries.length + ' 个')
        const unpacked = join(stage, entries[0].name)
        if (!existsSync(join(unpacked, 'http')) && !existsSync(join(unpacked, 'network'))) {
          throw new Error('解压目录里没有 http/ 或 network/ 子目录，不像是 nuclei 模板包')
        }
        mkdirSync(dirname(dest), { recursive: true })
        /* 覆盖策略：先把旧的挪走再换新的，任何一步失败都回滚。
           stage 在 store.root 下、dest 可能在 ~/.local —— 跨挂载点时 rename 会 EXDEV，
           所以换目录失败要退到递归拷贝（cpSync），不能直接判失败。 */
        const backup = dest + '.bak-' + Date.now()
        let moved = false
        try {
          if (existsSync(dest)) { renameSync(dest, backup); moved = true }
          try {
            renameSync(unpacked, dest)
          } catch (e) {
            if (e && (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'EACCES')) {
              cpSync(unpacked, dest, { recursive: true })
            } else throw e
          }
        } catch (e) {
          if (moved) { try { renameSync(backup, dest) } catch { /* 回滚失败只能如实报 */ } }
          throw e
        }
        if (moved) rmSync(backup, { recursive: true, force: true })
        const count = this.#countTemplates(dest)
        this.#intelLog({ key: 'nuclei', action: 'tar', dest: dest, bytes: got.bytes, templates: count })
        return { key: 'nuclei', action: 'updated', mode: 'tar', dest: dest, bytes: got.bytes, templates: count }
      } finally {
        try { rmSync(stage, { recursive: true, force: true }) } catch { /* 清不掉只能留着，但要说清 */ }
      }
    } catch (e) {
      const error = String((e && e.message) || e)
      this.#intelLog({ key: 'nuclei', action: 'failed', error: error })
      return { key: 'nuclei', action: 'failed', error: error, dest: dest }
    }
  }

  /** 数模板：只看顶层 yaml 文件，且必须有 `id:` 行（排除 .github 里的 CI 配置）。 */
  #countTemplates(dir, depth = 0) {
    let n = 0
    if (depth > 6) return 0
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { n += this.#countTemplates(full, depth + 1); continue }
      if (!/\.ya?ml$/i.test(entry.name)) continue
      try {
        const head = readFileSync(full, 'utf8').slice(0, 400)
        if (/^id:\s*\S+/m.test(head)) n += 1
      } catch { /* 读不到不算模板 */ }
    }
    return n
  }
