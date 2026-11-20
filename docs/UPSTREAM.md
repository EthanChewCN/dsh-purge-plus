# 上游维护手册

## 版本号规则

```
0.1.<overlay 修订号>
例: 0.1.37
```

- 本包版本号与上游基座**解耦**。上游升版不改我们的版本号；基座版本记进
  `package.json` 的 `plus.base`，只作溯源，不参与版本号、不进面板、不进发行资产名。
- 只改 overlay（加补丁 / 修锚点 / 改前端）→ 修订号 +1。
- `PLUS_REV=38 node scripts/build.mjs` 可临时指定；`PLUS_VERSION=0.2.0` 可整体改号。
- 历史 tag `v1.7.20-plus.N` 仍能被更新器解析（`FORK_RELEASE_RE` 保留 `-plus.N` 分支），
  不会因为放宽而拒绝老发行。但版本比较是**数字序**：`0.1.37 < 1.7.20-plus.36`，所以
  从旧版本迁到 `0.1.x` 必须**手工装一次**（面板不会把它当更新）；之后 `0.1.38 > 0.1.37`，
  面板升级恢复正常。

## 两个上游

| 上游 | 仓库 | 可见性 | 怎么拿新版本 |
|---|---|---|---|
| **community**（基座） | `kingcharleslzy-ai/dsh-purge` | 公开 | `git clone` 或 GitHub Release |
| **safe**（移植来源） | `CallMeGuLab/dsh-purge-safe` | 公开 | `git clone --depth 1 --branch v<ver>` 或 GitHub Release |

### community 新版本从哪来

仓库公开，可以直接 `git clone` 后 `npm pack`（注意发行物 `files` 字段只含运行时文件，
`test/` 与构建脚本不在包里 —— 要跑它的测试得用仓库本体）。

另一条路是**等它自己更新**：DSH 面板里 community 的更新通道会拉 tgz 落到
`~/.dsh/dsh-purge-community/pkgs/<sha256>/dsh-purge-community-<ver>.tgz`，取最新的即可。

## 升级流程

```bash
# 1. 拿到新版 tgz
./scripts/sync-upstream.sh ~/.dsh/dsh-purge-community/pkgs/<hash>/dsh-purge-community-1.7.21.tgz

# 脚本会：备份旧 vendor → 替换 → 重建（锚点冲突硬失败）→ 验收
```

### 锚点冲突了怎么办

`build.mjs` 会打印类似：

```
✗ #3 lib/core.js: 锚点命中 0 次（要求恰好 1 次）
    锚点: "\"auto-review\": allExisting([\n      ...nestedPkg(aiBase, \"dsh-experimental-au"
```

处理顺序：

1. `diff .upstream-backup/<old>-<ts>/community/lib/core.js vendor/community/lib/core.js`
   找到 `auto-review` 那一段现在长什么样。
2. 改 `overlay/edits.mjs` 里对应的 `find`，让它匹配新写法。
3. 若上游**已自行实现**同一语义（比如自己加了遥测开关），把该条改成 `required: false`
   并在 `docs/PORT-MATRIX.md` 标「上游已吸收」，然后从 `overlay.mjs` 删掉对应补丁。
4. 重跑 `node scripts/build.mjs && node scripts/verify.mjs`。

### 补丁锚点漂移了怎么办

`verify.mjs` 第 5 节会报：

```
✗ #201 命中 0/1 次 —— 锚点已漂移
```

说明宿主（DSH）升级改了那个文件。步骤：

1. 打开 `docs/PORT-MATRIX.md` §5 找到该补丁的宿主文件与行号。
2. 在新宿主文件里搜同义代码，改写 `overlay/files/lib/patches/overlay.mjs` 里的 `pattern`。
3. 更新 §5 的行号。
4. 重跑 `verify.mjs`，必须回到「全部锚点恰好 1 次」。

## 上游行为变化时要重看的地方

| 变化 | 要复核 |
|---|---|
| community 补丁数不再是 88 / 最大 id 不再是 96 | `build.mjs` 会硬失败；更新断言 + `PORT-MATRIX.md` §4 |
| community 新增了遥测/office 相关补丁 | `PORT-MATRIX.md` §2，可能可以把 #201–#204 删掉 |
| safe 出了新 tag | `git clone --branch v<new>` 到 `vendor/safe`，重跑 §2 的逐条判定 |
| DSH 主版本升（0.2.2 → 0.3） | 全部 92 条都要重验；`dshTarget` 要改；`verify.mjs` 必须全绿 |

## 发布

```bash
node scripts/build.mjs
node scripts/verify.mjs
git add -A && git commit -m "chore: sync upstream <ver>"
git tag v<ver> && git push --tags
# 把 dist/dsh-purge-plus-<ver>.tgz 附到 Release
```

## 出事了怎么退

1. **只退本仓库的 4 条**：DSH 面板 → 清洗页 → 单独关掉 #201–#204。
2. **退整包回社区版**：
   ```bash
   cd ~/.dsh/profiles/desktop/node_modules/dsh-purge-plus && node bin/dsh-purge.js --revert
   ```
   然后从 `package.json` 摘掉依赖，重装 `dsh-purge-community`。
3. **退宿主到官方原文**：`node bin/dsh-purge.js --revert` 会从 `.dshpurge.bak` 还原全部
   已打补丁的文件，并保留 `prompt-inject.md` 用户文件。
