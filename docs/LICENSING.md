# 许可与署名：合规清单

本文件是**维护时不能忘的硬约束**。改动任何与许可相关的内容前先读这里。

## 1. 结论先行

本仓库**可以公开**。三份上游许可全部允许复制、修改、再分发：

| 上游 | 许可 | 允许公开分发 | 关键义务 |
|---|---|---|---|
| `kingcharleslzy-ai/dsh-purge`（community 1.7.20） | MIT | ✅ | 保留版权声明 + 许可全文 |
| `CallMeGuLab/dsh-purge-safe`（2.0.0） | Apache-2.0 | ✅ | 保留许可 + NOTICE + 标注改动 + 不得暗示背书 |
| `deepseek-ai/deepseek-harness`（宿主） | MIT | 不适用（本仓库不含宿主代码） | — |
| `Jueze-2019/dsh-redteam-mode`（redteam 模块） | MIT | ✅ | 保留版权声明 |
| `YuJunZhiXue/dsh-purge` 1.1.71（community 的上游） | MIT | ✅ | 经 community 的 NOTICE 继承 |

实测确认（GitHub API）：三个上游仓库均为 `private=false`，不存在「转发私有代码」的问题。

## 2. 绝不能删的文件

删了任何一个都构成许可违约：

```
LICENSE                                本仓库自身（MIT）
LICENSE-SAFE-APACHE-2.0.txt            Apache-2.0 §4(a)
NOTICE-SAFE.txt                        Apache-2.0 §4(d)
NOTICE-PLUS.md                         汇总署名链 + 逐文件改动记录
vendor/community/LICENSE               community 的 MIT 全文
vendor/community/NOTICE.md             community 的署名链（含 1.1.71 上游）
vendor/community/docs/redteam-upstream-LICENSE        Jueze-2019 MIT
vendor/community/docs/redteam-upstream-DISCLOSURE     dual-use 声明
vendor/community/test/fixtures/agent-loop-022-LICENSE MIT
```

`scripts/build.mjs` 会把 `NOTICE-PLUS.md` / `NOTICE-SAFE.txt` / `LICENSE-SAFE-APACHE-2.0.txt`
自动塞进 `package.json.files`，防止发行物漏带。改 `files` 数组时别绕过这段。

## 3. Apache-2.0 §4(b)：改动标注

凡是改过 safe 的文件，必须同时满足两条：

1. 文件顶部有 `[dsh-purge-plus]` 标记
2. `NOTICE-PLUS.md` 第 2 节的表格里有一行，写明**改了什么、为什么**

当前有 5 处，其中 2 处是**修正 safe 的缺陷**，不是风格偏好：

- `#202`：safe 用 `return;` 提前返回 → 跳过 `ctx.effect(shutdown)` 注册
- `#204`：safe 用了宿主里不存在的 `statSync` → 打上即 `ReferenceError`

## 4. 不得做的事

- 不得用 `dsh-purge-community` 或 `dsh-purge-safe` 作为本项目的**显示名**去暗示官方身份
- 不得声称本仓库是任何一个上游的官方续作
- 不得移除 `NOTICE-PLUS.md` 开头的「independent variant / 未获背书」声明
- 不得付费转售（community 的 NOTICE 有此请求；MIT 不允许附加限制，但本项目尊重）

## 5. 每次上游升级后要复查的

1. `vendor/community/LICENSE` 与 `NOTICE.md` 是否被上游改动（`diff` 一次）
2. `vendor/safe/NOTICE` 是否被改动
3. `NOTICE-PLUS.md` 第 2 节的表格是否还准确（移植的 5 处代码是否还在、是否被上游吸收）
4. `docs/redteam-upstream-*` 是否还在
5. `node scripts/verify.mjs` 全绿
