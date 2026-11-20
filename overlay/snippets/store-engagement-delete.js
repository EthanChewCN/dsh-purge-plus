  /**
   * [dsh-purge-plus] 删除一个靶标工作区。
   *
   * 为什么是「移到回收目录」而不是 rm -rf：
   *   一个靶标目录里躺着它自己的 knowledge.db（资产 / 漏洞 / 凭据 / 得分 / 报告），
   *   删掉就真的没有了。演练收尾时误点一次，代价是整场成果消失。
   *   所以这里只 rename 到 `<root>/.trash/<id>-<时间戳>`，并把恢复命令回给调用方。
   *
   * 顺带必须清掉的三处引用（不清就会留下「指向已删靶标的绑定」）：
   *   ① sessions.json 里绑到这个靶标的会话 —— 否则重启后面板会跟到一个不存在的靶标
   *   ② current 指针 —— 否则 activeEngagementId 回退到别的靶标，界面像「自己跳了」
   *   ③ 进程内已打开的 sqlite 句柄 —— 不关掉，rename 在部分文件系统上会失败
   *
   * @param id - 靶标 id（slug）。
   * @returns `{ ok, id, trashed, unbound, current_cleared, recover }`；不存在时 `{ ok:false }`。
   */
  deleteEngagement(id) {
    /* 先判空再 slugify：slugify('') 会兜底生成一个 `engagement-<时间戳>` 的假 id，
       于是「没传 id」会被报成 not found，而不是「你忘了传」—— 报错指错方向。 */
    const raw = String(id === undefined || id === null ? '' : id).trim()
    if (!raw) return { ok: false, error: 'deleteEngagement 需要靶标 id' }
    const lid = slugify(raw)
    if (!lid) return { ok: false, error: 'deleteEngagement 需要靶标 id' }
    const dir = this.dirOf(lid)
    if (!existsSync(dir)) return { ok: false, error: 'engagement not found: ' + lid }
    /* 句柄先关：Windows 上打开中的文件不能 rename；Linux/macOS 上留着也会让
       后续 rename 回去的目录指向一个已删除的 inode。 */
    try {
      const handle = this.handles && typeof this.handles.get === 'function' ? this.handles.get(lid) : null
      if (handle) {
        try { handle.close() } catch { /* 已经关了 */ }
        this.handles.delete(lid)
      }
    } catch { /* handles 不是 Map 时忽略 */ }
    const trashRoot = join(this.root, '.trash')
    mkdirSync(trashRoot, { recursive: true })
    const stamp = nowIso().replace(/[:.]/g, '-')
    const dest = join(trashRoot, lid + '-' + stamp)
    try {
      renameSync(dir, dest)
    } catch (e) {
      return { ok: false, error: '移到回收目录失败：' + String((e && e.message) || e) }
    }
    /* ① 清会话绑定 */
    let unbound = 0
    try {
      const all = this.sessionBindings()
      let changed = false
      for (const [key, value] of Object.entries(all)) {
        if (value && value.engagement === lid) { delete all[key]; changed = true; unbound += 1 }
      }
      if (changed) {
        atomicWriteSync(this.sessionBindingsPath(), JSON.stringify({ v: 1, agents: all }, null, 2))
      }
    } catch { /* 绑定表坏了不影响删除本身：读取侧本来就把它当加速器 */ }
    /* ② 清当前指针 */
    let currentCleared = false
    try {
      if (readFileSync(this.currentPath(), 'utf8').trim() === lid) {
        rmSync(this.currentPath(), { force: true })
        currentCleared = true
      }
    } catch { /* 没有指针文件时忽略 */ }
    return {
      ok: true, id: lid, trashed: dest, unbound, current_cleared: currentCleared,
      recover: 'mv "' + dest + '" "' + dir + '"',
    }
  }

