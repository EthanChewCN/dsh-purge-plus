# 进度账本

> 本文件是**唯一**的进度事实来源。每轮做完一件事就在这里改状态列，不再靠对话回忆。
>
> 标记约定：
> - ✅ 已完成 —— 附「落地版本」与「验收证据」，两者都能被独立复核
> - 🚧 进行中 —— 附当前卡在哪一步
> - ⬜ 未开始 —— 附前置项（前置没绿就不许开工）
> - ⛔ 明确不做 —— 附理由，避免下一轮重新讨论
>
> 状态只允许由**跑过的命令**推进，不允许由「读代码觉得应该没问题」推进。
> 每个 ✅ 都必须能在 `scripts/verify.mjs` 或 `scripts/test-*.mjs` 里找到对应断言。

当前版本：**0.1.37**（已安装进 profile、已打 tag、已发布）· 验收 23 组 / **222 条断言**全绿 · 回归 **580 条**全绿（13 个脚本）

---

## 一、总览

| ID | 事项 | 状态 | 落地版本 | 证据 |
|---|---|---|---|---|
| **T1** | 依赖声明与实际安装不一致（会静默降级） | ✅ | — | `pnpm install` EXIT=0；见 §三 |
| **T2** | 双份 hook 运行期未实测 | ✅ | — | 单一实例（community 包已移除）；见 §三 |
| **T3** | `migrate()` 老库回填只在合成数据验过 | ✅ | — | 本机无老库（靶标目录为空）；见 §三 |
| **T4** | 同版本重建 tgz 后 pnpm 不刷新（装上去还是旧的） | ✅ | — | 规则已定；见 §三 T4 |
| **T5** | 补丁 #53 的 `web-app-lib` 目标永久假漂移 | ✅ | plus.6 | verify `[12]` 后的补丁详情；见 §三 T5 |
| **T6** | 本轮多次构建原地覆盖了 plus.6.tgz（同名不同内容） | ⚠️ | plus.7 | 已提 revision 并产出 plus.7；见 §三 T6 |
| **T7** | 同版本重建会静默覆盖旧 tgz —— T6 只有纪律、没有闸门 | ✅ | plus.10 | 构建守卫：内容指纹不同即拒绝覆盖；见 §三 T7 |
| **T8** | 打包把本机 xattr 写进产物 → 装完多出 403 个 `._` 边车（384 → 787 文件） | ✅ | plus.16 | `--no-xattrs --no-mac-metadata`；见 §三 T8 |
| **T9** | 构建摘要含 `generatedAt` → 同一 revision 重跑必报「同名不同内容」，T7 守卫**常红**（常红的守卫等于没有守卫） | ✅ | plus.35 | 摘要剔除 `generatedAt`；实测第二次构建输出「内容未变」；verify `[23]` 断言 |
| **P0-1** | `migrate()` 引用未定义常量，回填静默不执行 | ✅ | plus.4 | verify `[12]` |
| **P0-2** | 写操作前缀正则漏 4 条 | ✅ | plus.4 | verify `[12]`（22 写 / 32 读） |
| **P0-3** | 未知 op 被兜底吞成 `ok:true` | ✅ | plus.4 | verify `[12]`（guard 后 54 op 全覆盖） |
| **P0-4** | 模板检索丢 `category`/`offset`，分类计数恒 0 | ✅ | plus.4 | verify `[12]` |
| **P1** | 会话 → 靶标绑定落盘（原子写） | ✅ | plus.4 | verify `[13]` · 回归 31 条 |
| **P2** | 会话关系图（SessionMap，带 onPick） | ✅ | plus.4 | verify `[13]` |
| **P3** | 子智能体回报表 + `attention`/`attentionAck` + 「现在在等谁」卡片 | ✅ | plus.5 | verify `[14]` · 回归 40 条 |
| **P4** | 导航分组 `TAB_GROUPS`（5 组 + 二级页签） | ✅ | plus.6 | verify `[15]` · 回归 38 条 |
| **P5** | 站内全屏（含补挂载出口） | ✅ | 工作区 | verify `[16]` · 回归 17 条 |
| **P6** | 态势首页 `overview` | ✅ | 工作区 | verify `[18]` |
| **P7** | 覆盖度引擎（`asset_coverage`/`host_coverage`/`host_finding`） | ✅ | 工作区 | verify `[17]` · 回归 19 条 |
| **P8** | `data_proof` 表 + 四段式报告（`reportV2` / `ReportV2`） | ✅ | plus.8 | verify `[20]` · 回归 42 条 |
| **P9** | `cleanup_item` 四 op（清理清单） | ✅ | 工作区 | verify `[19]` · 回归 10 条 |
| **P10** | KEV / nuclei 模板保鲜 + 资源徽章 | ✅ | 工作区 | verify `[19]` |
| **P11** | 复合工具入口（8 个 + 范围核对 / 隧道实测） | ✅ | plus.8 | verify `[21]` · 回归 28 条 |
| **P12** | 证据账本 UI（本包独有，两边上游都没有） | ✅ | plus.8 | verify `[22]` · 回归 31 条 |
| **P13** | 状态词条消歧（三种「不适用」印同一句话）+ 明细首列 `#35` 竖排 | ✅ | plus.9 | `test-status-labels.mjs` 26 条 |
| **P14b** | 状态胶囊在行内垂直居中（`td` 被页面样式改成 `top`） | ✅ | plus.19 | `test-status-labels.mjs` `[11]` 5 条 · 实测 23.7/23.7 |
| **P15** | 两处「不适用」计数对不上（顶部条 85/87·6 vs 卡片 85/85·8）——「跳过」被伪装成「不需要」 | ✅ | plus.20 | `test-status-labels.mjs` `[12]` 23 条 · 活体对账 |
| **P16** | 运行时缺陷审计 10 项（1 高 / 4 中 / 5 低）：`pocGet` 假成功、无靶标空壳、技能软链被跳过等 | ✅ | plus.22 | `test-silent-failures.mjs` 40 条 · 变异 3 组全红 |
| **P17** | `consoleDigest` 缺 `artifacts`/`overview`/`env` 三段（三个页签红点永不亮） | ✅ | plus.24 | `test-silent-failures.mjs` 44 条 |
| **P18** | 社区版审计 4 项：`updateCleanup` 静默写 NULL（高）、离线丢回滚目标、兼容表缺 rc.5、`stage_code` 永不回填 | ✅ | plus.26 | `test-silent-failures.mjs` 56 条 · 变异 1 组全红 |
| **P19** | 补丁明细默认展开硬编码成「代码」组——而这一组 54/54 全绿，真有跳过的两组反而收起 | ✅ | plus.28 | `test-status-labels.mjs` `[13]` 21 条 · 变异 2 组全红 |
| **P20a** | 报告只有卡片与下载，没有「就地读文档」——验收人要读的正是那份 markdown | ✅ | plus.31 | `test-p20.mjs` · verify `[23]` · 变异 1 组全红 |
| **P20b** | 会话关系图是分组卡片，不是图；无布局/无边/无拖拽/无详情 | ✅ | plus.31 | `test-p20.mjs` 布局真值表 · 变异 1 组全红 |
| **P20c** | 字段级四项：`scoreReport` 缺 `layout='simple'`+`report`、`bootstrap` 缺 `engagements[].stats`、`cleanup_item` 缺 `location`、`getAssetCoverage` 缺 `asset.ports` | ✅ | plus.31 | verify `[23]` 8 条 · `test-p20.mjs` 端到端 |
| **P21** | 情报「刷新」原本只是重新探本地文件（不联网），拿不到新 KEV | ✅ | plus.31 | `test-p20.mjs` 22 条（含 stub fetch 的 6 条失败路径） |
| **P22** | 三方审计（覆盖面 / 运行时 / UI）挖出的 15 项缺陷：markdown 解析器死循环（高）、KEV meta 覆盖数据（高）、`cleanup.location` 全链断（高）、去重吞掉第二个 webshell（高）、查询失败=「已清干净」（高）、报告页无滚动容器（高）、窄面板节点被遮（高）、目录跳转无效、`javascript:` 链接、拖拽卡死 | ✅ | plus.34 | `test-p20.mjs` 128 条 · verify `[23]` 46 条 · 变异 7 组全红 |

**明确不做**（见 §五）：`net-scope` 地域拒绝层、`ProxySettings` 443 行、补丁 `#89/#90/#91/#96`。

---

## 二、能力现状（对 safe 2.0.0 的差）

| 面 | 本包 | safe | 差 |
|---|---:|---:|---|
| 后端 op | **91** | 84 | 本包反超 7（`dataProofs`/`addDataProof`/`reportV2`/`evidenceLedger` 等；safe 没有证据账本与清理汇总） |
| agent 工具 | **82** | 67 | 本包反超 15（safe 的复合入口已全部补齐，另有 8 证据账本 + 6 覆盖度 + 清理/保鲜/数据证明） |
| DB 表 | **29** | 29 | 0（`data_proof` 已补；证据账本另 3 张表由 `evidence-ledger.mjs` 自建，不计入此处） |
| 演练台页签 | **13** | 12 | 0（`overview` 已补，另有本包独有的 `evidence` 证据账本） |
| 导航分组 | **6** | 6 | 0（齐） |

> 口径说明：工具数是「净差」。safe 独有 11 个复合入口，本包独有 8 个证据账本工具（`evidence_*` / `unknown_*` / `unverified_count`）——这部分 safe **完全没有后端**，是本包比两边上游都严格的一条信任链。

---

## 三、技术债（本轮清空）

### T1 依赖声明与实际安装不一致 ✅

**问题**：`~/.dsh/profiles/desktop/package.json` 里 `dsh-purge-plus` 指向 `plus.3.tgz`，而 `node_modules` 里是 `plus.4`。下一次 `pnpm install` 会**静默降级**，P0/P1/P2 全部丢失，且不报错。

