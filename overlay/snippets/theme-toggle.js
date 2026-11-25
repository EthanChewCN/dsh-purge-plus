/* [dsh-purge-plus] 主题开关：dusk（暗） / white（亮） / system（跟随系统）。
 *
 * 为什么现在才有：皮肤层（rt-skin.css，safe 的 --ui-* → --rt-* token 链）装上之后，
 * `ui-theme.css` 里那套 `:is(.rt-dock,.rt-full):is([data-theme=white],[data-theme=light])`
 * 才真正有消费者。在那之前设 data-theme 是一个没人读的属性 —— 死代码。
 *
 * 三条刻意的约束：
 *   1. **只改自己的容器**：属性写在 `.rt-dock` / `.rt-full` 上，不碰 <html> / <body>。
 *      宿主自己的明暗由宿主管，插件改它等于替用户做全局决定。
 *   2. **失败一律静默**：localStorage 被禁、matchMedia 不存在、容器还没挂载 ——
 *      任何一种都不能让面板崩。取不到就按默认档走。
 *   3. **不猜容器**：只在 `.rt-dock` / `.rt-full` 出现时挂按钮；面板还没打开时
 *      不往 body 上塞一个悬空胶囊。
 */

(function () {
  var KEY = 'dsh-purge-plus:ui-theme';
  var MODES = ['dusk', 'white', 'system'];
  var DEFAULT_MODE = 'dusk';
  var LABEL = { dusk: '暗', white: '亮', system: '跟随' };
  var CONTAINERS = '.rt-dock,.rt-full';
  var MOUNT_ID = 'dshpp-theme-pill';

  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  /** 存着的模式；没有/坏了/不认识都当「没存」。 */
  function storedMode() {
    var st = storage();
    if (!st) return '';
    try {
      var v = st.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : '';
    } catch (e) { return ''; }
  }

  function systemMode() {
    try {
      var mm = window.matchMedia;
      if (typeof mm !== 'function') return DEFAULT_MODE;
      return mm('(prefers-color-scheme: light)').matches ? 'white' : 'dusk';
    } catch (e) { return DEFAULT_MODE; }
  }

  function currentMode() {
    var stored = storedMode();
    return stored || DEFAULT_MODE;
  }

  /** 选中档 → 实际档（system 要问系统）。 */
  function resolveMode(mode) {
    if (mode === 'system') return systemMode();
    return MODES.indexOf(mode) >= 0 ? mode : DEFAULT_MODE;
  }

  function containers() {
    try {
      var out = [];
      var nodes = document.querySelectorAll(CONTAINERS);
      for (var i = 0; i < nodes.length; i += 1) out.push(nodes[i]);
      return out;
    } catch (e) { return []; }
  }

  /** 把解析后的档写到容器上。返回写了几处。 */
  function applyMode(mode) {
    var resolved = resolveMode(mode === undefined ? currentMode() : mode);
    var list = containers();
    for (var i = 0; i < list.length; i += 1) {
      try { list[i].setAttribute('data-theme', resolved); } catch (e) { /* 单个容器失败不影响其它 */ }
    }
    return { resolved: resolved, count: list.length };
  }

  function persist(mode) {
    var st = storage();
    if (!st) return false;
    try { st.setItem(KEY, mode); return true; } catch (e) { return false; }
  }

  function refreshPill() {
    try {
      var el = document.getElementById(MOUNT_ID);
      if (!el) return;
      var mode = currentMode();
      el.textContent = LABEL[mode] || LABEL[DEFAULT_MODE];
      el.setAttribute('data-mode', mode);
      el.setAttribute('title', '界面主题：' + (LABEL[mode] || '') + '（点击切换：暗 → 亮 → 跟随系统）');
      el.setAttribute('aria-label', '界面主题：' + (LABEL[mode] || '') + '，点击切换');
    } catch (e) { /* 按钮不在就算了 */ }
  }

  function setMode(mode) {
    var next = MODES.indexOf(mode) >= 0 ? mode : DEFAULT_MODE;
    persist(next);
    applyMode(next);
    refreshPill();
    return next;
  }

  function cycle() {
    var cur = currentMode();
    var idx = MODES.indexOf(cur);
    return setMode(MODES[(idx + 1) % MODES.length]);
  }

  var PILL_CSS = '.dshpp-theme-pill{position:fixed;top:10px;right:10px;z-index:12030;' +
    'display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:26px;' +
    'padding:0 8px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px;line-height:1;' +
    'border:1px solid var(--dsw-alias-border-l1,#ddd);background:var(--dsw-alias-bg-layer-1,#fff);' +
    'color:var(--dsw-alias-label-primary,#171717);box-shadow:0 4px 12px rgb(0 0 0 / 14%);opacity:.86}' +
    '.dshpp-theme-pill:hover{opacity:1;border-color:var(--dsw-alias-border-l2,#bbb)}' +
    '.dshpp-theme-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4775ed);outline-offset:2px}' +
    '.dshpp-theme-pill[data-mode=white]{opacity:.92}';

  function ensureStyle() {
    try {
      if (document.getElementById(MOUNT_ID + '-style')) return;
      var st = document.createElement('style');
      st.id = MOUNT_ID + '-style';
      st.textContent = PILL_CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 样式进不去也不影响切换 */ }
  }

  function mount() {
    try {
      if (!document || typeof document.createElement !== 'function') return false;
      if (document.getElementById(MOUNT_ID)) return true;
      if (containers().length === 0) return false;
      ensureStyle();
      var btn = document.createElement('button');
      btn.id = MOUNT_ID;
      btn.type = 'button';
      btn.className = 'dshpp-theme-pill';
      btn.addEventListener('click', function () { cycle(); });
      (document.body || document.documentElement).appendChild(btn);
      refreshPill();
      return true;
    } catch (e) { return false; }
  }

  /** 容器是后挂的：观察 DOM，出现就补一次属性并挂按钮。 */
  function observe() {
    try {
      if (typeof window.MutationObserver !== 'function') return;
      var mo = new window.MutationObserver(function () {
        applyMode();
        mount();
      });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { /* 没有 MutationObserver 就只在启动时应用一次 */ }
  }

  /** system 档要跟着系统变。 */
  function watchSystem() {
    try {
      var mm = window.matchMedia;
      if (typeof mm !== 'function') return;
      var q = mm('(prefers-color-scheme: light)');
      var onChange = function () { if (currentMode() === 'system') applyMode('system'); };
      if (typeof q.addEventListener === 'function') q.addEventListener('change', onChange);
      else if (typeof q.addListener === 'function') q.addListener(onChange);
    } catch (e) { /* 老浏览器没有 addEventListener 就算了 */ }
  }

  function boot() {
    applyMode();
    if (!mount()) {
      /* 容器还没出现：交给观察器，别在这里轮询。 */
      observe();
    } else {
      observe();
    }
    watchSystem();
  }

  try {
    window.__dshPurgeTheme = {
      modes: MODES.slice(),
      get: currentMode,
      resolved: function () { return resolveMode(currentMode()); },
      set: setMode,
      cycle: cycle,
      apply: applyMode,
    };
    if (document && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  } catch (e) { /* 主题是可选装饰，任何失败都不能影响面板 */ }
})();
