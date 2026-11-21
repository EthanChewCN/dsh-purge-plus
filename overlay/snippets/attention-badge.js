  /* [dsh-purge-plus] P26 待办角标（右下角常驻胶囊 + 展开卡）。
   *
   * 为什么不再只做「智能体页的一张卡」：那张卡要「打开演练台 → 切到智能体页」才看得见，
   * 而「有人在等我」恰恰是最不该需要主动去找的信息。safe 的做法是悬浮胶囊，但它挂在
   * 插件主面板里，面板没打开就看不见；这里挂到 shell.overlay —— 只要宿主外壳在，
   * 无论当前在哪一页、哪个会话，都看得见。
   *
   * 刻意不做的三件事：
   *   1. 不自动弹窗、不抢焦点：角标只提示，打断是另一回事（用户可能正在打字）。
   *   2. 不自动收口（不自动 attentionAck）：「这条处理完没有」只有人能判，
   *      自动收口会把「我还没答」变成「已处理」，比不提示更坏。
   *   3. document.hidden 时不轮询：后台标签页每 30 秒打一次本地 HTTP 是白烧电，
   *      切回来时立刻补一次。
   *
   * 本文件用 2 空格缩进：面板产物的适配器会整体减 2 空格，正好落到顶层（列 0），
   * 与 PanelOverlays 同级。不要给它加更多缩进。
   */
  const ATTN_LS_KEY = "dsh-purge-plus:attention-badge"
  const ATTN_GOTO_EVENT = "dsh-purge-plus:goto-tab"
  const ATTN_POLL_MS = 30000
  const ATTN_SNOOZE_MS = 10 * 60 * 1000
  const ATTN_SNOOZE_URGENT_MS = 3 * 60 * 1000
  const ATTN_STATUS = { waiting: "等解答", ready: "等验收", blocked: "受阻", failed: "失败", progress: "在跑" }
  const ATTN_CSS = ".dshpp-attn-wrap{position:fixed;z-index:12040;font:inherit;font-size:12px;" +
    "line-height:1.5;color:var(--dsw-alias-label-primary,#171717);pointer-events:auto}" +
    ".dshpp-attn-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;" +
    "cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;" +
    "border:1px solid var(--dsw-alias-border-l1,#ddd);background:var(--dsw-alias-bg-layer-1,#fff);" +
    "box-shadow:0 6px 18px rgb(0 0 0 / 18%);font:inherit;color:inherit}" +
    ".dshpp-attn-pill:hover{border-color:var(--dsw-alias-border-l2,#bbb)}" +
    ".dshpp-attn-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4775ed);outline-offset:2px}" +
    ".dshpp-attn-pill.urgent{color:var(--dsw-alias-state-error-primary,#d33)}" +
    ".dshpp-attn-pill.idle{opacity:.72}" +
    ".dshpp-attn-dot{width:7px;height:7px;border-radius:999px;background:currentColor;flex:none}" +
    ".dshpp-attn-num{font-variant-numeric:tabular-nums;font-weight:600}" +
    ".dshpp-attn-card{position:absolute;bottom:calc(100% + 8px);right:0;width:min(340px,calc(100vw - 24px));" +
    "max-height:min(60vh,420px);overflow:auto;box-sizing:border-box;padding:12px;border-radius:12px;" +
    "border:1px solid var(--dsw-alias-border-l1,#ddd);background:var(--dsw-alias-bg-layer-1,#fff);" +
    "box-shadow:0 16px 44px rgb(0 0 0 / 26%);cursor:default;text-align:left}" +
    ".dshpp-attn-card.left{right:auto;left:0}" +
    ".dshpp-attn-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600}" +
    ".dshpp-attn-note{margin:0 0 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#666)}" +
    ".dshpp-attn-row{display:flex;gap:6px;align-items:baseline;padding:5px 0;font-size:11.5px;" +
    "border-top:1px solid var(--dsw-alias-border-l1,#eee)}" +
    ".dshpp-attn-row:first-of-type{border-top:0}" +
    ".dshpp-attn-tag{flex:none;font-size:10.5px;padding:0 5px;border-radius:999px;" +
    "border:1px solid var(--dsw-alias-border-l1,#ddd);color:var(--dsw-alias-label-secondary,#666)}" +
    ".dshpp-attn-tag.bad{color:var(--dsw-alias-state-error-primary,#d33);" +
    "border-color:var(--dsw-alias-state-error-primary,#d33)}" +
    ".dshpp-attn-who{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".dshpp-attn-why{color:var(--dsw-alias-label-secondary,#666);word-break:break-word}" +
    ".dshpp-attn-ops{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}" +
    ".dshpp-attn-btn{font:inherit;font-size:11.5px;min-height:26px;padding:3px 9px;border-radius:7px;" +
    "cursor:pointer;border:1px solid var(--dsw-alias-border-l1,#ddd);background:transparent;color:inherit}" +
    ".dshpp-attn-btn:hover{border-color:var(--dsw-alias-border-l2,#bbb)}" +
    ".dshpp-attn-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4775ed);outline-offset:2px}" +
    ".dshpp-attn-msg{margin-top:8px;font-size:11px;color:var(--dsw-alias-label-secondary,#666)}"
  const attnReadPrefs = () => {
    try {
      const raw = window.localStorage.getItem(ATTN_LS_KEY)
      const obj = raw ? JSON.parse(raw) : null
      return obj && typeof obj === "object" ? obj : {}
    } catch { return {} }
  }
  const attnWritePrefs = (patch) => {
    try {
      window.localStorage.setItem(ATTN_LS_KEY, JSON.stringify(Object.assign(attnReadPrefs(), patch)))
    } catch { /* 隐私模式 / 配额满会抛：角标退化成「不记忆」，功能本身不受影响 */ }
  }
  const attnShort = (s) => {
    const t = String(s || "")
    return t.length > 14 ? t.slice(0, 8) + "…" + t.slice(-4) : t
  }
  const attnName = (it) => it.label || it.role || attnShort(it.session_id)
  /* 整理成一段能直接发给主会话的话：只说事实（谁、什么状态、缺什么），
     不替人写结论 —— 「该怎么答」是人的判断，不是角标该替他想的事。 */
  const attnPromptText = (items, pending) => {
    const lines = ["以下子智能体在等我的答复，请逐条给结论（缺信息就明确说要什么）："]
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i]
      const head = (i + 1) + ". [" + (ATTN_STATUS[it.status] || it.status) + "] " + attnName(it)
      const why = it.reason ? "：" + it.reason : ""
      const need = Array.isArray(it.needs) && it.needs.length ? "；需要：" + it.needs.join("、") : ""
      lines.push(head + why + need)
    }
    if (pending > 0) lines.push("另有 " + pending + " 个覆盖度缺口待派单。")
    return lines.join("\n")
  }

  function AttentionBadge() {
    const [data, setData] = React.useState(null)
    const [open, setOpen] = React.useState(false)
    const [snoozeUntil, setSnoozeUntil] = React.useState(() => Number(attnReadPrefs().snoozeUntil) || 0)
    const [pos, setPos] = React.useState(() => {
      const p = attnReadPrefs().pos
      return p && typeof p.x === "number" && typeof p.y === "number" ? p : null
    })
    const [msg, setMsg] = React.useState("")
    const [nowMs, setNowMs] = React.useState(() => Date.now())
    const dragRef = React.useRef(null)
    const posRef = React.useRef(pos)
    const boxRef = React.useRef(null)

    React.useEffect(() => {
      let alive = true
      const readSession = () => {
        try { return currentSessionId(host2 && host2.sessions) || "" } catch { return "" }
      }
      const tick = () => {
        if (typeof document !== "undefined" && document.hidden) return
        /* 带 session：多会话并行时「我在等谁」按本会话绑定的靶标算，
           不带就会退到全局指针，把别人的等待算到自己头上。 */
        api({ op: "attention", session: readSession(), limit: 5 }).then((r) => {
          if (!alive) return
          /* 读取失败保留上一次结果：宁可显示一份旧队列，也不假装「没人等」。 */
          if (!r || r.ok === false) return
          setData(r)
        }, () => { /* 网络异常：等下一轮 */ })
      }
      tick()
      const timer = window.setInterval(tick, ATTN_POLL_MS)
      const beat = window.setInterval(() => setNowMs(Date.now()), ATTN_POLL_MS)
      const onVisible = () => { if (!document.hidden) tick() }
      document.addEventListener("visibilitychange", onVisible)
      return () => {
        alive = false
        window.clearInterval(timer)
        window.clearInterval(beat)
        document.removeEventListener("visibilitychange", onVisible)
      }
    }, [])

    /* 点外面收起。用捕获阶段：面板内部大量 stopPropagation，冒泡阶段会收不到。 */
    React.useEffect(() => {
      if (!open) return undefined
      const onDown = (ev) => {
        const box = boxRef.current
        if (box && ev.target && box.contains(ev.target)) return
        setOpen(false)
      }
      document.addEventListener("pointerdown", onDown, true)
      return () => document.removeEventListener("pointerdown", onDown, true)
    }, [open])

    const items = (data && data.items) || []
    const total = data ? Number(data.total || 0) : 0
    const pending = data ? Number(data.pending_coverage || 0) : 0
    const urgent = items.some((it) => it.status === "blocked" || it.status === "failed")
    const snoozed = snoozeUntil > nowMs
    if (!total && !pending) return null

    const goAgents = () => {
      try { setDock({ open: true, tab: "drill" }) } catch { /* 面板没挂 dock 时忽略 */ }
      const fire = () => {
        try { window.dispatchEvent(new CustomEvent(ATTN_GOTO_EVENT, { detail: "agents" })) } catch { /* 老 webview 没有 CustomEvent 构造器 */ }
      }
      fire()
      /* 演练台可能还没挂载：挂载后再补一枪。两枪都空也无害（没监听就没人接）。 */
      window.setTimeout(fire, 160)
      setOpen(false)
    }
    const fillInput = () => {
      const text = attnPromptText(items, pending)
      let sid = ""
      try { sid = currentSessionId(host2 && host2.sessions) || "" } catch { sid = "" }
      let ok = false
      try { ok = hostSetDraft(sid, text) } catch { ok = false }
      if (ok) {
        setMsg("已填入输入框（没有发出去）")
        setOpen(false)
        return
      }
      /* 拿不到会话写入口时退到剪贴板 —— 不是「失败」，是换一条路把同一段话交到人手上。 */
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(text)
          setMsg("当前会话不可写，已复制到剪贴板")
          return
        }
      } catch { /* 无剪贴板权限 */ }
      setMsg("当前会话不可写，也没拿到剪贴板权限")
    }
    const snooze = () => {
      const until = Date.now() + (urgent ? ATTN_SNOOZE_URGENT_MS : ATTN_SNOOZE_MS)
      setSnoozeUntil(until)
      setNowMs(Date.now())
      attnWritePrefs({ snoozeUntil: until })
      setOpen(false)
    }

    const onPointerDown = (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return
      const box = boxRef.current
      const rect = box && box.getBoundingClientRect ? box.getBoundingClientRect() : null
      dragRef.current = {
        startX: ev.clientX, startY: ev.clientY,
        left: rect ? rect.left : 0, top: rect ? rect.top : 0,
        moved: false,
      }
      try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* 部分 webview 不支持 */ }
    }
    const onPointerMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      /* 4px 死区：手指/触控板在按下时的微小抖动不该把「点一下」变成「拖一下」。 */
      if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      d.moved = true
      const box = boxRef.current
      const w = box ? box.offsetWidth : 120
      const hgt = box ? box.offsetHeight : 32
      const nx = Math.min(Math.max(4, d.left + dx), Math.max(4, window.innerWidth - w - 4))
      const ny = Math.min(Math.max(4, d.top + dy), Math.max(4, window.innerHeight - hgt - 4))
      posRef.current = { x: nx, y: ny }
      setPos(posRef.current)
    }
    const onPointerUp = (ev) => {
      const d = dragRef.current
      dragRef.current = null
      try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch { /* 同上 */ }
      if (!d) return
      if (d.moved) {
        /* 只在抬手时落盘：move 里每帧写 localStorage 会把拖拽拖成卡顿。 */
        attnWritePrefs({ pos: posRef.current })
        return
      }
      setOpen((v) => !v)
    }
    const onKeyDown = (ev) => {
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
        ev.preventDefault()
        setOpen((v) => !v)
      } else if (ev.key === "Escape") {
        setOpen(false)
      }
    }

    const label = total > 0
      ? (snoozed ? String(total) : total + " 人在等")
      : (pending + " 缺口待派")
    const anchor = pos ? { left: pos.x + "px", top: pos.y + "px" } : { right: 16, bottom: 16 }

    return h(React.Fragment, null,
      h("style", null, ATTN_CSS),
      h("div", { ref: boxRef, className: "dshpp-attn-wrap", style: anchor },
        open ? h("div", { className: "dshpp-attn-card" + (pos ? " left" : ""), role: "dialog", "aria-label": "现在在等谁" },
          h("div", { className: "dshpp-attn-head" },
            h("span", null, "现在在等谁"),
            h("span", { style: { marginLeft: "auto", fontSize: 11, fontWeight: 400, color: "var(--dsw-alias-label-secondary,#666)" } },
              total + " 条")),
          h("p", { className: "dshpp-attn-note" }, (data && data.note) || ""),
          items.map((it) => h("div", { className: "dshpp-attn-row", key: String(it.session_id) + ":" + String(it.at || "") },
            h("span", { className: "dshpp-attn-tag" + (it.status === "blocked" || it.status === "failed" ? " bad" : "") },
              ATTN_STATUS[it.status] || it.status),
            h("span", { className: "dshpp-attn-who" }, attnName(it)),
            it.reason || (Array.isArray(it.needs) && it.needs.length)
              ? h("span", { className: "dshpp-attn-why" }, it.reason || it.needs.join("、"))
              : null)),
          pending > 0
            ? h("p", { className: "dshpp-attn-note", style: { marginTop: 8 } },
              "另有 " + pending + " 个覆盖度缺口：队列空了不等于打完了。")
            : null,
          h("div", { className: "dshpp-attn-ops" },
            h("button", { type: "button", className: "dshpp-attn-btn", onClick: goAgents }, "去智能体页"),
            h("button", { type: "button", className: "dshpp-attn-btn", onClick: fillInput }, "填入输入框"),
            h("button", { type: "button", className: "dshpp-attn-btn", onClick: snooze },
              urgent ? "稍后 3 分钟" : "稍后 10 分钟")),
          msg ? h("div", { className: "dshpp-attn-msg" }, msg) : null)
          : null,
        h("button", {
          type: "button",
          className: "dshpp-attn-pill" + (urgent ? " urgent" : "") + (snoozed ? " idle" : ""),
          title: snoozed ? "已稍后：点开仍可看" : "点开看谁在等；可拖到任意位置",
          "aria-expanded": open ? "true" : "false",
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onKeyDown,
        },
          h("span", { className: "dshpp-attn-dot" }),
          h("span", { className: "dshpp-attn-num" }, String(total > 0 ? total : pending)),
          snoozed && total > 0 ? null : h("span", null, total > 0 ? "人在等" : "缺口待派"))))
  }
