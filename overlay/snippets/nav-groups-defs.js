      /* [dsh-purge-plus] P4 一级分组。P4 时是 5 组，P6 接上态势首页后是 6 组。
         key 只用于 class 与稳定身份，label 是给人看的。
         刻意不照抄 safe 的分组表：safe 把 artifacts 放在「资源中心」，但在这份产物里
         「凭据与文件」是战果的产物而不是采集资源，跟 findings 放一起更顺手。 */
      const TAB_GROUPS = [
        { key: 'overview', label: '工作总览', tabs: ['overview'] },
        { key: 'assets', label: '资产台账', tabs: ['assets'] },
        { key: 'collaboration', label: '协同进度', tabs: ['agents', 'team'] },
        { key: 'results', label: '成果与报告', tabs: ['findings', 'artifacts', 'evidence', 'chain', 'scores', 'report'] },
        { key: 'resources', label: '资源中心', tabs: ['sessions', 'knowledge', 'skills'] },
        { key: 'settings', label: '环境与设置', tabs: ['env'] },
      ]
      /* 历史页签名：按钮文案、工具输出、深链里都还在写这些名字。不做别名的话
         groupOf('testing') 会落到第一组，看起来像分组算错了。 */
      const TAB_ALIASES = { testing: 'assets', attackfiles: 'artifacts', prompts: 'agents' }
      const groupOf = (tab) => TAB_GROUPS.find((g) => g.tabs.indexOf(TAB_ALIASES[tab] || tab) !== -1) || TAB_GROUPS[0]
      const activeGroup = groupOf(st.tab)
      /* 当前页按别名归一后再比，否则从「回到资产测绘」这类入口进来时二级页签一个都不亮 */
      const normalizedTab = TAB_ALIASES[st.tab] || st.tab
      const groupHasUnread = (g) => g.tabs.some((t) => unreadOf(t))
      const goTab = (tab) => {
        markTabSeen(tab)
        setUI({ tab })
        /* 强制当前页重新取数，避免切页后仍显示上一页缓存视觉 */
        setRefreshKey((k) => k + 1)
      }
      /* 点分组：当前页已在本组就不跳，否则落到本组第一页 ——
         否则点一下「成果与报告」会把正在看的漏洞战果甩掉。 */
      const activateGroup = (g) => goTab(g.tabs.indexOf(normalizedTab) >= 0 ? normalizedTab : g.tabs[0])
      /* [dsh-purge-plus] P26 外部入口跳页：待办角标挂在 shell.overlay，拿不到这里的
         setUI / setRefreshKey，用一次自定义事件把「去智能体页」接过来。
         刻意不用 window 全局函数：面板内嵌与独立窗口是两个 dock 实例，全局函数会被
         后挂载的那个覆盖，点一下跳到看不见的那个里去。 */
      React.useEffect(() => {
        const onGo = (event) => {
          const tab = event && event.detail
          if (typeof tab === 'string' && tab) goTab(tab)
        }
        window.addEventListener('dsh-purge-plus:goto-tab', onGo)
        return () => window.removeEventListener('dsh-purge-plus:goto-tab', onGo)
      }, [eng, digest])
      /* 分组行是 tablist，方向键/Home/End 要能走。缺了这段，键盘用户只能 Tab 一路穿过去。 */
      const navigateGroupKey = (event, index) => {
        let next
        if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = TAB_GROUPS.length - 1
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % TAB_GROUPS.length
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + TAB_GROUPS.length) % TAB_GROUPS.length
        else return
        event.preventDefault()
        activateGroup(TAB_GROUPS[next])
        try { event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus() } catch { /* ignore */ }
      }
