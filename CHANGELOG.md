# Changelog

## Unreleased — 全维度审查后的修复

四个只读审查（两个 Codex worker + 本项目自己的 subagent）在 0.11.5 上报了可复现的问题。
下面每一条都附了复现方式；每条修复都有能让它变红的断言，或（性能项）有同会话对照的数字。

### Fixed

- **翻页窗口从一条工具结果开头时，时间轴会倒序。** 该结果的 `seq` 小于窗口内**每个**轮次边界，
  `turnForSeq` 的兜底是"最后创建的轮次"，`ensureTurn` 又把这个轮次的 seq 拉到该结果上，
  于是最新轮次排到了最前：68 → 65 → 66 → 67，中间出现约 1 小时 52 分的假空档，导出也把它
  记在错误的轮次下。现在优先用节点自带的 `turn`，其次才是**最早**的轮次。断言 `ORDER1`。
- **搜索淡化规则一直没生效。** 规则写的是 `.dstv_listbox[data-searching=true]`，而带这个属性的
  元素类是 `.dstv_hflow`——选择器匹配不到任何元素。表现：minimap 刻度变淡了，站卡却全是满不透明。
  现在改用真实类名，并按**计算样式**断言（不匹配卡 `opacity < 1`、匹配卡 `= 1`）。
- **minimap 首站的 `data-active` 会读到缓存里的旧值。** `data-active` 和 roving `tabIndex` 是两个
  不同的表达式，在 `i === 0` 处取值相同（总览和"选中首站"都给出 tab=1），签名只哈希了后者，
  于是选中首站后刻度条不高亮。现在两个值分开哈希，并直接断言高亮集合。
- **搜索框会吞掉正在输入的尾随空格。** 输入框绑定的是 `trim()` 之后的匹配串，受控组件每次
  按键都把空格抹掉，`alpha beta` 逐字输入会变成 `alphabeta`。现在绑定原始输入，匹配仍用修剪值。
- **详情面板只渲染一层子调用。** 工具套工具的链条从第二层起在屏幕上消失，而单步复制和整段
  导出都有——屏幕显示的内容严格少于你复制出来的文件。现在递归渲染，新增第 24 组断言。
- **上下文压缩后的"重放"被说成了"调用不在窗口内"。** 真实会话里，DSH 会在压缩后
  **用同一个 `callId` 把工具结果再发一次**（实测一个 1.7 万事件的会话里有 **13 组**，
  seq 相隔 5500 秒）。这些结果没有调用可以再消费，于是落进 `orphan-tool`，卡片写着
  "调用不在窗口内"——可调用就在旁边，而且早就被回答过了。用户只会以为数据坏了。
  现在投影层记录 `replayOf`（被重放的那条结果的 seq），卡片、无障碍名称、详情面板标签
  和导出都改说"压缩重放"，并指出原结果在哪（`与 e3 相同（上下文压缩后重放）`）。
  真孤儿仍然说"调用不在窗口内"。断言 `REPLAY1`（投影 + 导出）与探针 23l（屏幕）；
  变异（`replayOf` 恒为空）→ 两处同时红。
- **锚点"向前翻页直到命中"这条路，端到端从没测过。** 夹具的 `loadOlder` 一直是
  `Promise.resolve()`——秒回、且**不加载任何数据**，所以探针只能测"窗口内命中"和
  "不在窗口就提示"两个端点，中间那个循环（README §2 的核心承诺）没有覆盖。
  现在夹具真的向后 prepend 三站一页、并把 `hasMore` 收尾，于是可以驱动真实的翻页跳转：
  粘贴 `tvp1:e97`（窗口是 100–109）→ 自动翻页 → 窗口变成 97–109 → 精确落在 seq 97。
  断言在探针 23k；变异（把翻页循环打断）→ 三条同时红。
  代价：夹具一旦真的会翻页，"选中即滚动触发预取"就会在别的组里悄悄改动数据，
  所以 23e / 23g 现在显式关掉 `hasMore`——它们手工构造窗口，不该被后台翻页干扰。
