# 发布流程：让面板里的「检查更新」能用

本仓库**自带**在线更新器（继承自 community），它自己去 GitHub 找 release。
只要按本文件的约定发布，用户在 DSH 插件面板点「检查更新」就能直接升到新版本。

## 1. 三个硬约定

更新器不读文档，只读这三样东西。任一不符，「检查更新」就永远显示「已是最新」。

| # | 约定 | 值 | 读它的代码 |
|---|---|---|---|
| 1 | **发行 tag** | `v<version>`，如 `v0.1.37` | `lib/update.js` `FORK_RELEASE_RE` |
| 2 | **资产文件名** | `dsh-purge-plus-<version>.tgz` | `lib/update.js` `${PACKAGE}-${version}.tgz` |
| 3 | **校验和文件** | `SHA256SUMS.txt`，同一 release 下 | `lib/update.js` `verifyAtomRelease` |

本仓库版本是 `0.1.N`，`vX.Y.Z` 本来就匹配；`-plus.N` 分支保留是为了让
历史发行（`v1.7.20-plus.N`）仍能被解析（见 `overlay/edits.mjs` 的 `FORK_RELEASE_RE` 那条）。
上游只认 `vX.Y.Z`，不放宽的话历史 tag 会被 `filter()` 全过滤掉。

**但只放宽这一处不够。** `lib/community.js` 里还有两个**内联**的
`/^v\d+\.\d+\.\d+$/`：

| 位置 | 作用 | 不放宽的后果 |
|---|---|---|
| `releasedVersions()` 的 `.filter()` | 过滤发行列表 | 列表为空 |
| `prepareRelease()` 开头 | 安装前校验 `release.ref` | 列表能看见，点安装抛「只安装正式发布版本」 |

两处都已由 `overlay/edits.mjs` 放宽，`scripts/verify.mjs` 第 [7] 段会数
`(?:-plus\.\d+)?` 出现次数，必须恰好 2。

另外两条隐含约定：

- **默认分支必须是 `master`**。`lib/update-net.js` 的 `STABLE_REF = "master"`，
  beta / zip 源码通道走 `commits/master` 取 Git tree 做逐文件 SHA-1 校验。
  建仓时若默认分支是 `main`，这条通道会 404。
- **release 不能是 draft，也不能标 prerelease**。`lib/update.js:774` 用的是
  `GET /repos/{repo}/releases/latest`，GitHub 这个端点只返回最新的**正式**发行。

## 2. 发布步骤

```bash
cd ~/Documents/dsh-purge-plus

# 1) 构建（修订号在 overlay/repo.json 的 revision 里改）
node scripts/build.mjs

# 2) 验收（7 组，全绿才发）
node scripts/verify.mjs

# 3) 生成校验和
cd dist
shasum -a 256 dsh-purge-plus-0.1.37.tgz > SHA256SUMS.txt
cd ..

# 4) 打 tag 并推
git add -A && git commit -m "release: 0.1.37"
git tag -a v0.1.37 -m "dsh-purge-plus 0.1.37"
git push origin master --tags

# 5) 建 release（资产名必须与 tag 版本一致）
gh release create v0.1.37 \
  "dist/dsh-purge-plus-0.1.37.tgz" \
  "dist/SHA256SUMS.txt" \
  --title "0.1.37" \
  --notes "见 CHANGELOG"
```

第 5 步若没有 `gh`，用 REST API 也行（`POST /repos/{owner}/{repo}/releases`，
再 `POST .../releases/{id}/assets?name=<file>` 上传两个文件）。

## 3. 更新器会怎么走

```
面板「检查更新」
  └─ GET api.github.com/repos/<REPOSITORY>/releases?per_page=20
       ├─ 过滤 FORK_RELEASE_RE（vX.Y.Z 或 vX.Y.Z-plus.N）
       ├─ 每个 release 拼 asset = releases/download/<tag>/dsh-purge-plus-<ver>.tgz
       └─ 与本地 version 做 versionIsNewer 比较
  └─ API 限流/断网时降级：releases.atom → 逐个核 SHA256SUMS.txt
  └─ 下载 → 校验 → pnpm 安装 → 回滚事务
```