**顺带发现**：同一文件的 `dsh-qwen-studio` 指向 `~/Downloads/dsh-qwen-studio-3.1.3.tgz`，该文件已不存在 → `pnpm install` 在到达 purge 之前就 ENOENT 失败。两条互相掩盖。

**修法**：
1. 从 `node_modules/dsh-qwen-studio` 重新打包到稳定位置 `~/.dsh/vendor/dsh-qwen-studio-3.1.3.tgz`（`diff -r` 与已安装内容 133 个文件完全一致）；
2. `package.json` 两个 `file:` 都改指正确位置；
3. 用宿主自带的 pnpm（`/Applications/DeepSeek Harness.app/.../dependencies/pnpm`，v11.28.5）跑真实 `install`。

**实测**：

```
$ node pnpm.cjs install
Packages: +2 -13
- dsh-purge-community 1.7.20
+ dsh-purge-plus 1.7.20-plus.5
Done in 1.8s
EXIT=0
```

附带收益：陈旧的 `dsh-purge-community` 被自动移除，`cordis.yml` / `package.json` / lockfile 里均无残留引用（`grep -rn` 全部 0 命中）。

### T2 双份 hook 运行期未实测 ✅

`docs/COMPAT.md` §6.4 登记的是「两个实例都挂 `system-prompt/assemble`，预期不重复注入但未实测」。本轮 T1 的安装把 `dsh-purge-community` 移除了，现在是**单一实例**，该风险不存在——这也正是 §6.4 自己的建议（不要让两个包同时启用）。**结论由「未验证」变成「不适用」**，不是「已验证」。

### T3 `migrate()` 老库回填 ✅

`~/.dsh/redteam/engagements/` 为空目录，本机没有任何老库靶标。回填路径对真实数据的影响为 0；`test-attention.mjs` 每次从零建库，走的是新库路径。已在 `docs/P0-P2-落地记录.md` 保留合成数据验证记录。

### T4 同版本重建 tgz 后 pnpm 不刷新 ✅（本轮新发现）

**问题**：把 `dist/dsh-purge-plus-1.7.20-plus.5.tgz` 原地重建（比如补了文档）后，`pnpm install` **不会**重新解包——即使 `--force`。实测：

```
lockfile integrity 与文件实际 sha512 一致（lock 已更新）
但 node_modules/dsh-purge-plus 仍是旧内容（缺 docs/PROGRESS.md）
```

因为 specifier 是同一个路径，pnpm 认「版本没变」就直接复用已解包的副本。**这比 T1 更阴**：T1 是版本号对不上（能看出来），这条是版本号对得上、内容却对不上。

**规则**（写进发布流程）：

1. 只要 tgz 内容变了，就**必须**换版本号（`overlay/repo.json` 的 `revision`）；
2. 若确实要在同版本上重发，装之前先 `rm -rf node_modules/dsh-purge-plus`；
3. 装完**核对文件数**，不要只看版本号：

```bash
diff <(cd dist/build/package && find . -type f | sort) \
     <(cd ~/.dsh/profiles/desktop/node_modules/dsh-purge-plus && find . -type f -not -name '._*' | sort)
```

本轮据此发现并修正：装完 384 vs 384，完全一致。

> 附带说明：`node_modules/<pkg>` 里会出现 `._*`（macOS AppleDouble）文件，它们不在 tgz 里，也不在构建产物里，是解包时产生的元数据噪音。核对文件数时要排除。

### T5 补丁 #53 的 `web-app-lib` 永久假漂移 ✅

**现象**：`patch_files["53"]` 里 `web-app-lib` 恒为 `drifted`，而同一补丁的 `harness-dev-context` 是 `applied`。

**根因**：`core.js:2882` 的注释已经写明——「0.2.1 起 Web 面身份句/禁止另开服务器的文案搬到 `dsh-harness-dev-context`」。补丁 #53 的 `file: ["harness-dev-context", "web-app-lib"]` 是**双布局覆盖**（旧版在 web-app、新版在 dev-context）。在 0.2.2-rc.5 上 `web-app/lib/index.js` 只有 180 行、纯服务端胶水，三个锚点命中数全为 **0**，也没有 `.bak`（从未被写过）。

`filePatchOutcome()` 的判定顺序是「marker 不在 → 锚点全灭 → 非自标记 → `drifted`」。于是这个文件**永远**报漂移。

**为什么同一模式在 #32 上不出问题**：#32 声明了 `fileOptional: ["harness-dev-context"]`，`core.js:3902` 会把 `drifted` 降级成 `skipped`。#53 漏了这一步。

**影响**：不污染汇总（`patch_rows` 里 #53 仍是 `applied`，84/87 计数正确），只在补丁详情的 per-file 状态里显示「锚点漂移」。危害是**训练人忽略漂移指示器**——而漂移正是宿主改版时唯一有效的告警。

**修法**：`overlay/edits.mjs` 第 52 条给 #53 加 `fileOptional: ["web-app-lib"]`。安全性：若将来宿主把文案再搬走一次，`harness-dev-context`（非 optional）会同步漂移，信号不丢。

### T7 同版本重建会静默覆盖旧 tgz —— T6 只有纪律、没有闸门 ✅

**T6 的教训是「改内容就换 revision」，但那是纪律，靠人记。** 这一轮当场验证了纪律会失效：
修完 P13 打完 `plus.9`、装好、逐字节验过 384 文件一致，然后只改了 `docs/PROGRESS.md`
——**文档也在 tgz 里**（`build.mjs` §2 会把 `docs/*.md` 并进包），于是再跑一次构建，
`plus.9.tgz` 就被悄悄覆盖成另一份内容。版本号没变、文件名没变、pnpm 也不会重新解包。
这正是 T6 记下的那个坑，只是触发条件比我原先写的更宽：**不只是「补了代码」，改文档同样算**。

**修法**：构建最后一步加闸门（`scripts/build.mjs` §6）。

```
dist/<tgz> 已存在 → 比对「解包内容摘要」
  相同  → 不覆盖，打印指纹，退出
  不同  → die，打印两边的指纹并提示提 revision
```

**为什么指纹不能是 tgz 的字节**：gzip 头里带 mtime，同样的内容连打两次字节就不同（实测
`f07d3e3b…` vs `50287b7b…`），拿它当指纹会每次重跑都误报。改成按「排序后的 相对路径 + 每文件 sha256」
算确定性摘要，另存 `<tgz>.content` 边车文件（**不进包**，避免文档自指循环——这也是
`RELEASE.md` 不写死 sha256 的同一条理由）。

**验证**：闸门上线后立刻用 plus.9 试了一次——它没有 `.content` 边车，闸门按「无法判定」拒绝，
正是预期行为：

```
✗ dist/dsh-purge-plus-1.7.20-plus.9.tgz 已存在，但内容不同
    已记录 （无 .content 指纹，无法判定）
    本次   c0544978ec5faaf4…
```

提 revision 到 10 后正常产出 `plus.10.tgz`（内容指纹 `d2681f0f…`）。

**随后又被自己拦了一次**：plus.10 装好之后我接着改这份账本，再构建就被闸门拒了——
因为账本也在包里。于是重切 `plus.11`（代码与 plus.10 完全一致，只有文档差异）。
结论写进纪律：**先定稿文档，最后构建一次**；顺序反了就要多一个版本号。

### T8 打包把本机 xattr 写进产物 ✅

**问题**：装完 plus.14 核对文件数，`384` 变成 `787`，多出来的全是 `._X`。
`skills/redteam/._active-scan.md`、`presets/redteam/._preset.yml` 都在里面——
一边污染目录，一边给「按目录扫 skill / preset」的代码送假条目。

**定位过程**（三步，每步都排掉一个假设）：

| 假设 | 实测 | 结论 |
|---|---|---|
| tgz 里就带着 `._` 成员 | `tar -tzf \| grep -c '^package/\._'` = 0 | 不是打包进去的 |
| pnpm 对这个包特判 | 换个本地 tgz（qwen-studio）在 `nodeLinker: hoisted` 下同样中招，161 个 | 不是本包独有 |
| 隔离链接器没事 | 同一个 tgz 用默认 isolated 装 → 0 个 | 只在 hoisted 下发生 |

再看边车内容：`00051607` 开头（AppleDouble 魔数），里面一条 `ATTR` 记录，
名字是 `com.apple.provenance`。于是查归档的 pax 头：

```
package/client.js  {'LIBARCHIVE.xattr.com.apple.provenance': 'AQIAMmG9n3WsFEA', ...}
members with pax headers: 404
```

**根因**：macOS 的 BSD tar 默认把每个成员的 xattr 写成 pax 记录；pnpm 的 hoisted
链接器解包时把这条 xattr 落成 AppleDouble 边车，一个成员配一个。403 个成员 → 403 个边车。

**修法**：打包时剥掉元数据。

```js
execFileSync("tar", ["--no-xattrs", "--no-mac-metadata", "-czf", tgz, "-C", BUILD, "package"], {
  stdio: "inherit",
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
```

**验收**：`members: 403 | xattr pax: 0 | ._ members: 0`；安装后 `384 文件 / 0 边车 / diff 0`。

**顺带一个非技术收益**：`com.apple.provenance` 是本机标识 token。它被写进 tarball
就等于**随公开发布一起发出去**——发版前必须剥掉，这条已经写进构建脚本注释。

---

## 四、待办（按依赖排序，开工前先看前置）

**P0–P12 全部完成，待办为空。**

下一轮只剩「发布」这一步（打 tag + GitHub release + SHA256SUMS），以及发布前的一次
真实靶标全流程走查（拿真数据出一份四段式报告，看 `gaps` 与归属证明是否符合预期）。