- **快速连按 `←` / `→` 会被合并成一次。** `stepNext`/`stepPrev` 从渲染闭包里读 `revealed`，
  所以在 React 重渲染之前到达的重复按键全都看到同一个旧值：同一 tick 里按 20 次只前进 1 站
  （实测最终停在第 1 站，而循环语义应是第 4 站）。键盘自动重复正好落在这个边界上。
  现在改用函数式更新 `setRevealed((r) => …)`，同 tick 与间隔按下的结果一致。
  断言在探针 23j；变异（退回闭包形式）→ 红（"advanced to station 2 instead of 4"）。
- **一条 1 MB 的消息把整张卡塞进 DOM，卡 1.5 秒。** `dstv_clamp4` 只裁视觉：文本节点和
  `title` 属性都保留了完整字符串。实测单条渲染 **1,575 ms**，DOM 里 **1,000,007 字符**
  （其中 tooltip 一个人扛了 1 MB）。现在卡片正文封顶 20,000 字符、tooltip 封顶 300，
  末尾补 `…` 表明被截断；**复制、详情面板、导出仍拿到完整内容**（实测复制出来 1,000,088 字符，
  含标题包装）。封顶值取 20,000 是因为探针第 20 组要求 20k 正文完整渲染并检测深处改一个字符。
  断言在探针 23i；变异（去掉截断）→ 红。
- **README 把 `End` 的搜索框行为写错了。** 原文说"在面板根**或搜索框**上按 `End` 是显示全部"。
  实测三种焦点各不相同：面板根是回总览（清空选中），站点卡是跳到末站（只移焦点、不改选中），
  输入框里面板根本不处理（交给浏览器移动光标）。中英两版都改成表格，三条都有断言。
  **顺手更正一处自我误导**：`onKeyDown` 里那条 `if (tag === "input" ...) return;` 守卫，
  删掉之后行为完全不变——面板里每个输入框都有自己的 `onKeyDown` 且对每个键 `stopPropagation`，
  事件到不了面板根。我照着它写的断言做了变异仍然全绿，那不叫验证。守卫保留（下一个输入框
  会需要），注释里明写"当前不可达"，README 措辞改成"面板不处理"（DESIGN §13.83.0）。
- **导出 Markdown 的 6 处自由文本未转义。** 压缩摘要、压缩输出、错误消息、重试消息、
  斜杠命令名与参数、命令输出原来直接拼进去：内容里的 `</details>`、``` 或行首 `#` 会改写
  导出的结构（实测伪造出一个 `### 伪造标题` 小节）。现在统一走 `proseSafe` / 新增的 `inlineSafe`，
  行首 `#` 也转义。断言 `EXPORT2`（变异验证：退回原样即红）。
- **跨会话的视图状态写入。** `sessionKey` 变化的那一次渲染里，`revealed`/`query` 仍然属于上一个
  会话，写下去就把 A 的位置记到了 B 名下。现在按键变化的那一轮跳过写入。
  **诚实说明**：探针第 8b 组只能抓到症状，抓不到这个守卫（去掉它仍然绿），保留是因为写错本身就是错的。
- **锚点输入框不随会话切换清空**（不持久、不影响正确性，只是读起来像还指向旧会话）。
- **宿主"先给位置、后给数据"时，重挂载仍会丢掉选中。** 上一版用哨兵初值修了"重挂载后第一次翻页"，
  但漏了一种更常见的情形：宿主恢复 `revealed` 时站点列表还没到。那一帧里 `selectedIdRef` 被写成
  `null`（"明确没有选中"），之后列表到达也再不会补记——翻页照样按下标走。实测 T6 → T3。
  现在把它分成两态：`undefined` = 还没记录、`null` = 确实在总览；列表为空时不写，等数据到达再补记。
  断言在探针 23g；变异（去掉"列表为空时不写"）→ 红。
  同时 `X1-o` 这条静态断言原本要求"记录只能依赖 `revealed`"，现在改为检查真正的不变式：
  **翻页不得覆盖已记录的 id**（依赖数组可以带上站数，行为由提前返回守住）。
