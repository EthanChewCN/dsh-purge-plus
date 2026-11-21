<div align="center">

# dsh-purge-plus

**An instruction-authority cleaner for DeepSeek Harness — an independent variant**

Separate the host layer from the model layer: whether the model is willing to answer is one question; how many gates the host puts in front of it is another.

[![Release](https://img.shields.io/github/v/release/EthanChewCN/dsh-purge-plus?label=release&color=6E56CF)](https://github.com/EthanChewCN/dsh-purge-plus/releases)
[![Patches](https://img.shields.io/badge/host%20patches-95-3B82F6)]
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.5-22D3EE)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20Apache--2.0-green)]
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=fff)](package.json)

Version: see the Release badge above (not hardcoded — every release would otherwise force a doc edit, which forces another release) · targets **DSH Desktop 0.2.2-rc.5** · [中文](README.md)

</div>

---

## Contents

- [What this is](#what-this-is)
- [Three design lines](#three-design-lines)
- [What you get](#what-you-get)
- [Relationship to the two upstreams](#relationship-to-the-two-upstreams)
- [Install](#install)
- [In-app upgrade](#in-app-upgrade)
- [Maintenance model](#maintenance-model)
- [Verification](#verification)
- [Layout](#layout)
- [License and attribution](#license-and-attribution)
- [FAQ](#faq)

---

## What this is

DeepSeek Harness does more than forward a prompt. At runtime it rewrites prompts, inserts approval gates, tightens sandbox policy, and migrates session state. Asking only "will the model answer" mistakes a host-layer block for a model refusal.

This plugin does two things:

1. **Make state visible** — whether install, patches and injection are actually ready: one command or one screen answers it.
2. **Collapse the friction** — repeated confirmations and interruptions become one setting, and anything you break can be rolled back.

It does not change the model, the cloud account, or upload prompts and configuration. Everything runs on your own machine and touches only the local `@deepseek-ai` packages and local config.

> The community usually calls this a "purge" or "unrestricted mode" plugin. Use it only in environments you own or are authorised to test.

---

## Three design lines

```
base    dsh-purge Community   MIT         host patches · patch engine · ops layer
port    dsh-purge safe        Apache-2.0  a branch with a wider capability surface
result  dsh-purge-plus        variant     95 patches · 11 read-only checks
```

This repo is **not** a fork of community and **not** a fork of safe. It treats both upstreams as read-only inputs:

- `vendor/community/` — the base, verbatim copy, read-only at build time;
- `vendor/safe/` — the porting source, verbatim copy, used only for comparison;
- `overlay/` — **every** change this repo makes: new files plus 26 precise anchor insertions, with no logic removed or rewritten.

---

## What you get

| Layer | Content |
| :--- | :--- |
| **Host patches** | **95** = 88 upstream + 7 own (id ≥ 201) |
| Own #201 | `PRODUCT_ANALYTICS_DEFAULT_OFF` — product analytics off by default |
| Own #202 | `PRODUCT_TELEMETRY_OTEL_NOOP` — product telemetry OTLP exporter becomes a no-op |
| Own #203 | `SESSION_TELEMETRY_OTEL_DISABLED` — session telemetry defaults to `DISABLED` |
| Own #205 | `SESSION_LOG_CLOUD_UPLOAD_UNREGISTER` — session log upload short-circuited at the registration site |
| Own #206 | `SUBAGENT_INHERIT_PARENT_ACCESS` — subagents inherit the parent permission preset verbatim |
| Own module | `lib/subagent-fence.js` — a leaf subagent may not delegate further |
| Patch engine | 30 schema fields: `drift` / `fileOptional` / `requireAllTargets` / `settleWhenAbsent` / `multiHit` … |
| Ops layer | `audit.jsonl`, cross-process maintenance lock, rollback transaction, layered self-check, runtime probe, drift detection |
| In-app upgrade | "Check for updates" works: anonymous GitHub releases, byte-exact `SHA256SUMS.txt` verification |
| Drill desk | Full-page settings in the sidebar + red-team fact store (SQLite) |

---

## Relationship to the two upstreams

**Based on dsh-purge Community + dsh-purge safe, independently maintained.** Both upstreams are read-only inputs; this repo follows neither upstream's version number.

| Dimension | dsh-purge-community | dsh-purge-safe | This repo |
| :--- | :--- | :--- | :--- |
| Patch engine schema | **30 fields** | 19 fields | takes community |
| Drift detection | **16 sites**, can say *why* a patch did not apply | none | takes community |
| Ops layer | **15 modules / 1,441 lines** | slim | takes community |
| Update channel | **works** | repo coordinates left blank | takes community, repointed here |
| Patch coverage | 88 | 59 | base is community |
| Runtime hooks | 10 events | **13 events** | on demand |
| Host write elevation | none | **`ensureHostWritable` suite** | on the roadmap |
| Drill desk | 10 tabs | **12 tabs + 6 groups** | on the roadmap |

### Why not ship safe wholesale

This is not a question of "which one is newer". There are three hard conflicts:

**① The id namespace has already diverged.** Both lines share one id space, but `#52` and `#89`–`#96` mean **completely different things** on each side (safe's `#90` is an OpenAI native system slot; community's `#90` is restoring native steering). Merging wholesale forces a choice, and the other side's ledger is lost — and that ledger is the most valuable part of this plugin.

**② safe ships a region-denial layer.** `safe/lib/net-scope.js` defines a `DENIAL` constant and hooks `agent/pre-step`; on a hit it appends a refusal message to the session and empties the turn. That is the opposite of what this plugin is for. A wholesale merge would drag it in. This is a **hard blocker**, not a style preference.

**③ safe's update channel is empty.** `safe/lib/update.js` has `const REPO = ""`, so every GitHub URL becomes `repos//…`. Shipping it wholesale means no in-app upgrade.

Conversely, three things in safe are worth porting on their own merits. We judge each by "can this be implemented equivalently on this base":

- equivalent and worth having → port (telemetry trio, session-log hard removal, subagent preset inheritance);
- already stronger on the base → skip (`#9` rewrites approval `decide()` to allow outright, which is more thorough than a runtime downgrade);
- conflicts with the host contract → skip (`#89` moves the system prompt into a `system` field **no provider reads**, i.e. it drops the prompt).

The per-item verdicts and source evidence (including **11 corrections to earlier analysis**) are kept as development-time records and are **not published with this repo**; the README states the conclusions and the reproducible entry points only.

### Why not a plain fork

fork-and-edit dies on the second upgrade: the moment upstream moves, every local change becomes a conflict.

Here `vendor/` is always a verbatim upstream copy, and every change is "new files + precise anchor insertions". On upgrade the whole `vendor/community` directory is replaced; if an anchor no longer matches, the **build fails hard** and prints the file and the anchor, instead of silently producing a package whose semantics have drifted.

---

## Install

### Prerequisites

- DSH Desktop **0.2.2-rc.5** (anything from `0.2.2-rc.1` on also passes)
- DSH started at least once so the profile is initialised
- **Remove `dsh-purge-community` or `dsh-purge-safe` first** — all three patch the same host files and the `.dshpurge.bak` baselines would contaminate each other

### Option 1: the panel (recommended)

```bash
node scripts/build.mjs      # → dist/dsh-purge-plus-<ver>.tgz
node scripts/verify.mjs     # 11 read-only checks, host untouched
```

Then DSH panel → **Plugins → Install from file** → pick `dist/dsh-purge-plus-<ver>.tgz` → restart DSH.

### Option 2: command line

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-purge-community
pnpm add "file:$HOME/Documents/dsh-purge-plus/dist/dsh-purge-plus-<ver>.tgz"
```

Afterwards confirm `dsh.profile.bundles` in `package.json` contains **`dsh-purge-plus`** and that `node_modules/dsh-purge-plus/` exists.

> **The package name and the directory name must match.** The host's `cordis.patch.yml` declares which package to load via `name:`, then resolves it with `createRequire(profile).resolve(name)`. A mismatched directory name gives `MODULE_NOT_FOUND` — and the **entire bundle is silently skipped**: the panel looks installed while not a single patch is applied. The build script rewrites the five names in `cordis.patch.yml`, and check group [8] guards it.

### Migrating from community or safe

The host files may still carry the old plugin's markers. Safe order:

```bash
# 1) revert with the old plugin first, restoring the official host text
node node_modules/dsh-purge-community/bin/dsh-purge.js --revert

# 2) install this repo
# 3) apply
node node_modules/dsh-purge-plus/bin/dsh-purge.js --apply
```

`.dshpurge.bak` is created **exclusively** (`open(wx)`), so an existing backup is never overwritten — switching plugins cannot corrupt the original baseline.

### Uninstall and roll back

```bash
node node_modules/dsh-purge-plus/bin/dsh-purge.js --revert   # host back to official text
pnpm remove dsh-purge-plus                                   # remove the plugin
```

---

## In-app upgrade

**"Check for updates" works**, just like the community edition. The updater is inherited; this repo only repoints "where to ask for a new version".

| Change | File |
| :--- | :--- |
| `REPOSITORY` → this repo | `lib/community.js` |
| `SOURCE_REPO` → this repo | `lib/update-net.js` |
| Release tag whitelist accepts `-plus.N` | `lib/update.js` `FORK_RELEASE_RE` |
| The **two inline regexes** behind the same gate | `lib/community.js` (list filter + pre-install check) |
| History filtered against current releases | `lib/update.js` |
| Installed-package identity recognises `dsh-purge-plus` | `lib/installed-package.js` |
| Dependency names allowed during rollback | `lib/rollback-transaction.js` |

**Why the two inline regexes get their own row**: widening only `FORK_RELEASE_RE` in `update.js` makes the release list appear, but clicking Install throws "only stable releases can be installed" — because `community.js` carries two more hard-coded `/^v\d+\.\d+\.\d+$/`. This was found by running it, not by reading it.

Release convention: tag `v<version>` · asset `dsh-purge-plus-<version>.tgz` · `SHA256SUMS.txt` in the same release · default branch `master` · release must not be a draft or prerelease. Full procedure and troubleshooting in **RELEASE.md**.

> The updater hits `api.github.com` anonymously: 60 requests/hour/IP. On rate limit it degrades to `releases.atom`.

---

## Maintenance model

```bash
./scripts/sync-upstream.sh <new upstream tgz>   # swap vendor → replay overlay → rebuild → verify
```

| Stage | Action | On failure |
| :--- | :--- | :--- |
| Swap vendor | replace `vendor/community` wholesale | — |
| Replay overlay | insert 26 anchors one by one | hit count mismatch → **build aborts**, prints file and anchor |
| Rebuild | vendor + overlay → `dist/package` → tgz | assertion mismatch → abort |
| Verify | 11 read-only checks | any red → non-zero exit |

"Exactly N hits" is a hard constraint: 0 hits means the anchor rotted after a host upgrade; ≥2 means it would patch the wrong place. Both fail the build.

See **UPSTREAM.md**.

---

## Verification

```bash
node scripts/verify.mjs
```

| # | Check | A failure means |
| :--- | :--- | :--- |
| 1 | Patch table / fence / entry import | package structure broken |
| 2 | 95 patches, 7 own, no duplicate ids | patch table corrupted |
| 3 | Real host `--status` locates the `@deepseek-ai` root | host path moved |
| 4 | The 5 own patches appear in status | patches not wired into the index |
| 5 | Each own patch's anchor hits exactly once on the host | anchor stale after upgrade |
| 6 | Entry loads under DSH's resolution context | export shape changed |
| 7 | Update channel (tag whitelist / version compare / asset name / coordinate leftovers) | in-app upgrade would break |
| 8 | `cordis.patch.yml` plugin name matches the package name | bundle would be silently skipped |

Everything is read-only: no host writes, no state changes.

---

## Layout

```
vendor/community/          upstream base, verbatim, read-only at build time
vendor/safe/               porting source, verbatim, comparison only
overlay/files/             new files
  ├─ lib/patches/overlay.mjs   own patch table #201–#206
  ├─ lib/subagent-fence.js     leaf-agent fence
  └─ NOTICE-PLUS.md            attribution and change record
overlay/edits.mjs          26 precise anchor insertions
overlay/repo.json          repo coordinates + this repo's revision
scripts/build.mjs          vendor + overlay → dist → tgz
scripts/verify.mjs         11 read-only checks
scripts/sync-upstream.sh   upgrade: swap vendor → replay → rebuild → verify
( `docs/` holds development-time maintenance notes: port verdicts, host compatibility
  report, release handbook, compliance checklist. Local only — not in the public repo,
  not shipped in the package. See `/docs/` in .gitignore. )
```

---

## License and attribution

This repo is an **independent variant**. It is not affiliated with, and not endorsed by, the authors of either upstream.

| Source | License | Obligation |
| :--- | :--- | :--- |
| `vendor/community/` · dsh-purge Community (current vendor snapshot) | MIT | keep copyright + full license + NOTICE |
| `vendor/safe/` · dsh-purge safe (current vendor snapshot) | Apache-2.0 | keep license + NOTICE + **per-file change marking** + no implied endorsement |
| redteam module | MIT | keep the copyright notice |
| historical upstream `dsh-purge` 1.1.71 | MIT | inherited via community's NOTICE |

The Apache-2.0 §4(b) **per-file change record** ships inside the package as section 2 of `NOTICE-PLUS.md`; the must-never-delete list and the five post-upgrade checks are kept as development-time records and are not published with this repo.

---

## FAQ

**The panel says "not running / package unavailable" with `cannot resolve profile bundle`?**
The directory under `node_modules/` must equal the package name `dsh-purge-plus`, and `dsh.profile.bundles` must use that same name. Restart DSH after renaming.

**A patch shows `pending`?**
It has never been applied — not an anchor problem. Panel → Clean → Apply, or `node node_modules/dsh-purge-plus/bin/dsh-purge.js --apply`.

**A patch shows `drift`?**
Its anchor no longer matches after a host upgrade. Run `node scripts/verify.mjs`; group [5] names the patch and the file.

**"Check for updates" says up to date?**
Make sure the repo is **public** — the plugin queries the GitHub API anonymously, and private repos always 404.

---

## Credits

- **[dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge)** (community line) — the base, the patch engine and the ops layer
- **[dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe)** — the original design and implementation for the telemetry switches, session-log removal and subagent preset inheritance
- **[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)** — the host itself

<div align="center">
<sub>Not an official project. Confirm you own or are authorised to use the target environment.</sub>
</div>
