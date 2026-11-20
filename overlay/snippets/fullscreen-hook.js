/* [dsh-purge-plus] __RT_FULLSCREEN_BEGIN__ */
/* P5 站内全屏钩子 —— 移植自 safe 2.0.0 的 lib/ui-fullscreen.js，按本包形态裁剪。
 *
 * 为什么不再用 window.open('#redteam-full')：
 *   桌面端 window.open 开的是**一个裸浏览器窗口**，拿不到宿主的会话、
 *   主题变量和事件通道。用户点「全面浏览」等于把上下文丢在另一个窗口里，
 *   回到面板还得手动找回来。改成原地铺满，状态和靶标选择都留在同一棵树里。
 *
 * 为什么先置 CSS 状态、再请求原生全屏：
 *   requestFullscreen() 是异步的，而且可能在用户手势失效之后才被拒
 *   （webview、非用户触发、permissions policy）。先把 expanded 置 true，
 *   界面立刻铺满；原生批下来就再叠一层真全屏，被拒就安静留在 CSS 铺满。
 *   反过来写（等原生成功再铺）会在被拒时什么都不发生，用户以为按钮坏了。
 *
 * 为什么带 operation 计数和 pending 记录：
 *   用户会连点「进 / 出」，而浏览器对 requestFullscreen 的 resolve 顺序不保证。
 *   不记账就会出现「点了退出、界面退出了，浏览器随后才把全屏请求批下来」——
 *   于是退不出去，只能再点一次。计数让过期的请求结果一律丢弃。
 *
 * 为什么参数叫 RL 而不是 React：
 *   本文件同时喂给两份产物，面板那份的适配器会把 React 命名空间的调用
 *   改写成 import_react2.default。用形参名可以避开那次重写，
 *   免得函数体里出现两个不同的 React 来源。
 */

/**
 * parent 是否**包含着** node —— 同节点不算。
 *
 * 这个语义是刻意的，别图省事把同节点并进来：
 *   「子浮层占着全屏」= rtFullContains(target, current)
 *   「我自己占着全屏」= current === target
 * 两个判断的用途相反。合并成一个「同节点也算包含」会让 current === target 时
 * 被当成「有子浮层」，于是按 Escape 什么也不发生——全屏退不出去。
 */
function rtFullContains(parent, node) {
  if (!parent || !node || parent === node) return false
  return typeof parent.contains === 'function' && parent.contains(node)
}

/**
 * 读「当前真正处于全屏的那个元素」。
 *
 * 为什么要先读 target 自己的 root：Shadow DOM 宿主会把 document.fullscreenElement
 * 重定向到宿主元素，直接读 document 会拿到一个不相干的外层，于是「我是不是全屏」
 * 永远判错。先问 target 所在的 root，再退回 document。
 */
function rtFullNativeElement(runtimeDocument, target) {
  let root = null
  try { root = target && target.getRootNode ? target.getRootNode() : null } catch (e) { root = null }
  const current = (root && (root.fullscreenElement || root.webkitFullscreenElement))
    || (runtimeDocument && (runtimeDocument.fullscreenElement || runtimeDocument.webkitFullscreenElement))
    || null
  if (current) return current
  try { if (target && target.matches && target.matches(':fullscreen')) return target } catch (e) { /* 老浏览器没有这个选择器 */ }
  try { if (target && target.matches && target.matches(':-webkit-full-screen')) return target } catch (e) { /* 同上 */ }
  return null
}

/** 取退出全屏的方法（标准名 + 两个 WebKit 历史名）。 */
function rtFullExitMethod(runtimeDocument) {
  if (!runtimeDocument) return null
  const method = runtimeDocument.exitFullscreen
    || runtimeDocument.webkitExitFullscreen
    || runtimeDocument.webkitCancelFullScreen
  return typeof method === 'function' ? method.bind(runtimeDocument) : null
}

/** 只在「确实是我们占着全屏」时才退，避免把别人的全屏（比如截图浮层）一起关掉。 */
function rtFullSafelyExit(runtimeDocument, target, requestRecord) {
  if (requestRecord && requestRecord.exitRequested) return
  const current = rtFullNativeElement(runtimeDocument, target)
  const owns = Boolean(target && (current === target || rtFullContains(target, current)))
  const exitMethod = rtFullExitMethod(runtimeDocument)
  if (!owns || !exitMethod) return
  if (requestRecord) requestRecord.exitRequested = true
  try { Promise.resolve(exitMethod()).catch(function () {}) } catch (e) { /* 尽力而为 */ }
}