- **重挂载后的第一次翻页，把选中从站点变成了下标。** `prevRevealedRef` 用恢复出来的数字
  初始化，于是第一次 effect 认为"没变化"，`selectedIdRef` 从未写入，按 id 钉住的修复无从下手：
  选中 `6 / 10 用户 T6`，重挂载后前面插 3 条，变成 `6 / 13 用户 T3`。改用哨兵初值。
  断言在探针 23e；变异 → 红（症状与报告一致）。
  （这条一度被我判成"探针复现不出来"，实际只是 `__remount()` 少传了 sessionKey。）
- **改个变量名，会留下一处只在"切换会话"时才炸的调用。** 把 `matchPtr` 改成 `matchId` 时，
  会话切换的复位块里还留着 `setMatchPtr(0)`。没有任何检查能发现：那个 effect 只在**面板挂载
  期间**会话变化时运行，探针从不这么做，而 effect 里抛出的 ReferenceError 会被 React 的边界
  吞掉——复位静默执行到一半就停了。已修，并新增静态守卫 **Z3**：组件里调用的每个 `setXxx`
  都必须在 `const setX =` 或 `[x, setX] = useState(...)` 里出现过（全局白名单只有
  setTimeout / setInterval / setImmediate）。变异：把 `setMatchId` 换回 `setMatchPtr` → 红。
- **搜索计数与选中记录会脱节。** 当前命中记录的是 `matches` 的**数组下标**，站点列表一变
  含义就变了：翻页后计数显示 `2/3`，而选中的是当时的第 2 个命中、现在已经是第 3 个。
  改为记录站点 id，计数从 id 反推下标；实测 `2/3`（选中第 3 个）→ `3/3`（与选中一致）。
  断言见探针 23d（变异 → 红）。
- **探针第三段拆分。** 第二轮探针半场也长到 30.4 s（`agent-browser eval` 上限 30 s），
  超时会报"结果无法解析"而不是红断言——比失败更糟。按同样的理由拆成 `probe-detail2.js`，
  `browser-check` 顺序跑三段，门禁与编号脚本都改为统计三个文件。
- **合法的分数 `seq` 会把整轮时间线翻到最前。** 宿主用 `22 - 0.9` 标记被打断的回复，
  好让它排在 22 的错误之前。`seqOf` 却把分数当成非法值返回 `null`，而且是**整份节点
  列表**一起重算；`null < 20` 在 JS 里为真，于是那一轮被拉到最前面。实测顺序从
  `用户10 / 步骤1 / 用户20 / 前缀 / 错误22` 变成 `前缀 / 用户20 / 错误22 / 用户10 / 步骤1`。
  现在分数保留为排序值，锚点仍然要求整数（因此分数 seq 不会拿到 `e` 锚点）。断言 `SEQ1`。
  同时把三处排序/比较都收口到 `orderKey`，`null` 再也不可能参与减法。
- **窗口外的压缩请求会被窗口内的标记借用。** 请求自己声明了 `replacementSeq: 10`，
  标记 20 只因为"完成时间在 1 分钟内"就把它取走了——面板显示的是另一个标记的输出，
  而 `unplacedRequests` 还是 0。现在声明了不同 `replacementSeq` 的请求不参与时间兜底，
  宁可报告"有请求未放置"。断言 `COMPACT1`。
- **补齐调用头后，之前复制的结果锚点失效。** 从孤立结果复制的 `tvp1:e19`，在加载更早一页
  之后 seq 19 变成了步骤 15 的一个单元格，锚点却报"该记录不在当前窗口"，而输出就在屏幕上。
  工具单元格现在记录 `resultSeq`，解析器找不到站点时回退到吸收该结果的步骤。断言 `ANCHOR1`。
