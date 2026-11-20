        /* [dsh-purge-plus] 结构化回报：宿主把子智能体的最后一条消息放在
           info.lastAssistantMessage。在这里解析并落库，「谁在等我、等什么」才
           变成可查询事实（见 store.attentionQueue）。解析不到就不写 —— 不猜。
           与 safe 的差异：safe 还会在 waiting/blocked 时 parkAgent 让出并发名额；
           本包没有 parked 概念（名额只按注册表算），所以这一段不移植。 */
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
          }
        } catch { /* 解析/落库失败不影响名额释放 */ }
