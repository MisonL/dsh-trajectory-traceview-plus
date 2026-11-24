# Changelog

## 0.11.3 — 2026-11-24

### Fixed

- **搜索框里的 `↑` / `↓` 导航原来根本不存在。** README §7 的快捷键表从存在起就写着这一行，而两条处理路径都跳过了它：面板级处理器遇到 `input` 目标直接 `return`，搜索框级处理器只认 `Enter` / `Escape`。于是浏览器查找最自然的两个键按下去毫无反应。现在补上（复用「下一个 / 上一个命中」按钮本来就调用的 `gotoMatch`，行为含环形回绕一致）。
- **README §10 的安全声明失准。** 原文写「不写入任何存储」，实际每个会话会往 `sessionStorage` 写一条 `dstv:view:1:<会话键>` = `{ revealed, query }`，用于宿主重新挂载面板时不把你打回「总览 + 空搜索框」。现已逐条写明：键名、内容、只在本标签页、为空时删除、存储被禁用时不抛错，并明确提示**搜索框里的文字会留在本标签页的 sessionStorage 里**。

### Added

- **README §7 的每个键现在都有断言**（浏览器探针 13 → 15 组 / 47 → 69 条）：空格播放+暂停、PageUp/PageDown 单调前进且可回退、`/` 与 `f` 都聚焦搜索框、`r` 双向切换且只在有请求的站点生效、`↑`/`↓` 计数器必须变化、`Enter` / `Shift+Enter` 方向相反、`Esc` 清空。
- **新门禁 `shortcut-check`**（CI 9 项 / 本地 8 步）：README §7 每一行列出的键都必须在 `probe.js` 里出现。单向——探针测表外的键不算错。带反向自检：一个都没匹配上直接红，防止映射表失效后门禁永远绿。
- **探针新增 `storage` 组**：至多一条视图状态键、字段只能是 `revealed` / `query`、`query` ≤200 字符、`localStorage` 仍为空。
- **smoke 新增 `SEC1` / `SEC2`**：`src/` 不得出现 `document.cookie =`、`localStorage` 写、`IndexedDB`、`sendBeacon`、`fetch(`、`XMLHttpRequest`、`WebSocket`；同时 `sessionStorage.setItem` 必须仍存在（否则说明功能被删而文档没改）。

### Changed

- `readme-numbers` 现在也核对**安装命令里写死的版本号**是否等于 `package.json`——改版本忘改 README 会直接红。
- `release-status` 的 npm 行拆成两个事实（元数据 + tarball 可下载），并新增第 5 行 `npm @latest`（advisory）：`@latest` 被 pnpm 的供应链延迟挡住时打印「published X h ago, clears in ~Y h」而不是含糊的「self-heals」。
- 新增 `scripts/guard-check.mjs`：用已知复杂度的输入验证 P1 性能守卫还能不能分辨线性/二次。

### Notes

0.11.0 / 0.11.1 / 0.11.2 的 `lib/` 逐字节相同；**0.11.3 是这三个版本之后第一次真正的运行时代码变更**（`↑`/`↓` 搜索导航）。

## 0.11.2 — 2026-11-24

`release-status` 增加第 4 个外部环节的检查：**tarball 是否真的可下载**。

### Why

0.11.1 发布后，packument 的 `versions`、`dist-tags.latest`、`time`、`dist.shasum` 全部正确，
但 `…-0.11.1.tgz` 返回 **HTTP 404** 约两分钟——`dsh plugin add pkg@0.11.1` 直接失败。

`npm view` 只读元数据、从不下载 tarball，所以对这个窗口完全失明；而这个窗口正是
真实安装器会命中的那个。带个 cache-buster 立刻 200，说明是 CDN 把 404 缓存住了。

### Added

- `release-status.mjs` 的 npm 行拆成两个事实：元数据存在 + tarball 可下载。失败时区分
  「没发布」与「发布了但字节还没到位」——后者是安全失败（装不上，而不是装错版本）。
- 故意**不加 cache-buster**：加了会绕开正是过期的那个缓存，从而隐藏真实安装器会踩的坑。

### Changed

- 发布清单第 12 步从「三处对齐」改为「四处对齐（tag / Release / npm 元数据 / tarball）」。

### Notes

0.11.0 / 0.11.1 / 0.11.2 三者**运行时代码完全相同**（`lib/` 逐字节一致）。这三次发版
修的都只是「用户能不能正确装上」这件事。

## 0.11.1 — 2026-11-24

修正 **0.11.0 已发布包内文档的错误**：那份 README 会让读者装错东西。

### Fixed

- **安装命令**：0.11.0 的 README 只给了 `github:` 一条路，且**不带 tag** —— 装的是默认分支 HEAD，不是任何发布版本。现在给出两条并都写死版本：npm（`…@0.11.1`）与 GitHub（`… #v0.11.1`），并说明为什么不能用 `@latest`。
- **观测组/断言数**：`--shots` 模式实际是 14 组 / 49 条断言（`browser-check.mjs` 自己会加一组 375px 溢出探测），README 一直写 13 / 47。默认模式下是对的，所以长期未被发现。
- `scripts/browser-check.mjs` 已按其真实行为计入 `readme-numbers` 的两项真相源。