- **缺失 `callId` 时，一条结果会被另一轮的工具领走。** 日志省略 `callId` 时，所有无 id 的结果
  落在同一个桶里，"第一条未消费的"就把轮次 2 的输出给了轮次 1 的调用——面板上 `CALL_A` 显示
  `ONLY-RESULT-B`，真正的调用者 `CALL_B` 什么都没有，**没有任何诊断**。现在优先取"同一轮、
  在调用之后"的结果，无 id 的调用拒绝跨轮借用（宁可显示没有结果）。断言 `PAIR1`（变异 → 红）。
- **长表格的"看起来像分隔符"一行会让详情面板冻住。** 分隔符判定是
  `/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/`，两个字符类在 `-` 上重叠，失败时对每个位置重新切分：
  2,000 个横杠 96 ms、4,000 个 575 ms、8,000 个 2.1 s、16,000 个 7.4 s、20,000 个 **32.8 s**。
  这是一次同步卡死，输入是模型能生成的正文。改成一次线性扫描，20,000 个横杠 0.5 ms。
  断言 `LINEAR1`（1 s 上限 = 修复后成本的 10 倍、旧实现的 1/33；变异 → 红）。
- **一个不可打印的字段能让整个面板变成错误卡。** `stepOf` 直接 `Number(v)`，而
  `{toString: null}` 没有任何原始值转换——`Number` 抛异常，整个轨迹视图被边界卡替换
  （实测：站点 0、`Cannot convert object to primitive value`）。现在 `stepOf` 有保护：
  一个坏数字只应损失一个标签。断言 `HOSTILE1`（6 个字段逐个注入，变异 → 红）。
