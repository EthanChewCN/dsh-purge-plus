# dsh-purge-plus

以 **dsh-purge-community 1.7.20** 为基座，移植 **dsh-purge-safe 2.0.0** 里 community 尚未覆盖的能力，
并设计成能跟随两个上游长期维护的 DSH 附加组件。

```
基座   dsh-purge-community 1.7.20   MIT      88 条补丁、57 个运维模块、drift 检测
移植   dsh-purge-safe      2.0.0    Apache-2.0  遥测关闭 ×3、office 资产回退、叶子节点围栏
结果   dsh-purge-plus      1.7.20-plus.1   92 条补丁
```

## 现在有什么

| 项 | 内容 |
|---|---|
| 补丁 | **92 条** = 上游 88 + 自有 4（id ≥201） |
| 自有 #201 | `PRODUCT_ANALYTICS_DEFAULT_OFF` — 产品埋点默认关 |
| 自有 #202 | `PRODUCT_TELEMETRY_OTEL_NOOP` — 产品遥测 OTLP 导出器变空实现 |
| 自有 #203 | `SESSION_TELEMETRY_OTEL_DISABLED` — 会话遥测默认 DISABLED |
| 自有 #204 | `SKILL_OFFICE_ASSET_FALLBACK` — office 缺 SKILL.md 时回退包内资产 |
| 自有模块 | `lib/subagent-fence.js` — 子代理（叶子节点）不得再派活 |
| 沿用 | 上游全部 88 条补丁、`audit.jsonl`、`maintenance-lock`、`rollback-transaction`、`selfcheck`、`probe`、drift 检测 |

## 为什么不整包用 safe

因为 safe 2.0.0 的基座比 community 落后约 50 个版本，且缺 10 条 `optional:false` 必需补丁
（含桌面端 431 cookie 累积、agent-loop 第二轮崩溃护栏）。反过来，safe 的
`subagent-control.js` 与 `tool-gate.js` 主体在本基座里**已被源码补丁 #9 / #59 更彻底地实现**，
重复移植会互相覆盖。

逐条判定与源码证据见 **[docs/PORT-MATRIX.md](docs/PORT-MATRIX.md)** —— 那是本仓库的核心文档。

## 安装

```bash
node scripts/build.mjs          # → dist/dsh-purge-plus-<ver>.tgz
node scripts/verify.mjs         # 只读验收，不动宿主
```

然后 DSH 面板 → 插件 → 从文件安装，或：

```bash
cd ~/.dsh/profiles/desktop
pnpm add "file:$HOME/Documents/dsh-purge-plus/dist/dsh-purge-plus-1.7.20-plus.1.tgz"
```

> **先卸掉 `dsh-purge-community`。** 两个包会同时往同一批宿主文件打补丁，
> `.dshpurge.bak` 基线会互相污染。状态目录共用（`~/.dsh/dsh-purge-community/`）是有意的，
> 见 PORT-MATRIX §4。

## 仓库结构

```
vendor/community/     上游基座，原样副本，构建时只读
vendor/safe/          移植来源，原样副本，只用于比对
overlay/files/        新增文件（补丁表、围栏、许可）
overlay/edits.mjs     对上游的 7 处精确锚点插入（无删改）
scripts/build.mjs     vendor + overlay → dist/package → tgz
scripts/verify.mjs    只读验收：import / 不变式 / 宿主定位 / 锚点预演
scripts/sync-upstream.sh  上游升级：换 vendor → 重放 overlay → 重建 → 验收
docs/PORT-MATRIX.md   逐条判定 + 源码证据 + 锚点漂移监控表
docs/UPSTREAM.md      维护手册：升级、冲突处理、回滚
```

## 维护模型

**不做 fork-and-edit。** `vendor/` 永远是上游原样，本仓库的改动全部是
「新增文件 + 精确锚点插入」，共 7 处。升级时整目录替换 `vendor/community`，
锚点对不上就**构建硬失败**，而不是静默产出一个语义跑偏的包。

```bash
./scripts/sync-upstream.sh <新版本 tgz>
```

详见 [docs/UPSTREAM.md](docs/UPSTREAM.md)。

## 许可

- 本仓库自身：MIT
- `vendor/community/`：MIT，Copyright (c) 2026 小杨（dsh-purge 原作者），
  其上游为 `YuJunZhiXue/dsh-purge` 1.1.71
- 移植自 safe 的代码：Apache-2.0，Copyright CallMeGuLab，
  全文见 `LICENSE-SAFE-APACHE-2.0.txt`，原 NOTICE 见 `NOTICE-SAFE.txt`
- 改动说明见 `NOTICE-PLUS.md`

本仓库与上述任何上游作者均无隶属或背书关系。