| 序 | ID | 事项 | 状态 |
|---|---|---|---|
| — | 发布 | tag `v1.7.20-plus.8` + release + 校验和 | ⬜ 等确认 |
| — | 走查 | 真靶标跑一遍 reportV2 / evidenceLedger | ⬜ 等确认 |

---

## 五、明确不做

| 项 | 理由 |
|---|---|
| `net-scope` 地域拒绝层（669 行） | community 1.7.20 **自己删掉的**（`docs/maintenance-archive.md:385` 自认）。它是「命中就往会话写拒绝文本并收空这一轮」的反向能力，与插件目标相反 |
| `ProxySettings`（443 行） | 死代码，无挂载点 |
| 补丁 `#89/#90/#91` | `#89` 把系统提示词塞进没有 provider 会读的 `system` 字段；`#90/#91` 读 string 型全局而基座定义的是 function 型 → 静默失效 |
| 补丁 `#96` | rc.5 宿主已自愈，零收益；且 safe 原版 `statSync` 未 import，打上即 `ReferenceError` |
| `multiHit` / `rel` 字段 | 死字段 |

---

## 六、变更日志

### plus.28 — P19：补丁明细的默认展开由数据决定

用户问：「为什么点进插件后，补丁明细里『代码』这一块总是展开的？」

根因是一行硬编码：

```js
const [open, setOpen] = useState({ code: true });   // client.js:10635
```

作者按偏好指定了**一组**默认展开，其余全收。而本机 93 条的真实分布是：