`versionIsNewer` 的排序（`lib/update-state.js`）：

```
0.1.37  >  0.1.36            ← 修订号递增
0.1.10  >  0.1.9             ← 按数字比，不是按字符串
1.7.20-plus.36  >  0.1.37    ← 历史 plus 版本号在数字序上更高（迁移期只能手工装一次）
```

## 4. 未认证 API 的配额

更新器默认匿名访问 `api.github.com`，配额 **60 次/小时/IP**。面板反复刷新有 60 秒缓存，
正常使用够。若撞限流，更新器会自动降级到 `releases.atom`，但那条路要求 `SHA256SUMS.txt` 存在。

想彻底避免限流：给插件进程设 `GITHUB_TOKEN`（`lib/update-http.js` 会带上
`Authorization: Bearer <token>`）。**只读 public_repo 权限即可**，不要给它写权限。

## 5. 上游升级后的重新发布

```bash
# 1) 换 vendor（详见 docs/UPSTREAM.md）
./scripts/sync-upstream.sh 1.7.21        # 或手工替换 vendor/community

# 2) 重放 overlay —— 锚点漂移会在这里硬失败
node scripts/build.mjs
#    ✗ #8 lib/community.js: 锚点命中 0 次（要求恰好 1 次）
#      → 上游改了 REPOSITORY 的写法，去 overlay/edits.mjs 更新那条 find

# 3) 验收 + 发布
node scripts/build.mjs && node scripts/verify.mjs
```

版本号规则：**`0.1.<overlay 修订号>`**，与基座版本解耦。
上游升到 1.7.21 时本包仍是 `0.1.N`（基座版本记进 `package.json` 的 `plus.base` 做溯源）。
理由：本包的版本号应该回答「我们改了什么」，而不是复述上游版本 ——
否则上游一动，面板、徽章、页脚、发行资产名全都要跟着改一遍。

## 6. 排错

| 现象 | 原因 | 查这里 |
|---|---|---|
| 永远「已是最新」 | tag 不匹配 `FORK_RELEASE_RE`，或 release 标了 prerelease | `node scripts/verify.mjs` 的 [7] 段 |
| 「找到发行但下载失败」 | 资产名与 tag 版本不一致 | release 页面的资产列表 |
| 「校验失败」 | `SHA256SUMS.txt` 缺失或没列这个文件 | release 页面 |
| 「未找到已安装的…」 | profile 里装的是 `dsh-purge-community`，不是 plus | `lib/installed-package.js`（已兼容两种包名） |
| beta 通道 404 | 默认分支不是 `master` | 仓库 Settings → Branches |

## 6. 已发布记录

发行清单以 **[Releases 页](https://github.com/EthanChewCN/dsh-purge-plus/releases)** 为准。

> 这里**不维护 tag / sha256 表格**：本文件随包分发，写死摘要会让
> 「改文档 → 改包 → 改摘要 → 又改文档」形成自指循环，写死 tag 列表则每发一版
> 都要再改一次文档、再打一个版本号。以 release 页的 `SHA256SUMS.txt` 为准。

### 发布后实测（不是推测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 匿名读 release 列表 | `GET /repos/{owner}/{repo}/releases` | 200 |
| 匿名读 latest | `GET /repos/{owner}/{repo}/releases/latest` | 200，`prerelease:false` `draft:false` |
| 匿名下载资产 | `curl -L .../download/v1.7.20-plus.1/...tgz` | 200，2316239 B |
| 校验和比对 | `shasum -a 256 -c SHA256SUMS.txt` | OK，与本地构建产物一致 |
| 插件自己的列表函数 | `listForkReleases({fresh:true})` | 1 条，`asset`/`sums` URL 均指向本仓库 |
| 面板同款检查 | `checkUpdate({})` | `hasUpdate:false`（本地已是最新） |
| **降级模拟** | 本地版本临时改 `1.7.20-plus.0` 后 `checkUpdate({})` | **`hasUpdate:true`，`remoteVersion:1.7.20-plus.1`，`updateTarget:releases`** |

最后一行是「面板点升级能不能用」的直接证据：远端高一版时更新器确实报出更新。