/**
 * 让工作台进入「铺满」状态，并伺机使用浏览器原生全屏。
 *
 * 返回 { expanded, enter, exit, toggle, isExpanded }。
 * document / window 可以注入，便于在无浏览器环境下跑回归。
 */
function useWorkbenchFullscreen(RL, elementRef, options) {
  const opts = options || {}
  const stateExpanded = RL.useState(false)
  const expanded = stateExpanded[0]
  const setExpanded = stateExpanded[1]
  const activeRef = RL.useRef(false)
  const nativeTargetRef = RL.useRef(null)
  const mountedRef = RL.useRef(false)
  const operationRef = RL.useRef(0)
  const pendingRef = RL.useRef(null)
  const ownedExitRef = RL.useRef(null)
  const lastTargetRef = RL.useRef(null)
  const docRef = RL.useRef(null)
  const winRef = RL.useRef(null)

  if (elementRef && elementRef.current) lastTargetRef.current = elementRef.current
  docRef.current = Object.prototype.hasOwnProperty.call(opts, 'document')
    ? (opts.document || null)
    : (typeof document === 'undefined' ? null : document)
  winRef.current = Object.prototype.hasOwnProperty.call(opts, 'window')
    ? (opts.window || null)
    : (typeof window === 'undefined' ? null : window)

  const readTarget = () => {
    const el = (elementRef && elementRef.current) || null
    if (el) lastTargetRef.current = el
    return el
  }

  const setActive = RL.useCallback((next) => {
    const value = Boolean(next)
    activeRef.current = value
    if (mountedRef.current) setExpanded(value)
  }, [setExpanded])

  const enter = RL.useCallback(async () => {
    const operation = operationRef.current + 1
    operationRef.current = operation
    ownedExitRef.current = null
    const target = readTarget()
    const runtimeDocument = docRef.current

    /* 同步置位：用户手势在这一帧还有效，不能等 await。 */
    setActive(true)

    if (!target || typeof target.requestFullscreen !== 'function') return true

    const record = { operation: operation, target: target, cancelled: false, exitRequested: false }
    pendingRef.current = record

    let request
    try {
      request = target.requestFullscreen()
    } catch (e) {
      if (pendingRef.current === record) pendingRef.current = null
      return true
    }

    try {
      await request
    } catch (e) {
      /* 原生被拒：CSS 铺满已经生效，这里不额外报错。 */
      if (pendingRef.current === record) pendingRef.current = null
      return true
    }

    const stillPending = pendingRef.current === record
    if (stillPending) pendingRef.current = null
    if (!mountedRef.current || operationRef.current !== operation) {
      if (stillPending && record.cancelled) rtFullSafelyExit(runtimeDocument, target, record)
      return false
    }
    if (rtFullNativeElement(runtimeDocument, target) === target) nativeTargetRef.current = target
    return true
  }, [elementRef, setActive])

  const exit = RL.useCallback(async () => {
    const operation = operationRef.current + 1
    operationRef.current = operation
    const pending = pendingRef.current
    if (pending) pending.cancelled = true
    const target = readTarget()
    const runtimeDocument = docRef.current
    const current = rtFullNativeElement(runtimeDocument, target)
    const owns = Boolean(target && (current === target || rtFullContains(target, current)))

    const exitRecord = owns ? { operation: operation, target: target } : null
    ownedExitRef.current = exitRecord

    setActive(false)
    nativeTargetRef.current = null

    if (!owns || !rtFullExitMethod(runtimeDocument)) {
      if (ownedExitRef.current === exitRecord) ownedExitRef.current = null
      return false
    }

    let exited = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (operationRef.current !== operation || ownedExitRef.current !== exitRecord) break
      const now = rtFullNativeElement(runtimeDocument, target)
      const stillOwned = now === target || rtFullContains(target, now)
      if (!stillOwned || !rtFullExitMethod(runtimeDocument)) break
      if (pending) pending.exitRequested = true
      let request
      try {
        request = rtFullExitMethod(runtimeDocument)()
      } catch (e) {
        break
      }
      try { await request } catch (e) { break }
      exited = true
      /* 浏览器可能一次只弹一层（子元素 → 父工作台）。继续排空，但同一层不再重试。 */
      if (rtFullNativeElement(runtimeDocument, target) === now) break
    }

    if (ownedExitRef.current === exitRecord) {
      ownedExitRef.current = null
      if (operationRef.current === operation) setActive(false)
    }
    return exited
  }, [elementRef, setActive])

  const toggle = RL.useCallback(() => (activeRef.current ? exit() : enter()), [enter, exit])
  const isExpanded = RL.useCallback(() => activeRef.current, [])

  RL.useEffect(() => {
    const runtimeDocument = docRef.current
    const runtimeWindow = winRef.current
    const eventTarget = runtimeDocument && typeof runtimeDocument.addEventListener === 'function'
      ? runtimeDocument
      : (runtimeWindow && typeof runtimeWindow.addEventListener === 'function' ? runtimeWindow : null)

    const onFullscreenChange = () => {
      const target = readTarget()
      if (!target) return
      const current = rtFullNativeElement(runtimeDocument, target)

      if (current === target) {
        const ownedExit = ownedExitRef.current
        if (ownedExit && ownedExit.target === target && ownedExit.operation === operationRef.current) {
          nativeTargetRef.current = null
          setActive(false)
          return
        }
        const pending = pendingRef.current
        if (pending && pending.target === target && pending.cancelled) {
          nativeTargetRef.current = null
          setActive(false)
          rtFullSafelyExit(runtimeDocument, target, pending)
          return
        }
        nativeTargetRef.current = target
        setActive(true)
        return
      }

      /* 子浮层（会话地图、截图放大）自己占着全屏：既不能把外层点亮，
         也不能把已经铺满的外层按下去。 */
      if (rtFullContains(target, current)) return

      if (nativeTargetRef.current === target) {
        nativeTargetRef.current = null
        setActive(false)
      }
    }

    const onKeyDown = (event) => {
      if (!event || event.key !== 'Escape' || !activeRef.current) return
      const target = readTarget()
      const current = rtFullNativeElement(runtimeDocument, target)
      if (rtFullContains(target, current)) return

      /* 有模态浮层开着时，Esc 先归浮层。否则用户按一次 Esc 会把底下的
         工作台一起收掉，看起来像「取消弹窗把页面也关了」。 */
      const nestedOverlay = target && typeof target.querySelector === 'function'
        ? target.querySelector(
          '.rt-session-map-expanded,.rt-shot-zoom,.rt-modal,[role="dialog"][aria-modal="true"],.dshpp-updch-mask',
        )
        : null
      if (nestedOverlay) return

      if (typeof event.preventDefault === 'function') event.preventDefault()
      if (typeof event.stopPropagation === 'function') event.stopPropagation()
      void exit()
    }

    mountedRef.current = true
    if (eventTarget && typeof eventTarget.addEventListener === 'function') {
      eventTarget.addEventListener('fullscreenchange', onFullscreenChange)
      eventTarget.addEventListener('keydown', onKeyDown)
    }
    onFullscreenChange()

    return () => {
      mountedRef.current = false
      operationRef.current += 1
      const pending = pendingRef.current
      if (pending) pending.cancelled = true
      if (eventTarget && typeof eventTarget.removeEventListener === 'function') {
        eventTarget.removeEventListener('fullscreenchange', onFullscreenChange)
        eventTarget.removeEventListener('keydown', onKeyDown)
      }

      const target = (elementRef && elementRef.current) || lastTargetRef.current
      const current = rtFullNativeElement(runtimeDocument, target)
      const owns = Boolean(
        target
        && (nativeTargetRef.current === target || (pending && pending.target === target))
        && (current === target || rtFullContains(target, current)),
      )
      nativeTargetRef.current = null
      activeRef.current = false
      if (owns) rtFullSafelyExit(runtimeDocument, target, pending)
    }
  }, [elementRef, exit, setActive])

  return { expanded: expanded, enter: enter, exit: exit, toggle: toggle, isExpanded: isExpanded }
}
/* [dsh-purge-plus] __RT_FULLSCREEN_END__ */
