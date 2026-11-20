          eng ? h('button', {
            className: 'rt-btn',
            title: '删除当前靶标：整个目录移到 ~/.dsh/redteam/.trash，可手动 mv 回来',
            onClick: () => {
              const meta = engagements.find((x) => x.id === eng)
              const label = (meta && meta.name) || eng
              const ok = globalThis.confirm('删除靶标「' + label + '」？\n\n'
                + '整个目录（含该靶标的资产 / 漏洞 / 凭据 / 报告）会移到 ~/.dsh/redteam/.trash/<id>-<时间戳>，\n'
                + '数据可恢复；本会话绑定与「当前靶标」指针一并清掉。')
              if (!ok) return
              api({ op: 'deleteEngagement', engagement: eng, confirm: true }).then((r) => {
                if (!r || r.ok === false) { globalThis.alert('删除失败：' + ((r && r.error) || '未知错误')); return }
                setEng('')
                refreshAll()
              }, (e) => globalThis.alert('删除失败：' + String(e)))
            },
          }, '删除靶标') : null,
