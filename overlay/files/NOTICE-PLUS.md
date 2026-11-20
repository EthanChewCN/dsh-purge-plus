# dsh-purge-plus 的来源与许可

本仓库不是从零写的插件。它是**两个上游的合并层**，必须按下面的方式保留署名。

## 1. 基座：dsh-purge-community 1.7.20

- 仓库：`kingcharleslzy-ai/dsh-purge`（私有）
- 许可：**MIT**，Copyright (c) 2026 小杨
- 本仓库 `vendor/community/` 是它的**发行物原样副本**（未改动一个字节），
  所有上游补丁、文档、UI 都归它。
- 它自身又是 `YuJunZhiXue/dsh-purge` 1.1.71 的独立维护分支，
  其 `NOTICE.md` 与 `docs/upstream/` 一并保留。

## 2. 移植来源：dsh-purge-safe 2.0.0

- 仓库：`CallMeGuLab/dsh-purge-safe`，tag `v2.0.0`
- 许可：**Apache License 2.0**
- 本仓库 `vendor/safe/` 是它的原样副本，仅供比对与升级追踪。
- 实际进入发行物的 safe 代码只有三处，全部改写并标注了 `[dsh-purge-plus]`：

| 文件 | 来源 | 改动 |
|---|---|---|
| `lib/patches/overlay.mjs` #201 | safe `core.js` #93 | 原样语义，marker 前缀改为 `dsh-purge-plus` |
| `lib/patches/overlay.mjs` #202 | safe `core.js` #94 | **改写**：safe 用 `return;` 提前返回会跳过 `ctx.effect(shutdown)` 注册；本仓库改为把工厂调用挪进不会被调用的 `const`，保留控制流 |
| `lib/patches/overlay.mjs` #203 | safe `core.js` #95 | 原样语义 |
| `lib/patches/overlay.mjs` #204 | safe `core.js` #96 | **改写**：补 `statSync` 导入；safe 的 `statSync` 在宿主里并不存在 |
| `lib/subagent-fence.js` | safe `lib/tool-gate.js` 的 `denyDelegation` | **裁剪**：只保留「子代理禁再派活」，去掉与 community `#9`/`#59` 重复的降级逻辑 |

按 Apache-2.0 §4 要求：
- 保留了原始许可全文 → `LICENSE-SAFE-APACHE-2.0.txt`
- 保留了原始 NOTICE → `NOTICE-SAFE.txt`
- 每个改动文件顶部注明「来源 + 改动内容」
- 未使用 upstream 名称暗示背书

## 3. 未移植的部分及原因

见 `docs/PORT-MATRIX.md`。简言之：safe 的 `subagent-control.js`（审批接管）
与 `tool-gate.js` 主体（审核降级）在 community 里已由**源码补丁** `#9` / `#59`
以更彻底的方式实现，重复移植会互相覆盖。这不是取舍，是重复。

## 4. 宿主：DeepSeek Harness

- 仓库：`deepseek-ai/deepseek-harness`
- 许可：MIT
- 本仓库不包含宿主代码；所有补丁在安装时作用于宿主文件，并在
  `~/.dsh/dsh-purge-community/backups/` 留 `.dshpurge.bak` 原件。

## 5. 本仓库自身

MIT，Copyright (c) 2026 dsh-purge-plus contributors。
`vendor/` 目录下的内容不适用本仓库许可，各自适用其原始许可。