- **Markdown 导出的波浪号围栏。** GFM 的围栏除了 ``` 还有 `~~~`，只转义了前者：正文里一个
  未闭合的 `~~~` 会把后面所有站点吞进代码块。现在两种围栏都转义。断言 `HOSTILE2`（变异 → 红）。
- **内容签名的真实哈希碰撞。** 卡片签名是 32 位 FNV-1a，`mix` 把数字折进 64 位状态——两个只差
  24 小时的普通时间戳（1700000000000 与 1704294967296）落在了同一个签名上。缓存的卡片停在
  `06:13:20`，而 minimap 刻度（签名里带 `fmtClock`）已经走到 `23:16:07`。时区变化是同一个形状。
  现在签名尾部再带上**渲染出来的**时间文本与 `turn`（`turn` 原来完全没被哈希）。断言第 25 组。

### Performance

- **一条工具的耗时变化会让整窗的卡全部重建。** 卡片签名哈希了"全部工具耗时之和"，而卡片实际
  只用**有效分母**（`max(1, maxToolMs || toolMs)`）。改成哈希有效分母后，同一会话、同一条快照、
  只改一条非最大值工具的耗时：**600 站 2072–2214 ms → 27–123 ms**（四次连续测量的完整数组）。
  这条没有加计时断言（阈值在 CI 上不可靠），数字与对照方法记在 `docs/DESIGN.md` §13.83。

### Added

- 门禁 `path-leak-check`：随包发布的文件里不得出现本机绝对路径（用户主目录、外挂卷、系统临时目录）。
  `npm run check` 与 CI 都是 10 步。`docs/DESIGN.md` 里 10 处本机路径已替换为 `<repo>` / `<workdir>` / `$NODE_HOME`。
- `readme-numbers` 现在也核对 `--shots` 行末尾的**合计**（"共 N 组" / "(N total)"）。这个数字之前
  完全没被检查：英文 README 写着 "(30 total)" 六个版本没人发现，中文写着"共 35 组"而实际是 36。

### Changed

- **错误 KPI 的标签改成"出错步骤"。** 它数的是"含错误的步骤"，不是错误个数：一个步骤里 24 个工具、
  4 个失败，显示 1。数字没错，标签让人误读。新增断言要求它与标记为"出错"的站卡数一致。
- README 的只读声明补上唯一的例外：给宿主里没有 `id`/`name` 的表单字段补 `id`（只写 `id`）。
- `package-lock.json` 从 0.10.0 刷新到 0.11.5（它不在发布白名单里，只是描述漂移）。
- 探针 37 组 / 243 条断言（0.11.5 是 35 / 230，本文件早先的 0.11.5 条目写成 "32 组 / 218 条"，
  基线取的是中途某个提交；正确基线是 0.11.4 的 28 组 / 189 条）。

## 0.11.5 — 2026-11-26

### Performance

- **900 站窗口里每敲一个字要 1.3–2.2 秒，搜索等于不可用。** 症状来自"重建元素"而不是"重渲染组件"：`stations.map(...)` 每次 fold 都造新的 `jsx(...)`，引用必然变，于是 900 张卡片和 900 个 minimap 刻度每次都重渲染。现在按内容签名缓存元素对象，React 在元素引用相同时直接跳过整棵子树。**600 站一次重算 1948–2540 ms → 15–120 ms；900 站一次按键从"测不出来（撞 30 s 上限）"→ 21–69 ms**（同机背靠背对比 `v0.11.4`）。
- 搜索淡化从"每个卡片一个 `data-seek-dim` 属性"改成容器上一个 `data-searching` + 样式表选择器。第一次按键原来要让 900 张卡片全部失效（2.4 s），现在卡片元素身份不变。
- 签名的计算从"每次渲染"改为"每棵树一次"（按 `stations` 数组引用缓存）：纳入 cell 正文后，真实 1.11 MB 窗口的重复渲染从 105 ms 回到 21 ms。

### Fixed

- **缺 `kind` 的块把字面量 `undefined` 送进了无障碍名称。** 真实会话渲染下 695 个站点里 315 个的 `aria-label` 读作「未知内容 · undefined」。根因是 `${t("block.unknown")} · ${String(b.kind)}` —— 对**未来的** kind 写法正确，对**缺失的** kind 就输出那五个字母。现在两种情况分开：未来 kind 命名它，缺失 kind 只说「未知内容」。
- **三处元素缓存的输入没进签名，会产生陈旧渲染**（两处由外部审查发现）：
  - 卡片渲染 cell 的 `text` / `thinking` / `name` / `args` / `errorName` / `durationMs`，签名只哈希了形状 —— 一个已结束步骤的文本更新后，卡片继续显示旧文本；
  - minimap 刻度的漫游 Tab 停靠点有「总览」分支（`revealed === null && i === 0`），签名只哈希了选中分支 —— 选中任何站点后刻度条上有**两个** Tab 停靠点；
  - 耗时条的宽度除以**全局**最慢工具耗时（`stats.maxToolMs`），签名哈希的是站点级字段 —— 别的站点变慢后，本卡的条保持旧比例。
- **`layout effect` 一度放错了位置。** `TraceMapView` 中间有 `if (N === 0)` 早退，在它下面声明 hook 会在空快照/加载态被跳过，React 抛 `Rendered fewer hooks than expected`，整块面板变成错误卡片。已移到早退之上，并加静态门禁 `Z2`。
- README §7 的 `Home` / `End` 一行与行为不符：`End` 的实际行为是「显示全部 / 回到总览」，不是「跳到最后一个站点」。已拆成两行写明。

### Added

- **探针 28 组 → 35 组 / 189 条 → 230 条断言**（相对上一版 `0.11.4`），且每条都做过变异验证（把实现改坏后必须报红）：
  - 第 19 组「加载更早历史」：造 10 轮 → 选中第 6 个 → 再塞进 10 轮更早的，断言读者仍停在同一轮次、编号全部重算。README §2 承诺过这个按钮，此前只测过它「是按钮」。
  - 第 20 组：20000 字符正文里改**正中间一个字符**，要求卡片更新（防"只哈希前缀"这种看起来很合理的优化）。
  - 第 21 组：缺 `kind` 的块不得出现字面量 `undefined`，**同时**未来的 kind 仍必须被命名（只测前者会奖励"一律显示未知内容"这个更差的实现）。
  - 第 22 组：只改 cell 文本，要求卡片和它的 `aria-label` 同时更新。
  - 第 23 组：minimap 只有一个 Tab 停靠点；只有**别的**站点变慢时，本卡的耗时条比例必须重算。
  - 英文 pass 增加「原地切换语言（不重挂载）」—— 真实宿主换的是 locale 绑定，`t` 换身份而实例还活着。
- **新门禁 `harness-stamp`**（CI 9 项 / 本地 9 步）：`build-client.mjs` 只写 `lib/client.js`，而 `harness.html` 内联的是上一次的 bundle。手工验证时打开旧页面会得到**关于上一个版本**的结论——这次差点因此把一个正确的修复回滚掉。现在 harness 记录 bundle 指纹，`build-client` 制造陈旧时会当场提示。
- 缓存按当前窗口淘汰：流式站点每次 fold 都换成 durable 站点（新 id），不淘汰的话两张元素 map 只增不减。

### Changed

- **`test/browser/probe.js` 拆成 `probe.js`（组 1–8）+ `probe-detail.js`（组 8b–23）。**
  `agent-browser eval` 有 30 秒硬上限，一整条探针跑到上限时的失败形态是「结果无法解析」
  而不是红断言——那是最难查的一种失败。现在每半个文件一次 `eval`。
- 第 18 组「流式快照首次被画出来」（`live`）在 `0.11.4` 之后补的，本版一并发布。
- `npm run check` 8 步 → 9 步（新增 `harness-stamp`）。
- `docs/DESIGN.md` 新增 §13.72–13.79：性能调查的完整过程（含一次**失败的** `React.memo` 尝试、比不改还慢 50%）、真实会话验证、外部审查发现的三处漏项、以及两处"测试全绿但抓不到"的空白。

## 0.11.4 — 2026-11-26

### Fixed

- **中文界面里的 Token 用量 chip 是硬编码英文。** 「原始请求」标签下那一排显示 `in 880  fresh 500  cache-read 320  cache-write 60  out 52  think 12`，而 README §2 的中文原话是「入站（含缓存读 / 写）与出站（含思考）明细」。已补 6 个 locale 键（入站 / 未缓存 / 缓存读 / 缓存写 / 出站 / 思考），英文侧保持原词。这是 §13.68 记的那类缺陷：I18N3 守卫只查「代码里有中文」，查不到「英文字面量进了中文界面」。

### Added

- **英文界面首次被渲染验证。** harness 新增 `__setLocale` / `__remount` 路径，`test/browser/probe-en.js` 做一遍英文渲染，断言 chrome 里不含 CJK 且确实翻译了。此前 28 组观测、189 条断言里没有一条碰过 `en`。
- 浏览器探针补齐 README §2 剩余的全部入口：KPI 与模型名、⏱ 等距/按时钟切换、详情面板 ⤢ 展开、minimap 跳转与高亮、🔗 锚点输入框（含地址栏同步与往返验证）、📋 复制本步复盘、📋 Markdown 整段导出、⚡ 提示词变更、「原始请求」四段（系统提示 / 工具目录 / 消息列表 / Token 用量）、子调用卡片、证据等级、空态与不兼容态。

### Changed

- `test/browser/probe-en.js` 拆成独立文件：`agent-browser eval` 有 30 秒硬上限，英文组放进主探针后整条跑到 30.03 秒，失败形态是「结果无法解析」而不是红断言。现在主探针 28 秒、英文 pass 5 秒。
- `readme-numbers.mjs` 现在遍历两个 probe 文件累加数字，并且只把 `failures.push("…")` 字面量算作断言（转发 `push(...arr)` 不算）。
- 探针总量：14 组 / 57 条 → 28 组 / 189 条（`--shots` 另加 1 组 / 3 条）。

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
