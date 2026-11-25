        /* [dsh-purge-plus] 结构化回报：宿主把子智能体的最后一条消息放在
           info.lastAssistantMessage。在这里解析并落库，「谁在等我、等什么」才
           变成可查询事实（见 store.attentionQueue）。解析不到就不写 —— 不猜。
           回报说在等人/受阻（blocked / waiting）时顺手 parkAgent 让出并发名额：
           它没在干活，占着名额等于把并发锁死 —— 与 safe 2.0.2 同口径
           （safe `tools.js:555`，本包原先漏了这一步，见 docs/audit/AUDIT-3WAY §4）。 */
        try {
          const reportText = textOfAssistantMessage(info && info.lastAssistantMessage)
          const parsed = reportText === '' ? null : store.parseAgentReport(reportText)
          if (parsed) {
            const bound = bindings.get(rootId) ?? bindings.get(String(parentSession && parentSession.id || ''))
            if (bound !== undefined) {
              store.recordAgentReport(bound, {
                session_id: childId,
                parent_session: rootId,
                role: parsed.role ?? null,
                label: info && (info.label || info.id) ? String(info.label || info.id) : null,
                status: parsed.status,
                blocked_reason: parsed.blocked_reason,
                needs: parsed.needs,
                summary: reportText.slice(-1500),
              })
            }
            /* 让出名额：状态是「在等人给资源」时挂起，并发按挂起数扣减 */
            if (parsed.status === 'blocked' || parsed.status === 'waiting') parkAgent(rootId, childId)
          }
        } catch { /* 解析/落库失败不影响名额释放 */ }
