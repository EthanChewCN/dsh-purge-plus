        /* [dsh-purge-plus] P4 一级分组行。用 <button> 而不是 clickable：按钮天然支持
           Enter/Space，不需要再借 role=button 的键盘垫片。 */
        h('div', { className: 'rt-groups', role: 'tablist', 'aria-label': '功能区域' }, TAB_GROUPS.map((g, index) => h('button', {
          type: 'button', key: g.key,
          className: 'rt-group' + (activeGroup.key === g.key ? ' on' : ''),
          role: 'tab',
          'aria-selected': activeGroup.key === g.key ? 'true' : 'false',
          tabIndex: activeGroup.key === g.key ? 0 : -1,
          title: groupHasUnread(g) ? g.label + '：组内有新内容' : g.label,
          onClick: () => activateGroup(g),
          onKeyDown: (event) => navigateGroupKey(event, index),
        }, g.label, groupHasUnread(g) && activeGroup.key !== g.key
          ? h('span', { className: 'rt-tab-dot', 'aria-label': '有新内容' })
          : null))),
        h('div', { className: 'rt-tabs', role: 'tablist' }, tabs.filter((t) => activeGroup.tabs.indexOf(t[0]) >= 0).map((t) => {
