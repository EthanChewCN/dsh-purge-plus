<div align="center">

# dsh-purge-plus

**DeepSeek Harness 的指令权威性清洗插件 · 独立变体**

把「宿主层」和「模型层」分开看：模型愿不愿意答是一件事，宿主在它前面加了多少道闸是另一件事。

[![Release](https://img.shields.io/github/v/release/EthanChewCN/dsh-purge-plus?label=release&color=6E56CF)](https://github.com/EthanChewCN/dsh-purge-plus/releases)
[![Patches](https://img.shields.io/badge/宿主补丁-95-3B82F6)]
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.5-22D3EE)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20Apache--2.0-green)]
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=fff)](package.json)

当前版本见上方 Release 徽章（不写死：每发一版都要改文档，改完文档又要再发一版）· 适配 **DSH Desktop 0.2.2-rc.5** · [English](README.en.md)

</div>

---

## 目录

- [它是什么](#它是什么)
- [三条设计线](#三条设计线)
- [能力清单](#能力清单)
- [与两个上游的关系](#与两个上游的关系)
- [安装](#安装)
- [在线升级](#在线升级)
- [维护模型](#维护模型)
- [验收](#验收)
- [目录结构](#目录结构)
- [许可与署名](#许可与署名)
- [常见问题](#常见问题)

---

## 它是什么

DeepSeek Harness 不只是把提示词转发给模型。它会在运行期重写提示词、插审批闸、收紧沙箱策略、迁移会话状态。只问「模型答不答」会把宿主层的拦截误当成模型拒绝。

这个插件做两件事：

1. **让状态可见** —— 安装、补丁、注入到底有没有就绪，一条命令或一屏面板给结论；
2. **把摩擦收敛** —— 反复出现的确认与打断，收敛成一次设置，改坏了能退回原文。

它不改模型，不改云端账号，不上传提示词或配置。所有逻辑跑在你自己机器上，只动本机的 `@deepseek-ai` 包和本地配置。

> 社区里常把它叫作「破甲」或「无限制模式」插件。请在你拥有或已获授权的环境中使用。

---

## 三条设计线

```
基座   dsh-purge Community   MIT         宿主补丁 · 补丁引擎 · 运维层
移植   dsh-purge safe        Apache-2.0  能力面更宽的一条支线
结果   dsh-purge-plus        独立变体     95 条补丁 · 31 组只读验收
```

本仓库**不是** community 的 fork，也**不是** safe 的 fork。它把两个上游都当作只读输入：

- `vendor/community/` —— 基座，原样副本，构建时只读；
- `vendor/safe/` —— 移植来源，原样副本，只用于比对；
- `overlay/` —— 本仓库**全部**改动：新增文件 + **185 条锚点编辑**（`required` 182 / `required:false` 3）
  + **92 处 snippet 注入点** + 4 条品牌文案替换。改动面由 `verify [26]` 组现场复算守卫，
  文档数字与代码不符即验收失败。

---

## 能力清单

| 层 | 内容 |
| :--- | :--- |
| **宿主补丁** | **95 条** = 上游 88 + 自有 7（id ≥ 201） |
| 自有 #201 | `PRODUCT_ANALYTICS_DEFAULT_OFF` —— 产品埋点默认关 |
| 自有 #202 | `PRODUCT_TELEMETRY_OTEL_NOOP` —— 产品遥测 OTLP 导出器变空实现 |
| 自有 #203 | `SESSION_TELEMETRY_OTEL_DISABLED` —— 会话遥测默认 `DISABLED` |
| 自有 #205 | `SESSION_LOG_CLOUD_UPLOAD_UNREGISTER` —— Session Log 上传在注册点短路 |
| 自有 #206 | `SUBAGENT_INHERIT_PARENT_ACCESS` —— 子代理原样继承父会话权限档 |
| 自有模块 | `lib/subagent-fence.js` —— 子代理（叶子节点）不得再派活 |
| 补丁引擎 | 30 个 schema 字段：`drift` / `fileOptional` / `requireAllTargets` / `settleWhenAbsent` / `multiHit` … |
| 运维层 | 审计流水 `audit.jsonl`、跨进程维护锁、回滚事务、逐层自检、运行时探针、漂移检测 |
| 在线升级 | 面板「检查更新」可用，匿名拉 GitHub 发行，逐字节核 `SHA256SUMS.txt` |
| 演练台 | 左侧栏整页设置 + 红队事实库（SQLite），12 个页签 |

---

## 与两个上游的关系

**基于 dsh-purge Community + dsh-purge safe 独立维护。** 两个上游都当只读输入，不跟随任何一方的版本号。

| 维度 | dsh-purge-community | dsh-purge-safe | 本仓库 |
| :--- | :--- | :--- | :--- |
| 补丁引擎 schema | **30 个字段** | 19 个字段 | 取 community |
| 漂移检测 | **16 处**，能说出「为什么没打上」 | 无 | 取 community |
| 运维层 | **15 个模块 / 1,441 行** | 精简 | 取 community |
| 更新通道 | **可用** | 仓库坐标留空 | 取 community，改指本仓库 |
| 补丁覆盖 | 88 条 | 59 条（2.0.0）/ 62（2.0.1）/ 64（2.0.2） | 以 community 为基 |
| 运行时钩子 | 10 个事件 | **13 个事件** | 按需 |
| 宿主写入提权 | 无 | **`ensureHostWritable` 四件套** | 已列入路线图 |
| 演练台 | 10 tab | 12 tab + 6 分组 | **11 tab**（已并入「凭据与文件」）；6 分组导航在路线图 |
| 技能库 | 23 个 | 40 个 | **40 个**（23 + safe 独有 17，逐条核对工具引用） |
| 团队任务板 | 无 | 默认开（根会话） | **已移植 + 有面板入口**（`team/mode` 开关、任务板页签、历史开关审计/清理） |
| 情报数据层 | 无 | KEV / CVE 底库 / 云同步 | **已移植 + 有构建器**（kev / cve-db / intel-sync；`scripts/build-cve-db.mjs` 从 NVD + KEV + EPSS 建本机库，数据不随包发） |

### 为什么不整包用 safe

这不是「谁更新」的问题，是三条硬冲突：

**① 编号体系已经分叉。** 两条线共用一套 id，但 `#52`、`#89`–`#96` 这 9 个 id 在两边的语义**完全不同**（safe 的 `#90` 是 OpenAI 原生 system 槽，community 的 `#90` 是恢复原生插话）。整包合并只能二选一，另一边的账目就丢了 —— 而「账目」正是这个插件最值钱的部分。

**② safe 内建一层「地域拒绝」。** `safe/lib/net-scope.js` 定义了 `DENIAL` 常量并挂在 `agent/pre-step` 上，命中就往会话里写一条拒绝文本、把这一轮收空。这跟本插件的目标正好相反；整包合并会把它一起带进来。这是**整包合并的硬阻断项**，不是风格偏好。

**③ safe 的更新通道是空的。** `safe/lib/update.js` 里 `const REPO = ""`，所有 GitHub URL 会拼成 `repos//…`。整包用就没有面板升级。

反过来，safe 有三样东西值得单独搬，我们按「能不能在这个基座上等价实现」逐条判：

- 能等价实现的 → 搬（遥测三连关、Session Log 硬移除、子代理权限继承）；
- 基座已有更强实现的 → 不搬（`#9` 已把审批 `decide()` 直接改成放行，比 safe 的运行时降级更彻底）；
- 与宿主契约冲突的 → 不搬（`#89` 把系统提示词塞进一个**没有 provider 会读**的 `system` 字段，等于丢提示词）。

逐条判定与源码证据（含**上轮判断的 11 处勘误**）在开发期逐条留证，**不随仓库发布**；README 只给结论与可复现的入口。

### 为什么不是简单 fork

fork-and-edit 的第二次升级必死：上游一动，本地改动全变成冲突。

这里 `vendor/` 永远是上游原样，改动只有「新增文件 + 精确锚点插入」。升级时整目录替换 `vendor/community`，锚点对不上就**构建硬失败**并打印文件名与锚点，而不是静默产出一个语义跑偏的包。

---

## 安装

### 前置

- DSH Desktop **0.2.2-rc.5**（`0.2.2-rc.1` 起同样通过）
- 已至少启动过一次 DSH，profile 已初始化
- 平台：基座本身覆盖 macOS / Windows / Linux；本仓库的改动不分平台，但**只在 macOS 上实测过** ——
  Windows / Linux 上用出问题请带日志开 issue，不要当成"应该没问题"
- **先卸掉 `dsh-purge-community` 或 `dsh-purge-safe`** —— 三个包会往同一批宿主文件打补丁，`.dshpurge.bak` 基线会互相污染

### 方式零：下载发行包（不需要源码，推荐给使用者）

1. 打开 [Releases](https://github.com/EthanChewCN/dsh-purge-plus/releases/latest)，
   下载 **`dsh-purge-plus-<ver>.tgz`** 与 **`SHA256SUMS.txt`**；
2. 校验（不一致就别装）：

```bash
shasum -a 256 -c SHA256SUMS.txt
```

3. DSH 面板 → **插件 → 从文件安装** → 选那个 tgz → 重启 DSH。

发行包是纯 tarball（`dsh.install.preferred = "tarball"`），安装时不需要 git、不需要 npm 源。
本仓库根目录**不是**一个可安装的包（没有 `package.json`），所以 `pnpm add git+…` 走不通 —— 请用发行包。

### 方式一：从源码构建（给改代码的人）

```bash
node scripts/build.mjs      # → dist/dsh-purge-plus-<ver>.tgz
node scripts/verify.mjs     # 31 组只读验收，不动宿主
```

然后同上：面板 → 插件 → 从文件安装 → 选 `dist/dsh-purge-plus-<ver>.tgz` → 重启 DSH。

### 方式二：命令行

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-purge-community
pnpm add "file:$HOME/Documents/dsh-purge-plus/dist/dsh-purge-plus-<ver>.tgz"
```

装完确认 `package.json` 的 `dsh.profile.bundles` 里有 **`dsh-purge-plus`**，且 `node_modules/dsh-purge-plus/` 存在。

> **包名与目录名必须一致。** 宿主的 `cordis.patch.yml` 用 `name:` 声明要加载哪个包，再走 `createRequire(profile).resolve(name)`。目录名对不上会 `MODULE_NOT_FOUND`，而且**整个 bundle 被静默跳过** —— 面板看着装了，实际一条补丁都不打。构建脚本会自动把 `cordis.patch.yml` 里的 5 处名字改成新包名，`verify` 第 [8] 组守着这条。

### 从社区版 / safe 迁移

宿主文件里可能残留旧插件的标记。安全顺序：

```bash
# 1) 旧插件先 revert，把宿主还原成官方原文
node node_modules/dsh-purge-community/bin/dsh-purge.js --revert

# 2) 再装本仓库
# 3) 应用
node node_modules/dsh-purge-plus/bin/dsh-purge.js --apply
```

`.dshpurge.bak` 是**独占创建**的（`open(wx)`），已存在的备份不会被覆盖 —— 换插件不会把原始基线写坏。

### 卸载与回滚

```bash
node node_modules/dsh-purge-plus/bin/dsh-purge.js --revert   # 宿主回到官方原文
pnpm remove dsh-purge-plus                                   # 摘掉插件
```

---

## 在线升级

**能在面板里点升级**，和社区版一样。更新器是继承来的，本仓库只把「找谁要新版本」的常量改指自己。

| 改动 | 文件 |
| :--- | :--- |
| `REPOSITORY` → 本仓库 | `lib/community.js` |
| `SOURCE_REPO` → 本仓库 | `lib/update-net.js` |
| 发行 tag 白名单接受 `-plus.N` | `lib/update.js` `FORK_RELEASE_RE` |
| 同一道闸门的**两处内联正则** | `lib/community.js`（列表过滤 + 安装前校验） |
| 历史条目按当前 releases 过滤 | `lib/update.js` |
| 已安装包身份认 `dsh-purge-plus` | `lib/installed-package.js` |
| 回滚允许的依赖名 | `lib/rollback-transaction.js` |

**为什么「两处内联正则」单列**：只放宽 `update.js` 的 `FORK_RELEASE_RE` 时，发行列表能列出来，但点「安装」会抛「只安装正式发布版本」—— 因为 `community.js` 里还有两个硬编码的 `/^v\d+\.\d+\.\d+$/`。这是实测踩到的，不是推测。

发布约定：tag `v<version>` · 资产 `dsh-purge-plus-<version>.tgz` · 同 release 下 `SHA256SUMS.txt` · 默认分支 `master` · release 不能是 draft / prerelease。完整流程与排错表见 **RELEASE.md**。

> 更新器默认匿名访问 `api.github.com`，配额 60 次/小时/IP。撞限流会自动降级到 `releases.atom`。

---

## 维护模型

```bash
./scripts/sync-upstream.sh <新版本 tgz>   # 换 vendor → 重放 overlay → 重建 → 验收
```

| 阶段 | 动作 | 失败会怎样 |
| :--- | :--- | :--- |
| 换 vendor | 整目录替换 `vendor/community` | — |
| 重放 overlay | 185 条锚点编辑逐条插入 | 命中数不符 → **构建中止**，打印文件与锚点 |
| 重建 | vendor + overlay → `dist/package` → tgz | 断言不符 → 中止 |
| 验收 | 31 组只读检查 | 任一组红 → 非零退出 |

锚点「恰好命中 N 次」是硬约束：命中 0 次 = 宿主升级后锚点烂了；命中 ≥2 次 = 会打歪。两种情况都直接失败。

详见 **UPSTREAM.md**。

---

## 验收

```bash
node scripts/verify.mjs
```

| # | 检查 | 失败意味着 |
| :--- | :--- | :--- |
| 1 | 补丁表 / 围栏 / 入口可 import | 包结构坏了 |
| 2 | 95 条、自有 7 条、id 无重复 | 补丁表被改坏 |
| 3 | 真实宿主 `--status` 能定位 `@deepseek-ai` 根 | 宿主路径变了 |
| 4 | 自有 7 条出现在状态里 | 补丁没接进汇总入口 |
| 5 | 每条自有补丁的锚点在宿主上恰好命中 1 次 | 宿主升级后锚点失效 |
| 6 | 插件入口在 DSH 解析上下文下加载成功 | 导出形状变了 |
| 7 | 在线更新通道（tag 白名单 / 版本比较 / 资产名 / 坐标残留） | 面板升级会失效 |
| 8 | `cordis.patch.yml` 插件名与包名一致 | bundle 会被静默跳过 |

全部只读，不写宿主、不改状态。

---

## 目录结构

```
vendor/community/          上游基座，原样副本，构建时只读
vendor/safe/               移植来源，原样副本，只用于比对
overlay/files/             新增文件
  ├─ lib/patches/overlay.mjs   自有补丁表 #201–#206
  ├─ lib/subagent-fence.js     叶子节点围栏
  └─ NOTICE-PLUS.md            署名与改动记录
overlay/edits.mjs          185 条锚点编辑清单
overlay/repo.json          仓库坐标 + 本仓库修订号
scripts/build.mjs          vendor + overlay → dist → tgz
scripts/verify.mjs         31 组只读验收
scripts/sync-upstream.sh   上游升级：换 vendor → 重放 → 重建 → 验收
（`docs/` 为开发期维护文档：移植判定、宿主兼容报告、发布手册、许可与署名合规清单。
 只在本机保留，不进公开仓库，也不随发行物分发 —— 见 .gitignore 的 /docs/。）
```

---

## 许可与署名

本仓库是**独立变体**，与两个上游的作者均无隶属关系，也未获得他们的背书。

| 来源 | 许可 | 义务 |
| :--- | :--- | :--- |
| `vendor/community/` · dsh-purge Community（当前 vendor 快照） | MIT | 保留版权 + 许可全文 + NOTICE |
| `vendor/safe/` · dsh-purge safe（当前 vendor 快照） | Apache-2.0 | 保留许可 + NOTICE + **逐文件标注改动** + 不暗示背书 |
| redteam 模块 | MIT | 保留版权声明 |
| 历史上游 `dsh-purge` 1.1.71 | MIT | 经 community 的 NOTICE 继承 |

Apache-2.0 §4(b) 的**逐文件改动记录**在包内 `NOTICE-PLUS.md` 第 2 节（随发行物分发）；绝不能删的文件清单与每次升级后要复查的五项，在开发期维护文档中留档，不随仓库发布。

---

## 常见问题

**装完面板显示「未运行 / 包不可用」，提示 `cannot resolve profile bundle`？**
`node_modules/` 里的目录名必须等于包名 `dsh-purge-plus`，且 `dsh.profile.bundles` 里也必须是这个名字。改名后重启 DSH。

**补丁显示 `pending`？**
没应用过，不是锚点问题。面板 → 清洗 → 应用，或 `node node_modules/dsh-purge-plus/bin/dsh-purge.js --apply`。

**补丁显示 `drift`？**
宿主升级后锚点对不上了。跑 `node scripts/verify.mjs`，第 [5] 组会指出是哪一条、哪个文件。

**面板「检查更新」说已是最新？**
确认仓库是**公开**的 —— 插件是匿名拉 GitHub API 的，私有仓库一律 404。

---

## 致谢

- **[dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge)**（community 线）—— 提供了本项目的基座、补丁引擎与运维层
- **[dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe)** —— 提供了遥测关闭、Session Log 移除、子代理权限继承的原始设计与实现
- **[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)** —— 宿主本身

<div align="center">
<sub>本仓库不是官方项目。使用前请确认你拥有或已获得授权。</sub>
</div>