### Added

- `readme-numbers` 新增两类核对：**安装命令里的版本号**必须等于 `package.json`（否则改版本忘改 README 会红），以及 **`browser-check` 在 probe.js 之外追加的观测组与断言数**。
- 匹配规则改为**显式优先级**：具体规则先占位它匹配的字符区间，通用规则跳过已占位部分。此前「另加 2 条断言」会被通用规则误读成总断言数，导致门禁自己报假警（第三次同类问题）。

### Notes

0.11.0 与 0.11.1 的**运行时代码完全相同**（`lib/` 逐字节一致），差异只在文档与 `scripts/`。已经装了 0.11.0 的人不需要为了功能升级，但 npm 页面上的安装指引是错的，所以重新发版。

## 0.11.0 — 2026-11-24

`engines.dsh` 从硬钉单一版本改为**已验证版本的区间**，插件不再因为宿主小版本升级就被整体跳过。

### Changed

- `engines.dsh`: `=0.2.2-rc.2` → `>=0.2.2-rc.2 <0.2.3-0`。覆盖 0.2.2 线上的 rc.2/rc.3/rc.4/rc.5 与正式版；**不跨 minor**，0.2.3 起仍需重新验证并跟版。
- 版本号段规则补一条：区间内放宽属 **minor**，因为它是兼容策略变更，不是纯修复。

### Why

0.10.0 在 dsh 0.2.2-rc.5 上**整个页签消失**——`=0.2.2-rc.2` 精确匹配拒绝 rc.5，宿主直接跳过该 bundle。这是硬钉的代价，而硬钉原本是为了诚实（只声明实测过的版本）。

现在两者兼顾：区间**只覆盖实测过的线**，并且实测证据是逐包比对的，不是"启动没报错"——

- 本插件绑定的四个宿主包在 rc.2 与 rc.5 之间**逐字节相同**：`dsh-client-locale`、`dsh-api-session-controller`、`dsh-client-ui-conversation`、`dsh-client-ui-trajectory`（以及 `dsh-client-modules/lib/client.js`、`dsh-client-store`）。
- 唯一有差异的 `dsh-client-ui-primitives` 是纯增量（新增三个 `IconUploadOutline*` 导出），本插件没有 `require` 它。
- rc.3 的升级项是错误码 `MALFORMED_RESPONSE` → `CONTENT_REFUSED`：本插件不硬编码任何错误码，读的是 `node.code` / `failure.code` 并原样展示（`src/30-helpers.js`）。
- rc.4 的升级项是 web search 默认提供方，与本插件无关。
- **真机实跑**（rc.5，web profile，真实会话 216 个站点）：视图渲染、minimap、详情面板、站点跳转、复制锚点、KPI、时钟时间全部正常，无渲染错误；`browser-check` 47 条断言全过；`npm run check` 7 步全过。

### Verified on

dsh 0.2.2-rc.5（本机全局安装）、Node v24.22.1、macOS。

### Notes

- 0.2.3 及以后仍会被跳过。这是有意的：新 minor 意味着新局面，需要重新验证。被跳过时宿主日志会说明原因；临时放行用 `dsh plugin allow-version`（精确版本豁免）。
- 已发布到 npm 的 0.10.0 仍带旧钉版声明，需要本版本才能在新宿主上加载。

## 0.10.0 — 2026-11-22

First npm release of **dsh-trajectory-traceview-plus**, derived from AFAP/dsh-trajectory-traceview v0.3.0 (MIT).

### Included

- Replayable horizontal timeline, minimap, turn navigation, loaded-window search, follow mode and history pagination.
- Stable event anchors and deep links; orphan tool-result stations; clock-axis display.
- Step/tool timing, token usage, prompt changes, raw-request inspection and Markdown export.
- Hardened request matching, streaming projection, malformed-input handling and unique UI identities.
- Accessible named panel region and responsive layouts checked at 390–1440px.
- Unified package/repository identity; corrected contributor build instructions.

### Compatibility and validation

- Requires **DSH 0.2.2-rc.2 exactly** and **Node.js >=24.9.0**; browser-only plugin.
- Build/provenance consistency, smoke regression tests and browser behavior checks were run before release.
- Review history: `docs/DESIGN.md` §§13.28–13.31; upstream attribution: `docs/PROVENANCE.md` and `LICENSE`.
- Manual screen-reader/touch testing and an exhaustive dark-theme contrast audit remain unverified. Automated clipboard checks verify the write path, not OS clipboard read-back.

### Recovery

- Disable/uninstall the Plus bundle if needed. It is a local read-only view and does not own session data.
- A faulty published version requires a new corrected version or npm deprecation; do not rely on npm unpublish as rollback.

Earlier development changes are recorded in `docs/DESIGN.md` and Git tags v0.9.1–v0.9.29.

### Notes on provenance

`docs/PROVENANCE.md` was regenerated after adding this file. The published bundle is byte-identical to the artifacts that passed the full gate run and browser behavior checks recorded in `docs/DESIGN.md` §13.31.
