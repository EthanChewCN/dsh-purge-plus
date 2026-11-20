# 00 · 机读事实基线（lead 亲自抽取，[实测]）

> 本文不依赖任何 agent 的结论，全部由 `grep` 直接从 vendor 快照抽取，可复现。
> 复现命令见文末。行号以 vendor 快照为准。

## 1. op 层：safe 是严格超集

| 集合 | 数量 | 抽取方式 |
|---|---|---|
| community 后端 op 分支 | 72 | `op === '<name>'` in `community/lib/redteam/store-core.js` |
| safe 后端 op 分支 | 84 | 同上，`safe/lib/redteam/store-core.js` |
| **community 后端有、safe 没有** | **0** | 空集 |
| **safe 后端有、community 没有** | **12** | 见下表 |

### safe 独有的 12 个后端 op

| op | UI 调用 | 工具调用 | 归族 |
|---|---|---|---|
| `attention` | 5 处 | 有 | 等待提醒 |
| `attentionAck` | 0 | 0 | 等待提醒（被 attention 内联 ack） |
| `bindSessionEngagement` | 2 处 | 0 | 会话绑定层 |
| `sessionBinding` | 2 处 | 0 | 会话绑定层 |
| `sessionBindings` | 2 处 | 0 | 会话绑定层 |
| `addDataProof` | 0 | 有 | 归属证明（ReportV2 第一段） |
| `dataProofs` | 0 | 0 | 归属证明 |
| `addCleanup` | 0 | 有 | 清理清单 |
| `cleanup` | 0 | 有 | 清理清单 |
| `updateCleanup` | 0 | 有 | 清理清单 |
| `intelStatus` | 2 处 | 0 | KEV 情报 |
| `intelRefresh` | 2 处 | 0 | KEV 情报 |

→ **UI 可见的 safe 独有 = 6 个**（attention / 3×sessionBinding / intelStatus / intelRefresh）
→ **仅工具可见的 safe 独有 = 5 个**（dataProof ×2 / cleanup ×3）

## 2. 工具层：**双向差异，safe 不是超集**

| 集合 | 数量 |
|---|---|
| community `redteam_*` 工具 | 64 |
| safe `redteam_*` 工具 | 67 |
| **safe 独有** | **11** |
| **community 独有** | **8** |

### safe 独有 11 个

`redteam_asset` `redteam_asset_next` `redteam_attention` `redteam_batch`
`redteam_cleanup` `redteam_data_proof` `redteam_host` `redteam_next_action`
`redteam_pivot_probe` `redteam_scope_check` `redteam_template_refresh`

### community 独有 8 个 ← **这是此前被完全漏掉的一块**

| 工具 | 作用 |
|---|---|
| `redteam_evidence_record` | 记一条证据，带置信度 |
| `redteam_evidence_list` | 列证据 |
| `redteam_evidence_verify` | 核对证据（claimed → observed） |
| `redteam_evidence_upgrade` | 升置信度 |
| `redteam_unknown_record` | 记一条「还没打完、证据不足」的未知 |
| `redteam_unknown_resolve` | 关闭未知 |
| `redteam_unknown_list` | 列未知 |
| `redteam_unverified_count` | 数未核实项 |

## 3. 模块层：证据账本只存在于 community

| 文件 | community | safe |
|---|---|---|
| `lib/redteam/evidence-ledger.mjs` | ✅ 21,577 B | ❌ **不存在** |
| `lib/redteam/atomic-write.js` | ✅ 904 B | ❌ **不存在** |
| `store-core.js` 里 ledger 相关代码 | 0 处（逻辑全在 evidence-ledger.mjs） | 0 处 |

`evidence-ledger.mjs` 导出两个类：

- `EvidenceLedger`（第 121 行起）
- `UnknownRegistry`（第 333 行起）

配套常量：
- `EVIDENCE_CONFIDENCE = ['claimed','observed','derived','inferred']`（第 27 行）
- `EVIDENCE_AUTHORITY = ['tool-output','database-record','screenshot','request-replay','subagent-report','operator-input']`（第 29 行）
- `CONFIDENCE_REQUIRES_VERIFICATION = Set(['claimed','inferred'])`（第 39 行）
- `evidenceId(semantic)` = `"ev_" + sha256(规范化语义)`（第 52 行）—— **内容寻址，改一字哈希即变**
- `EVIDENCE_LEDGER_DDL`（第 59 行）—— 自带建表语句

设计意图（原文注释）：`claimed` 是「子智能体口头报告我拿到了」，**指挥智能体绝不能直接信**；必须核对后升级为 `observed`。

**结论：这是 community 独有的、比 safe 更严格的一条信任链，不能因为「移植 safe」而丢掉。**

## 4. 页签层

### 顶层面板（6 个，两版一致）

`community/client.js:13805` — status / prompt / rules / skills / drill / more

### 演练台

| 版本 | 数量 | 页签 |
|---|---|---|
| community | **10** | assets env agents sessions findings chain scores report knowledge skills（`community/client.js:8583-8594`） |
| safe | **12** | overview assets env agents sessions **artifacts** findings chain scores report knowledge skills（`safe/client.js:21476-21483`） |

→ safe 只多 **`overview`** 与 **`artifacts`** 两个，其余 10 个同名同序。
→ 本轮已移植 `artifacts`，剩 **`overview`** 一个页签。

### 分组导航（safe 独有）

`safe/client.js:21484-21490`：

```
overview     → 工作总览   [overview]
assets       → 资产台账   [assets]
collaboration→ 协同进度   [agents]
results      → 成果与报告 [findings, chain, scores, report]
resources    → 资源中心   [sessions, artifacts, knowledge, skills]
```

配套：`TAB_ALIASES`（`21492`，`testing→assets` / `attackfiles→artifacts` / `prompts→agents`）、
`groupOf()`（`21493`）、键盘导航 Home/End/Arrow（`21693-21695`）。

注意 `env` 页签**不在任何分组里** —— 落到 `TAB_GROUPS[0]`（工作总览）。

## 5. 修正我此前的三处说法

| 此前说法 | 事实 |
|---|---|
| 「safe 是满血版，community 是子集」 | **错**。op 层 safe 是超集，但**工具层双向差异**，community 独有证据账本与未知项管理共 8 个工具 |
| 「演练台 safe 12 个 / 我们 11 个」 | 补 artifacts 前是 10，补完是 11，safe 是 12。差的只有 `overview` |
| 「移植 safe 到 community 上」 | 应改为**取并集**：safe 的 UI/会话绑定/情报 + community 的证据账本/未知项 |

## 复现

```bash
cd ~/Documents/dsh-purge-plus/vendor
# op 集合
grep -oE "op === *[\"'][a-zA-Z0-9_]+[\"']" community/lib/redteam/store-core.js | sed -E "s/.*[\"'](.*)[\"']/\1/" | sort -u
grep -oE "op === *[\"'][a-zA-Z0-9_]+[\"']" safe/lib/redteam/store-core.js     | sed -E "s/.*[\"'](.*)[\"']/\1/" | sort -u
# 工具集合
grep -oE "name: *[\"']redteam_[a-zA-Z0-9_]+[\"']" community/lib/redteam/tools.js | sort -u
grep -oE "name: *[\"']redteam_[a-zA-Z0-9_]+[\"']" safe/lib/redteam/tools.js     | sort -u
# 页签
sed -n '8583,8594p' community/client.js
sed -n '21476,21483p' safe/client.js
```
