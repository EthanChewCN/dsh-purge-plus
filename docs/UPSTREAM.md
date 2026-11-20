# 上游维护手册

## 版本号规则

```
<community 版本>-plus.<overlay 修订号>
例: 1.7.20-plus.1
```

- 上游升版 → `1.7.21-plus.1`（overlay 修订号重置为 1）
- 只改 overlay（加补丁 / 修锚点）→ `1.7.20-plus.2`
- 改 `PLUS_REV=3 node scripts/build.mjs` 可临时指定

## 两个上游

| 上游 | 仓库 | 可见性 | 怎么拿新版本 |
|---|---|---|---|
| **community**（基座） | `kingcharleslzy-ai/dsh-purge` | **私有** | 需要仓库权限，或从已安装机器上取发行物 tgz |
| **safe**（移植来源） | `CallMeGuLab/dsh-purge-safe` | 公开 | `git clone --depth 1 --branch v<ver>` 或 GitHub Release |

### community 新版本从哪来

它是私有仓库，CI 产物落在 `~/.dsh/dsh-purge-community/pkgs/<sha256>/dsh-purge-community-<ver>.tgz`。
两条路：

1. **等它自己更新**：DSH 面板里 community 的更新通道会拉 tgz 落到上面那个路径，取最新的即可。
2. **有仓库权限**：`git clone` 后 `npm pack`（但注意发行物 `files` 字段只含运行时文件，
   `test/` 与构建脚本不在包里 —— 要跑它的测试得用仓库本体）。

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
