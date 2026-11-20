# dsh-purge-plus 的来源、许可与署名

本仓库**不是从零写的插件**，也**不是任何一个上游的官方发行版**。
它是两个上游的合并层，是一个**独立的变体（independent variant）**，与两个上游的作者均无隶属关系，
也未获得他们的背书。

本文件是 Apache-2.0 §4(d) 与 MIT「保留版权声明」条款的履行文件。修改或再分发时必须原样保留。

---

## 1. 基座：dsh-purge-community 1.7.20

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/kingcharleslzy-ai/dsh-purge`（公开） |
| 许可 | **MIT**，Copyright (c) 2026 小杨 |
| 本仓库位置 | `vendor/community/` — 发行物原样副本，未改动一个字节 |
| 原始许可全文 | `vendor/community/LICENSE`（随发行物一并分发） |
| 原始 NOTICE | `vendor/community/NOTICE.md`（随发行物一并分发） |

它自身又是 `YuJunZhiXue/dsh-purge` **1.1.71** 的独立维护分支（原作者 小杨）。
该仓库的 `NOTICE.md` 与 `docs/upstream/` 保留了这条上游链，本仓库随副本一并继承。

## 2. 移植来源：dsh-purge-safe 2.0.0

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/CallMeGuLab/dsh-purge-safe`（公开），tag `v2.0.0` |
| 许可 | **Apache License 2.0**，Copyright 2026 CallMeGuLab |
| 本仓库位置 | `vendor/safe/` — 原样副本，仅用于比对与升级追踪 |
| 原始许可全文 | `LICENSE-SAFE-APACHE-2.0.txt`（随发行物分发） |
| 原始 NOTICE | `NOTICE-SAFE.txt`（随发行物分发） |

按 Apache-2.0 要求履行的义务：

- **§4(a)** 随发行物提供许可副本 → `LICENSE-SAFE-APACHE-2.0.txt`
- **§4(b)** 修改过的文件注明改动 → 见下表，每个文件顶部另有 `[dsh-purge-plus]` 标记
- **§4(c)** 保留所有版权、专利、商标、归属声明 → `NOTICE-SAFE.txt` 原样保留
- **§4(d)** 若原作品含 NOTICE，衍生作品须在 NOTICE 中携带其归属文字 → 即本文件第 2 节
- **§4(e)** 不得使用上游名称暗示背书 → 本文件开头已声明
- **§6** 商标：未使用 CallMeGuLab 的名称、标识作为本项目的标识

实际进入发行物的 safe 代码只有五处：

| 文件 | 来源 | 改动 |
|---|---|---|
| `lib/patches/overlay.mjs` #201 | safe `core.js` #93 | 语义相同，marker 前缀改为 `dsh-purge-plus` |
| `lib/patches/overlay.mjs` #202 | safe `core.js` #94 | **改写**：safe 用 `return;` 提前返回会跳过 `ctx.effect(shutdown)` 注册；本仓库改为把工厂调用挪进不会被调用的 `const`，保留控制流 |
| `lib/patches/overlay.mjs` #203 | safe `core.js` #95 | 语义相同 |
| `lib/patches/overlay.mjs` #204 | safe `core.js` #96 | **改写**：补 `statSync` 导入；safe 的 `statSync` 在宿主里并不存在（rc.3/rc.5 都缺），打上即 `ReferenceError` |
| `lib/subagent-fence.js` | safe `lib/tool-gate.js` 的 `denyDelegation` | **裁剪**：只保留「子代理禁再派活」，去掉与 community `#9`/`#59` 重复的降级逻辑 |

## 3. 上游的第三方内容（随 community 继承）

community 的 redteam 模块派生自第三方，本仓库随副本一并继承其声明，不得删除：

| 内容 | 来源 | 许可 | 文件 |
|---|---|---|---|
| `dsh-redteam-mode` | `https://github.com/Jueze-2019/dsh-redteam-mode`（公开） | **MIT**，Copyright (c) 2026 Jueze-2019 | `vendor/community/docs/redteam-upstream-LICENSE` |
| dual-use 声明 | 同上 | — | `vendor/community/docs/redteam-upstream-DISCLOSURE` |
| agent-loop 测试夹具 | `@deepseek-ai/dsh-agent-loop` 0.2.2-rc.1 | MIT | `vendor/community/test/fixtures/agent-loop-022-LICENSE` |

## 4. 宿主：DeepSeek Harness

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/deepseek-ai/deepseek-harness`（公开） |
| 许可 | **MIT** |

本仓库**不包含**宿主代码。所有补丁在安装时作用于宿主文件，并在状态目录留 `.dshpurge.bak` 原件；
宿主文件本身不被复制进本仓库或发行物。

## 5. 未移植的部分及原因

见 `docs/PORT-MATRIX.md`。简言之：safe 的 `subagent-control.js`（审批接管）与 `tool-gate.js` 主体（审核降级），
在 community 里已由**源码补丁** `#9` / `#59` 以更彻底的方式实现，重复移植会互相覆盖。
这不是取舍，是重复。

## 6. 本仓库自身

- 本仓库原创部分：**MIT**，Copyright (c) 2026 dsh-purge-plus contributors。
- `vendor/` 下的内容**不适用**本仓库许可，各自适用其原始许可（见上）。
- 本仓库不是 `dsh-purge-community` 的官方续作，也不是 `dsh-purge-safe` 的官方续作。
  上游若发布新版本，本仓库的合并结论可能与上游不同。

## 7. 关于「公开分发」的合规结论

三份上游许可（MIT / Apache-2.0 / MIT）**均明确允许**复制、修改、合并、发布、分发、再许可：

- MIT：「Permission is hereby granted, free of charge, ... to deal in the Software without restriction,
  including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
  and/or sell copies」
- Apache-2.0 §2：「each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge,
  royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display,
  publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form」

因此**公开本仓库是允许的**，前提是保留上述署名与许可全文（本文件即为此而存在）。

唯一需要注意的非许可条款：community 的 `NOTICE.md` 写着「This fork is free and not offered for paid resale」。
MIT 不允许附加限制，这句在 NOTICE 里属于**请求**而非许可条件，法律上不构成约束；
本仓库尊重该请求，不做付费转售。