| 组 | 条数 | 状态 |
|---|---:|---|
| 代码 | 54 | **54/54 全绿** ← 唯一默认展开的 |
| 提示词 | 27 | 24 applied + 1 skipped(#76) + 2 na |
| 工具 | 9 | 4 applied + 1 skipped(#80) + 4 na |
| 兼容 | 3 | 全绿 |

**默认视图正好展示最不需要看的那一组**，而真正没落地的两条（#76 #80）藏在收起的组里。
加上组件在切页签时重挂载，`useState` 的初值每次都重新生效，所以「永远展开」。

改法：初值改 `null`（= 还没手动点过），渲染时按数据算默认：

```js
function needsAttentionRow(row) {
  return row.st === "pending" || row.st === "unmatched" || row.st === "drifted" ||
    row.st === "partial" || isSkipRow(row);
}
const autoOpen = {};
for (const [key, rows] of grouped) {
  if (rows.some((row) => needsAttentionRow(row))) autoOpen[key] = true;
}
const effectiveOpen = open || autoOpen;
```

`disabled`（用户自己关的）与 `na`（本机没这组件）不算「要人看一眼」，不触发展开。

第一次点击时 `const base = prev || autoOpen;` 先整体复制当时的默认状态再翻转，
否则点一个组会把其余自动展开的组一起收掉。

**验收**：`test-status-labels.mjs` `[13]` 新增 21 条（10 条 `needsAttentionRow` 真值表 +
5 条产物接线 + 4 条按真实分布的分组端到端 + 2 条活体对账，其中分组端到端用的是从产物里
切出来的**真** `LAYER_GROUP`）。
活体断言直接读宿主 `patch_rows` 的 `layer`：`代码` 组必须不收、`提示词`/`工具` 必须展开。

变异测试（两条，各自独立变红）：

| 变异 | 结果 |
|---|---|
| `useState(null)` 改回 `{ code: true }` | ✗ 2 条 |
| `needsAttentionRow` 去掉 `isSkipRow(row)` | ✗ 5 条（含活体那条） |

### plus.26 — P18：社区版审计四项

子智能体的社区版对等审计（[`audit/AUDIT-COMMUNITY.md`](audit/AUDIT-COMMUNITY.md)）结论：
**功能面 0 缺失**（op 词表 174 vs 155、工具 82 vs 64、路由 22/22、页签 6/6、补丁 id 88 vs 83、
i18n 丢失 0、死按钮 0），但我们自己新增的那部分有 4 个缺陷。

| 编号 | 缺陷 | 后果 | 修法 |
|---|---|---|---|
| **B1** | `updateCleanup` 分发无条件塞 6 个键，store 用 `hasOwnProperty` 判「要改」→ `undefined` 也命中，落库变 `NULL` | 只改 detail 会报「status 只能是…收到 undefined」；`target` 被清空后 `addCleanup` 去重键失效 → **插出重复项**，而报告收尾段唯一数据源就是这张表 | 只传调用方真的给过的字段 |
| **B2** | 离线/限流时 `fork.rows` 为空，历史版本被「不在发行列表就丢」全部过滤掉 | **回滚目标消失**——唯一还能退回去的那个版本也没了 | 只有真拿到发行列表时才按它过滤 |
| **B3** | `dshTarget` 写 `0.2.2-rc.5`，但继承来的 `dshReleases` 停在 `rc.3` | 面板对一台跑得好好的宿主常年报「未验证版本」（用户截图里那个黄点） | 构建时把 rc.5 标成 compatible（verify 22 组 + 380 条回归就是在这个版本上跑的） |
| **B4** | `stage_code` 回填包在 `if (ensure(...))` 里 | 列已存在就整段跳过 → 社区版升上来的老库**永远不回填** | `ensure` 只管建列，回填单独跑且只补空值（不覆盖手写值） |

**验收**

```
node scripts/build.mjs                  applied=141 warned=0
node scripts/verify.mjs                 22 组 / 169 条全绿
node scripts/test-silent-failures.mjs   56 通过 / 0 失败（+12 条）
全量回归                                392 条全绿（11 个脚本）
```

**变异测试**：把 `updateCleanup` 改回无条件塞 6 个键 → 7 条红，
失败信息原样复现审计里的那句 `status 只能是 open/done/wontfix，收到 undefined`。

### plus.24 — P17：补回 `consoleDigest` 缺的三段

safe 的 `sections` 有 15 个键，我们只有 12 个。少的正是
`artifacts`（凭据与文件）、`overview`（态势首页）、`env`（环境适配）——
面板读不到就当 0，**三个页签的红点永远不会亮**，属于同一类静默失效。

补回后 `sections` 15 段与 safe 完全对齐，`test-silent-failures.mjs` 断言的是
**段名集合**而不是「有 sections」——少一段就红。

### plus.22 — P16：运行时缺陷审计十项

子智能体做了一轮**运行时**缺陷扫描（只读探针 + 源码对照），产出
[`audit/AUDIT-BUGS.md`](audit/AUDIT-BUGS.md)：高 1 / 中 4 / 低 5。

全部是同一类病：**返回成功但结果不对，或错误被吞成正常值**。这类缺陷不会让任何东西报错，
「有返回就算过」的测试永远抓不到。

| 编号 | 缺陷 | 修法 |
|---|---|---|
| **H-1** | `pocGet` 查不到时 `Object.assign({ok:true}, undefined)` → `{ok:true}`，与「字段全空」同形；同库的 `pocUpdate`/`pocDelete` 都报错 | 显式判空 → `{ok:false,error:'poc not found: …'}` |
| **M-1** | `readAttackFile` 同类假成功；读盘失败只把消息拼进正文，分不出「文件是空的」和「读不出来」 | 判空报错 + 新增 `content_error` 字段 |
| **M-2** | 无靶标时 31 个只读 op 塌成**同一个通用空壳**（`items/total/stats/segments/stages/roles`），而各 op 契约是 `{asset}`/`{nodes,edges}`/`{sections}`/`{base64}`… | 改成 `{ok:false, no_target:true, error:'请先在顶部选择或创建一个靶标'}`，保留 `items:[]` 兼容旧调用方 |
| **M-3** | 软链形态的技能被静默跳过（Dirent 对软链 `isDirectory()`/`isFile()` 都是 false），`ln -s ~/dev/my-skill ~/.dsh/skills/my-skill` 这种常见装法导致技能库恒 0 | 按目标真实类型判；死链 stat 失败当不存在。`listSkills` / `readSkill` / `officialSkillSummaries` 三处 |
| **M-4** | `deletePoc` 删盘失败被吞，仍报 `deleted:true`，`removed_files:0` 与「本来就没落盘文件」无法区分（残留的通常就是 payload） | `catch` 收集 `removed_error` 放进返回体 |
| **L-1** | 模板索引把 `.github/` 下 21 个 CI 文件当 nuclei 模板（真模板必有顶层 `id:`） | `walk()` 加 `id:` 判定 + 缓存版本升到 v2 强制重建 |
| **L-2** | `consoleDigest` 把 SQL 异常吞成 0，schema 漂移时「每页签 0 条」与「确实没新内容」同形 | 收集 `errors[]` 随结果返回 |
| **L-3** | `intelStatus` 的 `stale_count`(0) 与 `resources[].stale`(3) 口径打架 | 缺资源条目 `stale:false`，只留 `missing:true` |
| **L-4** | `{"op":null}` 把 V8 的 `Cannot read properties of null` 当 400 返回 | 非对象请求体一律兜成 `{}` |
| **L-5** | selfcheck 顶层 `ok:false` 但 `needsApply:false`，没有任何可点项（`inferred` 被算成失败） | `inferred` 移出失败集，改放进 `warnings` |

**验收**

```
node scripts/build.mjs                  applied=137 warned=0
node scripts/verify.mjs                 22 组 / 169 条全绿
node scripts/test-silent-failures.mjs   40 通过 / 0 失败（新增脚本）
全量回归                                376 条全绿（11 个脚本）
```

测试不是「断言 ok 存在」，而是**断言具体字段**：`pocGet` 必须 `ok:false` 且错误里带键、
`deletePoc` 必须带 `removed_error`、软链技能必须出现在列表里、`consoleDigest` 在
`ALTER TABLE vuln RENAME` 之后必须 `errors` 非空。

**变异测试**（三条独立还原，各自变红）

| 变异 | 结果 |
|---|---|
| `pocGet` 改回 `Object.assign({ok:true}, …)` | ✗ 2 条（`{"ok":true}` 复现） |
| 去掉模板 `id:` 过滤 | ✗ 1 条 |
| 技能遍历改回 `entry.isDirectory()` | ✗ 1 条（列表只剩真目录） |

**顺带**：`docs/audit/` 现在有子智能体的原始报告（`AUDIT-BUGS.md`）。

### plus.20 — P15：两处「不适用」计数对不上

用户截图：顶部条写「磁盘写入计数 **85/87** · **6** 条本机不适用」，同一屏的健康度卡片写
「**85/85** 条已写入宿主 · 宿主补丁全部就位」，第四格「本端不适用 **8**」。

同一台机器、同一时刻，三个数互相矛盾。**根因不是算错，是两套定义：**

| 来源 | na 口径 | 分母 |
|---|---|---|
| 顶部条（服务端 `gatherState`） | 只算 `status === "na"` → 6 | 93 − 6 = **87** |
| 健康度（客户端 `patchGroupCounts`） | `isNaRow()` 把 `skipped` / `missing_file` 一起塞进 na → 8 | 93 − 8 = **85** |

后果比数字丑严重得多：**85/85 配「全部就位」，而实际有 2 条补丁（`#76` `#80`）什么都没写。**
「跳过」被伪装成「不需要」，缺口从界面上彻底消失。

**定一条口径，两边都按它走：**

| 状态 | 含义 | 分母 | 视觉 |
|---|---|---|---|
| `na` | 本机没有这个组件 | **不进** | 灰虚线，永远 0 工作量 |
| `skipped` | 本机没有这条补丁要改的内容 | **留在** | 灰实线，单独一格 |
| `missing_file` | 必需补丁的目标文件不在 | **留在** | 灰实线，单独一格（这是真缺口，更不能藏） |
| `pending` | 锚点还在，没写盘 | 留在 | 黄 |
| `applied` | 已写入 | 留在 | 绿 |

改后：`85 已应用 + 0 待应用 + 0 未启用 + 2 跳过 + 6 本端不适用 = 93`，分母 87，
结论句按 `pending → skipped → ok` 降级，有跳过时**不再**说「全部就位」。

顺带三处：顶部条文案统一成「本端不适用」（原来一处「本机」一处「本端」）；过滤条新增
独立的「跳过」按钮；指标格从 `repeat(4, …)` 改 `auto-fit`，5 格不会被挤到第二行。

**验收**

```
node scripts/build.mjs              applied=118 warned=0
node scripts/verify.mjs             22 组 / 169 条全绿
node scripts/test-status-labels.mjs 85 通过 / 0 失败（[12] 新增 23 条）
全量回归                            336 条全绿（10 个脚本）
安装                                384 文件 · 逐字节 diff 0 · 0 个 ._ 边车
```

**变异测试**：把 `isNaRow` 改回旧的三合一 → 6 条红，且失败信息原样复现用户截图里的那对数
（client `{applied:85, denom:85, na:8}` vs server `{85, 87, 6}`）。

**[12] 里有一条活体对账**：宿主在跑时直接拉 `/dsh-purge/status`，拿服务端的 `patch_status`
喂给客户端的分桶函数，断言两边算出的 applied / denom / na 完全相等。这是当初漏掉它的那条断言——
只测「key 存在」永远发现不了「两边各算一套」。

### plus.19 — P14b：状态胶囊在行内垂直居中

用户第二次指着截图说「胶囊在一行中需要上下居中，你这明显不是」。上一轮我只改了列宽，
**没碰垂直方向**——这轮补上。

**根因不是胶囊自己。** 基础样式 `.dshpp-table td` 本来就是 `vertical-align: middle`，
是**页面作用域**那条 `(th, td)` 规则把它改成了 `top`：

```css
.dshpp-page .dshpp-table th,
.dshpp-page .dshpp-table td {
  vertical-align: top;   /* ← 这里，把所有单元格顶到行首 */
}
```

单行行看不出来（行高就是内容高）；三行行（中文名 / 英文标识 / 原因）能差出一整个胶囊的高度。
实测 71.2px 高的行、23.8px 高的胶囊：改前上间距 **7.5px**、下间距 **39.9px**。

**只改最后一列**：

```css
.dshpp-page .dshpp-table td:last-child { vertical-align: middle; }
```

首列 `#35` 必须留在 `top`——它该和标题首行对齐，居中了反而像浮在行中间。
特异性 (0,3,1) 高于被覆盖的 (0,2,1)，不依赖源序。

改后实测（同一份 HTML + 同一份产物 CSS，Chromium 渲染）：

| | 行高 | 胶囊高 | 上间距 | 下间距 |
|---|---:|---:|---:|---:|
| 改前 | 71.2 | 23.8 | 7.5 | 39.9 |
| 改后 | 71.2 | 23.8 | **23.7** | **23.7** |

23.7 × 2 + 23.8 = 71.2，整除，没有半像素残差。

**变异测试**（两条都红）

| 变异 | 结果 |
|---|---|
| 去掉这条规则 | `[11]` 红 1 条（状态列单独改回 middle） |
| 把 `td:last-child` 改成 `td`（整表居中） | `[11]` 红 2 条（首列会被拉到行中间） |

`plus.17` / `plus.18` 是这一版的中间构建（17 是 CSS 内容，18 只改了本文件）。
按 T7 的规矩内容变了就得提版本，所以最终交付是 **plus.19**；17 / 18 都不作为交付物。

### plus.14 – plus.16 — P14：状态胶囊的列位置 /「跳过」的原因 / 打包卫生

用户截图两处，加上我在核对安装产物时发现的一处。

**① 状态列吞掉剩余宽度**

宽屏下 `table-layout` 是 `auto`（只有 `≤640px` 的容器查询才改 `fixed`），
状态列作为最后一列把**全部剩余宽度**吃掉。760px 容器实测：列宽 246px、
胶囊 53~88px、右侧空 158px——胶囊孤零零贴在列左端，看不出和表头「状态」是一列。

修法是给它定宽，并让胶囊不换行：

```css
@container purge-page (min-width: 641px) {
  .dshpp-page .dshpp-table :is(th, td):last-child { width: 120px; }
  .dshpp-page .dshpp-table .dshpp-pill { white-space: nowrap; }
}
```

必须写成 `min-width` 容器查询，不能直接追加到页面 CSS 末尾：`≤640px` 那条
`88px` 的规则同选择器、同特异性，**靠源序决胜**，顺序反了窄屏就会被 120px 覆盖，
360px 屏幕上直接顶破容器。

**②「跳过」与「缺目标文件」共用同一句原因**

胶囊文案上一轮已经分开，但每行下面那行小字（`t("hint." + st)`）没分：
`hint.skipped` 和 `hint.missing_file` 都是「目标文件不在本安装里」。
而 `skipped` 的成因里根本没有「文件不存在」：

| 成因 | 含义 |
|---|---|
| `silentWhenMissing` | 补丁自己声明「找不到就是正确状态」 |
| `settleWhenAbsent` | 撤销型补丁，宿主里本来没加过 = 已经到位 |
| `fileOptional` | 这段逻辑在新版宿主里已经搬走 |

新文案：「本机没有这条补丁要处理的内容，已声明可跳过。」

**③ #35 是假阴性，不是没生效**

#35 `ESCALATION_NEVER_REJECT` 报「跳过」，但它的行为其实**已经到位**——
只是由 #14 `ESCALATION_GRANT_UNCONDITIONAL` 干的：#14 把整个 `approveEscalation`
换成 `return mode`，#35 要替换的那段 `switch` 随之消失 → `silentWhenMissing` → `skipped`。

真宿主文件里的证据：

```js
async function approveEscalation(request, approval) {
  const { requestedMode: mode } = request;
  // [dsh-purge] escalation bypass: every escalation request is granted.
  return mode;
}
```

这句话正是 #14 的 `replace`，而 #35 只认自己的 `[dsh-purge] escalation never rejected`。
**假阴性比假阳性更危险**：用户会以为这条保护没上。修法是收录同效标记：

```js
markersAny: true,   // markers 默认要求全部命中，不给就永远 false
markers: ["[dsh-purge] escalation never rejected",
          "[dsh-purge] escalation bypass: every escalation request is granted."],
```

**过程中自己踩的一个坑（值得单列）**：第一次写这段替换时把换行写成了字面 `\n`，
于是插进源码的是**一行**注释，`markersAny` 和 `markers` 整段被行注释吃掉。
文本 grep 全绿，运行时 `patch.markers === undefined`。
所以测试从「查文本」改成「真 `import` 出来查对象」：

```js
const mod = await import(.../lib/patches/index.mjs);
const p35 = mod.ALL_PATCHES.find(p => String(p.id) === "35");
ok(Array.isArray(p35.markers) && p35.markers.length === 2, ...);
ok(p35.markersAny === true, ...);
ok(patchApplied(真宿主文件, p35) === true, ...);   // ← 直接对真文件判定
```

**验收**

```
node scripts/build.mjs              applied=89 warned=0
node scripts/verify.mjs             22 组 / 169 条全绿
node scripts/test-status-labels.mjs 57 通过 / 0 失败
回归                                308 条全绿（10 个脚本）
安装                                1.7.20-plus.17 · 384 文件 · 0 边车 · diff 0
```

**变异测试**

| 变异 | 结果 |
|---|---|
| 宽屏规则改成 `max-width: 641px` | 2 条红：`存在 min-width` / `列宽落在合理区间` |
| 宽屏规则挪到窄屏规则之前 | 1 条红：`窄屏规则排在宽屏规则之前` |
| `hint.skipped` 改回与 `missing_file` 同句 | 3 条红：中英不同、不再声称「不在本安装」 |
| `markers` 的换行写回字面 `\n` | 2 条红：`运行时 patch.markers 真的是 2 条` / `patchApplied === true` |
| 打包去掉 `--no-xattrs` | 安装后 787 文件 / 403 边车（人工核对，无自动化断言） |

---

### plus.12 / plus.13 — P13b：「本端不需要」改灰虚线（tone 与「已生效」分开）

**触发**：用户明确要求「把『本端不需要』做成虚线边框的中性胶囊，颜色也用灰色」。

plus.10 把三种「不适用」拆成了三句话，但 `na` 仍然拿 `ok` 这个 tone——**和 `applied` 同色**。
于是「已经生效」与「本机根本没这个组件」在视觉上依然等价，只能靠读字区分。
一片绿看起来像「全打上了」，而其中可能有一半是本机压根没有的组件。

**改法**：给 `na` 单独一个 tone，不复用 `miss`。

```
statusKind("na")   ok → na
.dshpp-pill.is-na                    { color: var(--dshpp-mute); border-style: dashed }
.dshpp-page .dshpp-pill.is-na        { color: var(--dshpp-mute); border-style: dashed }
```

视觉语汇：

| | 颜色 | 边框 | 含义 |
|---|---|---|---|
| `applied` | 绿 | 实线 | 真的写进去了，重启生效 |
| `na` | 灰 | **虚线** | 本机没有这个组件，永远不会生效 |
| `skipped` / `missing_file` | 灰 | 实线 | 需要，但没落地 |
| `pending` | 黄 | 实线 | 等你点应用 |
| `drifted` / `unmatched` / `partial` | 红 | 实线 | 出问题 |

`skipped` / `missing_file` 故意**不动**：它们与 `na` 同为灰，
靠「实线 / 虚线」区分「需要但没成」与「本来就不需要」，比再引入第三种灰更清楚。
虚线这套语汇也不是新发明的——四格指标里的 `.dshpp-tile.is-na` 一直是虚线。

**两处样式都要加，缺一处就退回实线**：
页面作用域给 `is-ok` / `is-wait` / `is-bad` 各自定了描边色，
`is-na` 不写就会落回 `.dshpp-page .dshpp-pill` 的 `border: 1px solid var(--dshpp-line)`——
颜色对了，虚线丢了。这条有独立断言，并且变异测试证明它会红。

**验收**

```
node scripts/build.mjs               applied=85 warned=0
node scripts/test-status-labels.mjs  37 通过 / 0 失败（原 26 + 新增 11）
node scripts/verify.mjs              22 组 / 169 条全绿（无回归）
安装后 384 文件逐字节一致（different=0）
```

**变异测试（两种改法都红）**

| 变异 | 结果 |
|---|---|
| `statusKind("na")` 改回 `ok` | 2 条红：`na → 独立 tone` / `na ≠ applied` |
| 只删页面作用域那条 `.dshpp-page .dshpp-pill.is-na` | 1 条红：`页面作用域也有…（否则退回实线）` |

**过程记录**：本轮第一次构建出 `plus.12.tgz` 时账本还没改完，随后删掉 tgz 与 `.content`
边车、补完文档再构建了一次——即 T4 规则 2 的「先 rm 再装」那个出口。

**plus.12 → plus.13 只差一个数字**：装完 plus.12 后核对回归总数，发现账本表头写的是 242
（只列了 7 个脚本），而实际跑出来是 288（10 个脚本，漏了 cleanup / coverage / fullscreen）。
账本是唯一事实来源，表头数字错了比没有更糟，所以改正后重建为 plus.13。
**功能内容 plus.12 与 plus.13 完全一致**，差异只有 `docs/PROGRESS.md` 那一行。

### plus.10 — P13：状态词条消歧 + 明细首列排版（附构建守卫 T7）

**触发**：用户贴了补丁详情截图问「同样是『本端不适用』，为什么一张是绿的、一张是灰的」。

**根因是文案丢信息、颜色留信息**：

```
statusLabel()   na / skipped / missing_file  →  全部 t("health.na")  = 「本端不适用」
statusKind()    na → ok（绿）  skipped/missing_file → miss（灰）
```

三个状态印同一句话，却拿到两种颜色。于是**颜色成了唯一线索，而没有任何地方解释颜色**。

三个状态的真实含义完全不同：

| 状态 | 什么情况 | 该不该管 | 现在的显示 |
|---|---|---|---|
| `na` | 补丁自己声明 `optional`，本机本来就没有这个组件 | 永远不用管 | 绿「本端不需要」 |
| `skipped` | 声明了目标可缺（`fileOptional` / `silentWhenMissing`），或 hooks-deny 的「本机没被改过」降级 | 没落地，但不是问题 | 灰「跳过」 |
| `missing_file` | **必需**补丁的目标文件不在本安装里 | 这个补丁在本机实际没生效 | 灰「缺目标文件」 |

**顺带修掉一处老碰撞**：`off` 与 `skipped` 都走 `status.skipped`（都显示「跳过」）。
`status.off`（已关闭）这个词条一直躺在 locale 里没人用——接上它。

**桶名与行标签是两回事，刻意保留**：筛选条那个「本端不适用 N」是**桶**，
含义是「这些不进分母」（`denom = total - na`，`steps.foot` 也这么写）。
它把三种状态合在一起是对的；行内胶囊必须分开说。改完之后同一个屏幕上不会再有
两行印一样的字。

**第二处**：截图里 `#35` 被挤成竖排三行（`#` / `3` / `5`）。
`.dshpp-id` 定宽 42px，而页面样式把 `td` 左右内边距加到 15px，
内容盒只剩 12px；再叠上 `td` 的 `overflow-wrap:anywhere`，
浏览器就被允许在任意字符间断行。列宽给到 64px + `white-space:nowrap` +
`overflow-wrap:normal`，窄屏那条容器查询同步 44px → 60px（否则 ≤640px 会被压回去）。

**验收**

```
node scripts/build.mjs               applied=82 warned=0
node scripts/verify.mjs              22 组 / 169 条全绿（无回归）
node scripts/test-status-labels.mjs  26 通过 / 0 失败
安装后 384 文件逐字节一致（different=0）
```

测试从**构建产物里切出 `statusLabel()` 的真身**跑（`new Function`），不是重写一份等价逻辑。
含一条变异验证：把 `skipped` 与 `missing_file` 都改回 `health.na`（还原截图那一刻的状态），
「三者互不相同」立刻变红。

### plus.8 — P5 / P6 / P7 / P8 / P9 / P10 / P11 / P12（一次做完）

八项一起落地，验收到 22 组 169 条。这里只记**需要解释的决定**，逐条实现在代码注释里。

**P5 站内全屏**：补 `useWorkbenchFullscreen` 钩子（250 行）+ 4 个开窗入口收口。
写的时候踩到一个自己造的坑：把「同节点算包含」并进了 `rtFullContains`，于是
`current === target` 被 Escape 处理器当成「有子浮层占着」直接 return，**全屏退不出去**。
回归脚本第 3 条就是这个，红过一次。

**P7 覆盖度引擎**：3 表 + 4 op + 6 工具。与 safe 的两处刻意差异写在
`overlay/snippets/store-coverage.js` 头注释：① 收口额外检查「有没有挂着没推完的发现」；
② 内外网归属按 `scopeOfIp` 现算，不读 `asset.scope`（本包 asset 表没这列）。

**P8 四段式报告**：`data_proof` 表（列名与 safe 逐字一致）+ `reportV2` + `ReportV2` 组件。
最关键的一条纪律：**`reportV2` 不重算分值**，全部来自 `scoreReport`。
verify `[20]` 有两条断言守它（复用 scoreReport / 不直接查 score_hit），
因为「报告 350、面板 320」这种差异一旦出现，整份交付物就作废了。
界面用 `ReportTabPlus` 包一层而不是改 `ReportTab`：数据出问题就退回条目式视图，不给人白页。

**P11 复合入口**：8 个工具 + `scopeCheckTarget` / `pivotProbe` 两个 store 方法。
范围核对**不解析域名**（核对动作不该产生网络副作用，CDN 地址也不该判成「在范围内」）；
隧道实测返回**逐个目标**的可达矩阵（只给 reachable/total 看不出是哪几个不通）；
模板保鲜**不联网**（与 P10 同一纪律）。

**P8 第四个 bug（渲染测试抓到的）**：`cleanupSummary()` 只回计数、不回行，
我一开始拿它当第四段的数据源 —— 结果是「有 2 条遗留」的靶标，报告里第四段是一张空表。
**「没有遗留」和「有遗留但没显示」在交付物里是完全相反的两件事**，这个必须单列：
计数仍用 `cleanupSummary`（按 kind 归好类），明细改用 `listCleanup`。

**P12 证据账本 UI**：本包独有的一页。三个数字分开报：`unresolved_claims`（别人说的、我没核的）、
`total`、`unknown_total`。`empty` 单独一个布尔——「还没开始记账」与「全部核实完毕」
必须长得不一样，混在一起就是假绿灯。账本被改过时 `degraded=true` 降级展示原始列，不白屏。

**回归与变异测试**

```
verify            22 组 / 169 条
test-attention    43
test-nav-groups   38
test-report-v2    42
test-composite    28
test-evidence     31
test-report-v2-ui 23   ← 用真数据 + 记录型 h() 递归渲染（不是字符串断言）
```

变异测试（三种改法全部被抓住）：

| 变异 | 结果 |
|---|---|
| 内网入口不再要求「真的进去了」 | report-v2 红 2 条（旁路扫到的打印机被写成入口） |
| `empty` 恒为 false | evidence 红 1 条（空账本被当成绿灯） |
| `/0` 掩码用 `<<` 不用 `>>>` | composite 红 2 条（8.8.8.8 判成不在范围） |
| 第四段数据源改回 `cleanupSummary` | ui 红 1 条（有遗留但表格空） |

**T6 追加**：本轮多次 `node scripts/build.mjs` 又原地覆盖了 `plus.7.tgz`。
已把 `revision` 提到 8 并产出 `plus.8.tgz`；**`plus.7.tgz` 内容不可信，不要再装**。
教训仍然是那条：`revision` 要在**第一次改源码时**就提，构建本身就是一次产物变更。


### 工作区（未发版）— P9：清理清单

`cleanup_item` 一张表 + 4 op + 1 工具。这张表不是「发现」，是「待办」：
演练结束前必须回答**我们留下了什么**（webshell / 自建账号 / 上传文件 / 改过的配置 / 隧道）。

三条刻意的规矩：

1. **`wontfix` 必须写原因**。不清理是一个决定，不是遗漏；没有原因的 wontfix
   在报告里和「忘了做」完全一样，靶标方拿到手没法判断风险。
2. **去重只挡「未收口」的**。同 `target`+`kind` 且 `status='open'` 才算重复 ——
   已经清理掉的位置后来又出现，那是新的待办，不能被去重吞掉。
3. **`cleared` 只等于 `open === 0`**。`done` 和 `wontfix` 都算有结论，
   但只要还有一条 open，就不能宣布收尾。

### 工作区（未发版）— P10：资源保鲜

`intelStatus` / `intelRefresh` 两个 op + 1 工具 + 首页一行徽章。
判据只有两个：文件在不在、多久没动过。

**刻意不联网**。真去下载 KEV / 更新 nuclei 模板是另一件事（要出口、要代理、
要确认授权范围），塞进一个纯读探针会让「看一眼资源状态」变成有外部副作用的操作。
verify 里有一条断言直接扫这段代码：出现 `fetch(` / URL / `tcpConnect` 就红。

**过期与缺失分开报**：过期是「该更新了」（还能用），缺失是「根本没有」（用不了），
两者对下一步的影响完全不同，合成一个布尔值等于把信息扔掉。

### 工作区（未发版）— P7：覆盖度引擎

三张表（`asset_coverage` / `host_coverage` / `host_finding`）、4 个 op、6 个工具。
列名与 safe 2.0.0 完全一致，老库能直接接上已有数据。

**与 safe 的两处刻意差异**

1. **收口判定更严**。safe 只看五个维度是不是 `done|blocked|not_applicable`；
   这里额外检查「有没有挂着还没推完的发现」。不查这个，覆盖度会变成一份自我评价。
2. **内外网归属按 IP 现算**（`scopeOfIp`），不读 `asset.scope`。本包的 `asset` 表**没有**
   scope 列，照抄 safe 的 `COALESCE(a.scope, ...)` 会让每一行退化成同一个值，
   队列把内外网混在一起 —— 这个错不会报错，只会让「下一步打谁」永远是同一批资产。

**顺带解锁的东西**：`attention` 的 `coverage_available` 是**按名字探测**
`hostNextActions`/`assetNextActions` 得出的。两个函数一落地，P3 那个恒为 0 的
`pending_coverage` 自己就通了 —— 不需要改 attention 一行代码。

**验收**

```
node scripts/build.mjs         applied=57 warned=0 · 54 处 UI 片段
node scripts/verify.mjs        [17] 8 条新断言
node scripts/test-coverage.mjs 19 通过 / 0 失败（真库，node:sqlite + 临时目录）
```

回归跑真库不是 mock：覆盖度的坑几乎全在 SQL 与状态词校验上（列默认值、
`INSERT OR IGNORE`、`UNIQUE(asset_id)`、内外网过滤），用 mock 测这些等于没测。

**回归当场抓到的三个实现 bug**（都是写完觉得「应该没问题」的地方）

| bug | 现象 | 根因 |
|---|---|---|
| `status` 从未写入 | `closeAssetCoverage` 返回 `open`，队列永远认为没做完 | `updateAssetCoverage` 的字段循环里没有 `status` —— 它不在五项里，而我没单独处理 |
| 凭据计数不涨 | 记了一条新凭据，面板数字纹丝不动 | 增量基于行里的裸值，而 `getHostCoverage` 报的是 `max(行内, 从 access_session 推导)`；推导值更大时 +1 等于没加 |
| 无权限主机走了错分支 | 报「还没收口」而不是「必须写 reason」 | 测试自己的前提错了：上一用例往这台机塞了 `access_session`，它已经有权限了 —— 另开一台专门测这条 |

### 工作区（未发版）— P6：态势首页

第 12 个页签，导航第 6 组。一屏回答四个问题：**什么规模 / 谁在等我 / 下一步打谁 / 覆盖到哪了**。

每一栏都带一个能直接点的动作，不是只给数字 —— 这块地方是决策入口，不是仪表盘。

**五路数据源并发**（`snapshot` / `coverageSummary` / `attention` / `assetCoverage next` /
`hostCoverage next`），任一路失败降级成 `null` 而不是整块红掉：首页不该因为某个 op
没实现就打不开。覆盖度引擎未启用时明说「无法判断是否还有缺口」，不把缺失伪装成 0。

**分发位置有讲究**：`st.tab === 'overview'` 必须排在 `else if (!eng)` **之前**，
否则选中靶标之前点首页什么都不发生。

### 工作区（未发版）— P5：站内全屏

**先说一处更正**：上一轮我说「safe 自己那份也是有码无出口」，这句不成立。
`safe/lib/redteam/client.js:16098` 确实有 `shellProps.ref = shellElementRef`，safe 的接线是完整的。
真正的缺口在**本包**：`lib/redteam/client.js` 从来没有 `useWorkbenchFullscreen`，
「全面浏览」走的是 `window.open(... + '#redteam-full')` —— 桌面端开出来是一个裸浏览器窗口，
宿主的会话、主题变量、事件通道全丢。

**做了什么**

| 面 | 内容 |
|---|---|
| 钩子 | `overlay/snippets/fullscreen-hook.js`（≈250 行），移植自 `safe/lib/ui-fullscreen.js` |
| 状态 | `const full = fullscreen.expanded \|\| isFullWindow()`，hash 入口保留兼容 |
| 出口 | `shellProps.ref = shellRef` —— 挂在外壳上，**不是**只在 full 分支挂 |
| 事件 | `FULL_REQUEST_EVENT` + `requestInPlaceFull()`，返回「是否被接住」 |
| 入口 | 侧栏图标 / 授权后跳转 / 授权弹窗「同意并全面浏览」三处全部改走原地铺满 |

**四处必须解释的判断**

1. **先置 CSS 状态，再请求原生全屏**。`requestFullscreen()` 是异步的，可能在手势失效后才被拒。
   先置位 → 界面立刻铺满；原生批了就再叠一层，被拒就安静留在 CSS 铺满。
   反过来写（等原生成功再铺）在被拒时什么都不发生，用户以为按钮坏了。

2. **`rtFullContains` 同节点必须为 false**。这个坑真踩到了：
   第一版把「同节点」并进「包含」，结果 `current === target` 被 Escape 处理器当成
   「有子浮层占着全屏」而直接 return —— 全屏退不出去。回归第 4 条当场红了。
   现在语义固定为「只判包含子节点」，需要「我自己占着」的地方一律显式写 `current === target`。

3. **嵌入形态不套 `.rt-full`**。宿主 `.dshpp-native` 用了 `container-type: inline-size`，
   它隐含的 `contain: layout` 会给 `position: fixed` 建包含块 —— `.rt-full` 于是只铺满
   右侧栏而不是窗口。嵌入形态改用原生全屏（浏览器把元素提到 top layer，不受包含块影响），
   并在 CSS 里显式补 `.rt-dock.rt-embedded:fullscreen{position:fixed;inset:0}`，
   因为 `.rt-embedded` 自己的 `position:relative` 会压住 UA 样式。

4. **原生失败要有兜底**。嵌入形态没有 CSS 兜底，所以 `openFull` 在 250ms 后检查
   `document.fullscreenElement`，没成的话退回开新窗口。功能还在，只是不优雅。

**验收**

```
node scripts/build.mjs              applied=52 warned=0 · 54 处 UI 片段（两份产物）
node scripts/verify.mjs             [16] 6 条新断言（总 107 条）
node scripts/test-fullscreen.mjs    17 通过 / 0 失败
node --check client.js / lib/redteam/client.js   均通过
```

回归从构建产物里切 marker 之间的原文跑，自带一个只实现四个钩子的迷你 React 驱动
（setter 与 useCallback 引用稳定，否则依赖数组每帧都变，测出来不是真行为）。

**变异测试（三种改法都红）**

| 变异 | 结果 |
|---|---|
| 删掉 `shellProps.ref = shellRef`（即「有码无出口」） | verify 红：`ref=false` |
| 面板侧栏按钮去掉 `if (requestInPlaceFull()) return` | verify 红：`4 个开窗入口里 1 个是无条件开新窗口` |
| 把 `setActive(true)` 挪到 `await` 之后（丢手势） | 回归红 2 条：被拒后不再铺满 / 迟到批准把状态拽回 true |

### plus.6 — T5 + P4：导航分组 / 二级页签

**T5**：补丁 #53 补 `fileOptional: ["web-app-lib"]`，漂移指示器不再被假告警训练到麻木。

**P4**：演练台从「11 个平铺页签」变成「5 个分组 + 组内二级页签」。

| 分组 | 页签 |
|---|---|
| 资产台账 | 资产测绘 |
| 协同进度 | 智能体 |
| 成果与报告 | 漏洞战果 · 凭据与文件 · 攻击链 · 得分目标 · 报告 |
| 资源中心 | 会话隧道 · 知识库 · 技能库 |
| 环境与设置 | 环境适配 |

**与 safe 的三处刻意差异**

1. **横向 chips，不是左侧竖排**。safe 的导航依赖 `rt-chrome`/`rt-nav`/`rt-cmd` 三层布局重写，竖排固定占 ~120px。本包是右侧浮动 dock，默认宽约 420px，竖排等于砍掉三成内容宽度。所以改成一级一行 chips + 组内一行二级页签，`rt-tabs`/`rt-tab` 原样式直接复用。
2. **「凭据与文件」归成果组**。safe 把它放「资源中心」，但在这份产物里它是战果的产物（从漏洞打出来的凭据），跟 `findings` 放一起比跟「知识库」放一起顺手。
3. **别名表 `TAB_ALIASES` 有实际用途**。`testing` / `attackfiles` / `prompts` 这三个历史页签名代码里真的会出现（资产页视图切换、按钮文案、深链）。不做归一会让 `groupOf('testing')` 落到第一组，看起来像分组算错了。

**顺带修掉的一处**

- 分组行用 `<button>` 而不是 `clickable()`：`clickable` 把 `role` 设成 `button`，在 `tablist` 里会被读屏软件当成「按钮」而不是「页签」。`<button>` 原生支持 Enter/Space，也不需要 `role=button` 的键盘垫片。

**验收**

```
node scripts/build.mjs             applied=52 warned=0 · 26 处 UI 片段（两份产物）
node scripts/verify.mjs            [15] 11 条新断言（总 101 条）
node scripts/test-nav-groups.mjs   38 通过 / 0 失败（两份产物各 19 条）
node --check client.js / lib/redteam/client.js   均通过
```

回归脚本从**构建产物里切原文**跑（`new Function`），不是重写一遍等价逻辑——重写的那份永远会过。含渲染断言：用记录型 `h()` 跑分组行，检查真渲染出 5 个按钮、恰好一个选中、`aria-selected` 与 roving `tabindex` 正确、未读红点只在非当前组出现。

**变异测试（两种改法都红）**

| 变异 | 结果 |
|---|---|
| 把 `artifacts` 从成果组拿掉 | 3 条红：`未覆盖 ["artifacts"]` / 别名落到 assets / artifacts 不在成果组 |
| `activateGroup` 改成一律跳本组第一页 | 3 条红：点分组把当前页甩掉 |

### plus.5 — P3：子智能体回报 + 「现在在等谁」

**新增能力**

| 面 | 内容 |
|---|---|
| 表 | `agent_report`（11 列 + 2 索引） |
| store | `parseAgentReport` / `recordAgentReport` / `acknowledgeAgentReports` / `latestAgentReports` / `attentionQueue` |
| op | `attention` / `attentionAck` |
| 工具 | `redteam_attention` |
| UI | `AttentionCard`（两份产物都有）：按「最需要人」排序、就地收口、显示覆盖度可用性 |

**与 safe 的三处刻意差异**（都不是风格问题）

1. **队列在 SQL 里收窄**。safe 是 `SELECT * FROM agent_report` 全表读进 JS 再 `Map` 去重，会话一多就每次全表扫；这里 `JOIN (SELECT session_id, MAX(id) ... GROUP BY session_id)` 直接取「每会话最新一条且未确认」。
2. **覆盖度缺失是显式的**。safe 直接调 `this.hostNextActions(...)`，靠 `TypeError` 被 `try/catch` 吞掉返回 0 —— 于是「覆盖度引擎没装」和「覆盖度真的收口了」打印同一个 0。这里做能力探测，返回 `coverage_available`，并在 `note` 里明说结论只覆盖智能体回报这一路。
3. **伪 JSON 的 `needs` 数组**。safe 的退化解析在 `needs: [凭证, VPN]` 上会得到 `"[凭证"` 这样带方括号的字符串（`[` 混进了第三捕获组）；这里排除 `[` 并把数组内容按逗号切开。

**顺带修掉的两处**

- 回报裁剪：`ORDER BY id DESC LIMIT 20` 保证最新那条必留——这是「裁剪不会把有人在等挤掉」的前提，写进注释了。
- `attentionAck` 支持 `session`（会话绑定）解析，与 `attention` 同口径；不给 `session_id`/`ids`/`all` 时明确报错，不静默成功。

**验收**

```
node scripts/build.mjs      applied=51 warned=0 · 20 处 UI 片段（两份产物）
node scripts/verify.mjs     [14] 20 条断言全绿（总 90 条）
node scripts/test-attention.mjs   40 通过 / 0 失败
```

回归覆盖：严格/伪 JSON 解析、六种非法输入、排序、收口幂等、20 条裁剪、`limit` 边界、表被删后的降级。

### plus.4 — P0/P1/P2

见 [`P0-P2-落地记录.md`](P0-P2-落地记录.md)。

### plus.31 — P20：报告文档视图 · 会话关系图（全量）· 字段级对齐

**为什么这四项一起做**：它们互相咬合 —— 会话图要自己的 op，文档视图要报告页的 markdown，
字段级四项是「上游有、我们缺」的同一批字段。分开做会各改一遍同样的地方。

| 面 | 内容 | 关键决定 |
|---|---|---|
| 报告文档视图 | `mdParseBlocks` / `mdInline` / `mdOutline` / `MarkdownDoc` + `rt-md-*` 样式 | 不引第三方 markdown 库（零外部依赖）；首屏只渲染 400 块、代码块超 4000 字符折叠 |
| 会话关系图 | `sessionGraph()` + op + 全量 `SessionMap`（树布局 / 贝塞尔边 / 拖拽 / 详情 / 搜索） | 数据源是**自己的** `sessions.json`，不直打宿主 `/api/session/list`（无版本承诺，坏了还静默） |
| 字段级 | `scoreReport({layout:'simple'})` 返回 `report`；`bootstrap` 带 stats；`cleanup.location`；`asset.ports` | `simple` 走 `reportV2` 同一实现，**不重算分**，并显式降级成 legacy 防递归 |
| 情报刷新 | `intelUpdate`（CISA KEV + nuclei 模板）走 `dispatchAsync` | 只读探针与真下载**分成两个方法**；下载有大小上限/超时/形状校验/原子落盘 |

**四处刻意的差异（都是修上游的残点）**

1. **布局不做整体平移**。safe 每次渲染把全图挪到左上角，拖拽存的是绝对坐标 → 下一次拖拽起点与存储坐标差一个常量，越拖越飘。这里不平移，代价是拖到左上边界外被裁掉（能拖回来）。
2. **待办/在等谁取自 `agent_report`**。safe 读宿主 `todos` 字段，而那个字段被宿主类型系统排除，第三行恒为「未提供待办」。
3. **手动/自动刷新各一个序号槽**。safe 共用一个 `AbortController`，轮询在途时点刷新会被静默丢弃而按钮文案已恢复。
4. **KEV 校验内容形状**。`JSON.parse` 挡不住「200 + `{}`」；这里要求 `vulnerabilities` 是非空数组且每条有 `cveID`，否则拒绝落盘（旧文件保持不动）。

**验收**

```
node scripts/build.mjs              applied=155 warned=0
node scripts/verify.mjs             23 组 / 202 条全绿（新增 [23] 30 条）
node scripts/test-p20.mjs           108 通过 / 0 失败
全量回归                            521 条全绿（12 个脚本）
安装                                1.7.20-plus.31 · 384 文件 · 0 边车 · diff 0
```

**变异测试（五组，各自独立变红）**

| 变异 | 结果 |
|---|---|
| `SM_LAYER_GAP` 350 → 300 | ✗ 层距 350 |
| `scoreReport` 的 simple 分支 `report: null` | ✗ 四段结构缺失 |
| KEV 不校验空数组 | ✗ 三条（含「旧文件没被覆盖」） |
| `addCleanup` 不写 location | ✗ 读回是 `[null,null]` |
| `mdParseBlocks` 不认表格 | ✗ 块类型序列 + 表头两条 |

### plus.34 — P22：三方审计与缺陷修复

三个只读子智能体分别审「功能覆盖面 / 运行时 / 新 UI 渲染」，共 26 + 若干条。
**其中 8 条是真缺陷，已全部修复并加断言**；其余是功能缺口（见下）。

**修掉的（每条都有对应断言，且都能被变异测试打红）**

| 编号 | 缺陷 | 后果 | 修法 |
|---|---|---|---|
| **R-01** | `mdParseBlocks` 在「以 `\|` 开头但下一行不是表格分隔行」时**死循环** | 标签页 CPU 100% 直到 OOM（实测复现） | 段落兜底分支保证 `i` 前进 |
| **R-02** | KEV 的 meta 路径由 `dest.replace(/\.json$/,'.meta.json')` 推导 | `dest` 不以 `.json` 结尾时 meta 覆盖数据本身（48MB → 11 字节），仍返回 `updated` | meta 路径独立推导，永不等于 dest |
| **R-03** | `cleanup.location` 三处不转发（op / 工具参数 / 报告列） | 列建了、写入支持了，但**永远 NULL**；报告「位置」列显示主机名 | op + 工具 + 报告列 + reportV2 映射四处补齐 |
| **R-04** | 去重键 `kind+target` 不含 location | 同一台主机上第二个 webshell 被静默吞掉（`deduped:true`，一个字节不写）→ 收尾时留在靶标里 | 键改为 `kind+target+location`，并用 `COALESCE` 修掉 NULL 永不匹配 |
| **R-05** | `cleanupSummary` 查询失败 `catch { rows = [] }` | `open=0` → `cleared:true` → 报告与首页一起变绿，**「查不出来」被渲染成对外承诺** | `cleared` 改成三态（`true/false/null`）+ `query_error` |
| **R-09** | nuclei 的 stage 目录只在成功路径删 | 失败残留 ≤256MB，且同 pid 下次会撞名 | `finally` 里无条件清 |
| **R-10** | `renameSync(unpacked, dest)` 跨挂载点必 EXDEV | 从 store.root 换到 `~/.local` 时更新永远失败 | 退到 `cpSync` 递归拷贝；`renameSync(dest, backup)` 移进 try |
| **H-2** | 报告页 `.rt-main` 是 `overflow:hidden` | 文档视图 clientH 371 / scrollH 1784，「继续加载」在框外点不到 | `.rt-main.rt-r2{overflow:auto}` |
| **H-3** | 会话图两栏用 `@media(max-width:760px)` 判断**视口**宽度 | 面板停靠 620px、视口很宽 → 媒体查询不生效，详情栏盖住会话节点 | 改成「默认单栏，≥1000px 才两栏」+ 图区 `overflow:auto` |
| **M-1** | 目录项指向尚未渲染的块 | 500 标题时 300 项点了没反应 | 先 `setLimit` 再滚 |
| **M-3** | 表格不认 `\|` 转义 | 真实报告里 `a\|b` 被切成两格，列数错位 | 按未转义竖线切格 |
| **M-4** | 拖拽不查 `ev.buttons` | 丢了 pointerup 后节点永久跟着鼠标跑 | `buttons===0` 收手 + `pointercancel`/`lostpointercapture` |
| **M-5** | 点图上靶标只改前端 state | 后端「当前靶标」指针没动，智能体仍打在旧靶标 | 走 `activateEngagement` |
| **M-6** | `mdInline` 不校验 href scheme | `[x](javascript:...)` 直接变成可点链接 | 只放行 http/https/mailto/#/相对路径 |

**审计确认「没有」的部分**（正面结论，同样重要）

- 后端 op 93 / 工具 82 / 路由 22 / 页签 13 / 分组 6：**两侧上游没有任何一个在本包里找不到**。
- 前端 55 个 `op:` 字面量**全部有后端分支，零死按钮**。
- 两份前端产物（面板 / 独立窗口）归一化后 **diff 0 行**（MarkdownDoc 182 行、SessionMap 321 行）。
- `addCleanup` 的列 11 / 占位符 11 / 实参 11 **逐项对齐，没有错位**。
- 布局在 21 / 105 / 300 节点下**重叠对数全 0**；3000 块文档首屏只渲染 400 块。

**仍然缺的（功能缺口，不是 bug；要动的话各自要碰 2–4 层）**

| 缺口 | 说明 |
|---|---|
| safe 的 `preset-default.js` / `slot-state.js` / `anchor.js` / `team-mode.js` | 各自独立能力（预设兜底 / 在等人占名额 / system prompt 尾部重锚 / 团队任务板），本包未搬 |
| 16 个 CSS + `ui-theme.js` | 整套皮肤/主题，工作量最大、与功能无关 |
| 4 条 safe optional 补丁（#89/#90/#91/#96） | 宿主版本适配补丁，非功能；`optional+skipIfMarked` |
| `scoreReport layout` / `bootstrap stats` 无消费方 | 字段已对齐（上游同口径），但本包前端暂未渲染 —— 属「API 对等」，不是 bug |


---

## P23 · 七个使用问题的落地（1.7.20-plus.36）

用户提了七个问题，其中四个是「为什么/在哪里」，三个暴露了真缺口。逐条：

| # | 问题 | 结论 | 动作 |
|---|---|---|---|
| 1 | 兼容级别「未验证版本」怎么判 | `kernel.qualified` = agent-loop 与 system-prompt 版本一致 **且** 版本在 `QUALIFIED_HOST_VERSIONS` 硬编码白名单里；`family_qualified` = 宿主家族不是 next/bundled-cli。宿主升到 `0.2.2-rc.5`，白名单最高 `0.2.2-rc.3` → unverified | ✅ 补 `0.2.2-rc.5`（依据：rc.5 上 93 条 = 85 applied + 2 skipped(#76/#80 已知) + 6 na） |
| 2 | 提示词/工具组为什么默认展开 | 规则是「组内有任一条非绿且非 na 就展开」；这两组各有一条 skipped（#76/#80），代码组 54/54 全绿所以收起 | 不改（这是 P19 的设计意图） |
| 3 | 85/87 分母对不对 | 93 − 6 na = 87；85 applied + 2 skipped = 87。na 不进分母（本机没这组件），skipped 留在分母（该做没做成） | 不改（口径正确） |
| 4 | 页脚「基于 …1.1.71 独立维护」 | 从 community 继承的页脚，从来没改过；本包实际是 community 1.7.20 + safe 2.0.0 | ✅ 改为「Community 1.7.20 + safe 2.0.0 独立维护 · MIT / Apache-2.0 · 上游署名见 NOTICE」，且**放在版本重写之后**（否则被改成 `1.7.20-plus.36`） |
| 5 | 建好的靶标在哪删 | **根本没有删除入口**，只能手动 rm 目录（而目录里有它自己的 knowledge.db） | ✅ `deleteEngagement` op + store 方法 + 顶部「删除靶标」按钮；只移不删（`.trash/<id>-<时间戳>`），清会话绑定与当前指针，返回 `mv` 恢复命令；op 要求 `confirm:true` |
| 6 | 清理项 location 在哪填 | 只有 `redteam_cleanup` 工具能写，面板只能看只读汇总 | ✅ 「凭据与文件」页新增「清理清单」卡片：登记表单（kind/target/location/title/detail/priority）+ 逐条收口（已清理 / 不处理需理由 / 重新打开）+ 去重提示 |
| 7 | 更新 KEV/模板后仍「缺 1 项资源」 | 正常：KEV 与 nuclei 都是 0 天，缺的是第三项「字典库」`~/.dsh/redteam/wordlists` | ✅ 徽章点名：「缺 1 项资源（字典库）」；`intelStatus` 增加 `missing_labels` |

**验收**

```
node scripts/build.mjs                 applied=161 warned=0
node scripts/verify.mjs                23 组 / 220 条全绿
node scripts/test-engagement-delete.mjs 43 通过 / 0 失败（本轮新增）
全量回归                                580 条全绿（13 个脚本）
安装                                    1.7.20-plus.36 · 384 文件 · 0 边车 · diff 0
```

**过程中的两个自查纠错**

1. `deleteEngagement('')` 被 `slugify` 兜底成 `engagement-<时间戳>`，于是「忘了传 id」被报成 `not found` —— 报错指错方向。改成先判空再 slugify。
2. 页脚改动最初写在 `BRAND_FIXES`（第 3b 步），结果被第 4c-2 步的 `baseVersion → version` 全局替换污染成「Community 1.7.20-plus.36」。移到 4c-2 之后，并在 `verify` 里加一条「页脚没被版本重写污染」的断言。


---

## P24 · 版本号方案换轨：`1.7.20-plus.N` → `0.1.N`（0.1.37）

**为什么换**：旧方案把上游版本写进了本包版本号。后果是上游一升版，本包版本跳一个次版本
（`1.7.20-plus.9 → 1.7.21-plus.1`），而「我们自己改了什么」反而看不出来；更要紧的是
`1.7.20` 这串会跟着散落到面板标题、徽章、详情页、发行资产名、安装命令里，上游一更新
全都要改一遍，还容易漏（P23 就漏过一次页脚）。

**新方案**：`0.1.<overlay 修订号>`，与基座解耦。基座版本记进 `package.json` 的 `plus.base`，
只作溯源，不进版本号、不进面板、不进资产名。

| 落点 | 改法 |
|---|---|
| `scripts/build.mjs` | `version = 0.1.${plusRev}`，并加 `^0\.1\.\d+$` 守卫；4c-2 之后断言「基座版本无残影」 |
| `overlay/repo.json` | `revision: 37` |
| `client.js` 6 处 | 界面版本 / 一致性比对基准 / 告警文案 / 徽章 / 详情页标题 → `0.1.37`（构建时替换） |
| 页脚 | **不再写任何版本号**：`基于 dsh-purge Community + dsh-purge safe 独立维护 · MIT / Apache-2.0 · 上游署名见 NOTICE` |
| `package.json.description` | `基于 dsh-purge Community + dsh-purge safe 独立维护的 DSH 附加组件。` |
| README 中英 | 版本行更新；「三条设计线」去掉具体版本；安装命令改 `dsh-purge-plus-<ver>.tgz`；新增固定血缘句 |
| `docs/UPSTREAM.md` / `docs/RELEASE.md` | 版本规则、发布步骤、比较示例全部改成 `0.1.N`，并写明迁移期只能手工装一次 |

**迁移注意**：`versionIsNewer("0.1.37", "1.7.20-plus.36")` 是 **false**（数字序），
所以面板不会把 0.1.37 当成更新 —— 从旧版本迁到 0.1.x 必须手工装一次，之后
`0.1.38 > 0.1.37` 恢复正常。历史 tag 仍被 `FORK_RELEASE_RE` 的 `-plus.N` 分支解析。

**验收**

```
node scripts/build.mjs        applied=161 warned=0 · 0.1.37
node scripts/verify.mjs       23 组 / 222 条全绿（[10] 新增 6 条：页脚无版本号 / 无基座残影 / 0.1.N 方案）
全量回归                      580 条全绿（13 个脚本）
安装                          0.1.37 · 384 文件 · 0 边车 · diff 0
```

**过程中的一处自查纠错**：`test-engagement-delete.mjs` 里那条页脚断言写的是旧文案
（带 `1.7.20 + 2.0.0`），换轨后立刻变红 —— 这正是它该做的事。改成「页脚含新血缘句」
+「页脚不含上游版本号」两条。
