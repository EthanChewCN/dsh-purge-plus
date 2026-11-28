// [dsh-purge-plus] 面板崩溃兜底 + 错误留痕。
//
// 为什么要有这个：0.1.181 在用户机器上出现「重启后 Purge 面板打不开」——
// 面板白屏、控制台没有任何用户可见的信息，只能靠重装/回退版本绕过。
// 一次白屏换来的代价是整轮升级作废，而根因（哪一行抛的、抛了什么）全部丢失。
//
// 这个边界只做两件事：
//   1) 渲染期抛错时把错误文本画在面板位置上，而不是让宿主渲染成空白；
//   2) 把 window 上的 error / unhandledrejection 记进环形缓冲，
//      面板里点一下就能复制出来。
// 它不吞错、不改行为：没有异常时 children 原样返回，DOM 与之前逐字相同。

const __purgeErrLog = (typeof window !== "undefined" && Array.isArray(window.__dshPurgeErrors))
  ? window.__dshPurgeErrors
  : [];

function __purgeRecordError(kind, err) {
  try {
    const message = String((err && err.message) || err || "");
    const stack = String((err && err.stack) || "");
    __purgeErrLog.push({
      at: new Date().toISOString(),
      kind,
      message: message.slice(0, 800),
      stack: stack.slice(0, 2000)
    });
    while (__purgeErrLog.length > 20) __purgeErrLog.shift();
    if (typeof window !== "undefined") window.__dshPurgeErrors = __purgeErrLog;
  } catch {
    // 记录失败绝不能影响渲染。
  }
}

// 模块级只装一次：面板被反复挂载时不能重复注册监听。
if (typeof window !== "undefined" && !window.__dshPurgeErrorTap) {
  window.__dshPurgeErrorTap = true;
  try {
    window.addEventListener("error", (ev) => __purgeRecordError("error", (ev && (ev.error || ev.message)) || "unknown"));
    window.addEventListener("unhandledrejection", (ev) => __purgeRecordError("rejection", (ev && ev.reason) || "unknown"));
  } catch {
    // 非浏览器环境（测试夹具）跳过。
  }
}

const __PurgeComponent = import_react.default && import_react.default.Component;

// React 缺失时退化成直通组件：宁可没有兜底，也不能因为兜底本身把面板打死。
const PurgeErrorBoundary = __PurgeComponent
  ? class PurgeErrorBoundary extends __PurgeComponent {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        __purgeRecordError("render", error);
      }
      render() {
        const err = this.state.error;
        if (!err) return this.props.children;
        const detail = String((err && err.stack) || (err && err.message) || err).slice(0, 2000);
        return h(
          "div",
          {
            className: "dshpp-error-boundary",
            style: { padding: "16px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", lineHeight: "1.6" }
          },
          h("div", { style: { fontWeight: "600", marginBottom: "8px" } }, "Purge 面板渲染失败（宿主本身正常）"),
          h("pre", {
            style: { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "0 0 8px", maxHeight: "320px", overflow: "auto" }
          }, detail),
          h("div", { style: { opacity: "0.75" } }, "错误已记进 window.__dshPurgeErrors（最近 20 条）。把这段发给我就能定位，不用重装。")
        );
      }
    }
  : function PurgeErrorBoundary(props) {
      return props.children;
    };

if (typeof window !== "undefined") window.__dshPurgeErrorLog = __purgeErrLog;
