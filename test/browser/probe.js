/* In-page assertions for scripts/browser-check.mjs. Returns {failures:[], info:{}}. */
(async function () {
	const tick = (ms) => new Promise((r) => setTimeout(r, ms === void 0 ? 120 : ms));
	// Poll for a condition instead of sleeping a guess. `agent-browser eval` aborts at
	// 30 s, and fixed sleeps were 19.8 s of the probe's 28 s — most of it waiting longer
	// than the thing needed. `waitFor` returns the moment the DOM agrees (§13.70).
	const waitFor = async (fn, budgetMs) => {
		const until = Date.now() + (budgetMs === void 0 ? 3000 : budgetMs);
		while (Date.now() < until) {
			if (fn()) return true;
			await tick(60);
		}
		return fn();
	};
	const failures = [];
	const info = {};
	const fail = (m) => failures.push(m);
	const opts = () => [...document.querySelectorAll("[role=option]")];
	const scroller = () => document.querySelector(".dstv_scroller");
	const selected = () => opts().map((o, i) => (o.getAttribute("aria-selected") === "true" ? i : -1)).filter((i) => i >= 0);
	const tabStops = () => opts().map((o, i) => (o.tabIndex === 0 ? i : -1)).filter((i) => i >= 0);
	const fullyVisible = (i) => {
		const sc = scroller().getBoundingClientRect();
		const b = opts()[i].getBoundingClientRect();
		return b.left >= sc.left - 2 && b.right <= sc.right + 2;
	};
	const press = async (k) => {
		document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
		await tick();
	};

	info.stations = opts().length;
	info.runtimeErrors = (window.__errors || []).slice(0, 3);
	if (info.stations < 10) fail("the fixture rendered only " + info.stations + " stations");
	if (info.runtimeErrors.length > 0) fail("runtime errors: " + info.runtimeErrors.join(" | "));

	// 1) every interactive element must expose an accessible name
	//
	// This check used to end with `&& el.tagName !== "INPUT"`, which excused EVERY input:
	// an `<input>` with no aria-label, no title and no label always passed, so the one
	// control type a screen reader announces as "edit text, blank" was the only one that
	// could never fail. Inputs are the reason this assertion exists.
	//
	// Scoped to the panel: the harness host renders its own chrome, and failing on a
	// control this plugin did not create would be a false alarm.
	const accessibleName = (el) => {
		if ((el.getAttribute("aria-label") || "").trim() !== "") return true;
		if ((el.getAttribute("title") || "").trim() !== "") return true;
		const labelled = el.id !== "" && document.querySelector(`label[for="${el.id}"]`) !== null;
		if (labelled) return true;
		return (el.textContent || "").trim() !== "";
	};
	const nameless = [...document.querySelectorAll(".dstv_root button, .dstv_root a, .dstv_root input, .dstv_root select, .dstv_root textarea")]
		.filter((el) => !accessibleName(el));
	if (nameless.length > 0) {
		fail(nameless.length + " interactive element(s) with no accessible name: "
			+ nameless.map((el) => el.tagName + "." + String(el.className || "")).slice(0, 3).join(", "));
	}

	// 2) click a step station: selection follows, the card scrolls into view, keyboard roving moves
	const stepIdx = opts().findIndex((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
	if (stepIdx < 0) fail("the fixture has no step station");
	else {
		opts()[stepIdx].click();
		await tick();
		if (selected().join() !== String(stepIdx)) fail("clicking station " + stepIdx + " selected " + JSON.stringify(selected()));
		if (tabStops().join() !== String(stepIdx)) fail("the roving tab stop did not follow the selection");
		if (!fullyVisible(stepIdx)) fail("the selected station is not scrolled fully into view");
		info.clickScrollLeft = Math.round(scroller().scrollLeft);
	}

	// 3) keyboard: Root focused, ArrowRight/Left move + scroll, Home/End work
	document.querySelector(".dstv_root").focus();
	if (document.activeElement !== document.querySelector(".dstv_root")) fail("the panel root is not focusable");
	const before = selected()[0];
	await press("ArrowRight");
	const afterRight = selected()[0];
	if (afterRight !== before + 1) fail("ArrowRight moved " + before + " -> " + afterRight);
	if (!fullyVisible(afterRight)) fail("ArrowRight left the new selection off-screen");
	await press("ArrowLeft");
	if (selected()[0] !== before) fail("ArrowLeft did not return to " + before);
	await press("Home");
	if (selected()[0] !== 0) fail("Home did not select station 0");
	if (!fullyVisible(0)) fail("Home left station 0 off-screen");
	await press("End");
	if (selected().length !== 0) fail("End should return to the overview (no selection), got " + JSON.stringify(selected()));
	info.keyboard = "ok";

	// 3b) the documented shortcut table (README §7) has nine rows; this probe used to
	// cover four of them. Space, PageUp/PageDown, `/`, `f` and `r` were promised to
	// users and verified by nothing — the gap §13.56 records. One group, so a
	// regression names itself instead of hiding behind "keyboard = ok".
	{
		const root = document.querySelector(".dstv_root");
		const searchEl = () => document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)");

		// `/` and `f` both focus the search box. They are one documented row, but the
		// handler has two branches, so both get checked.
		for (const key of ["/", "f"]) {
			root.focus();
			await press(key);
			if (document.activeElement !== searchEl()) fail("`" + key + "` did not focus the search box");
		}

		// Space starts and stops replay — the second documented way to do what the
		// buttons do. The buttons are covered in group 6; this covers the key.
		root.focus();
		const home0 = selected()[0];
		await press(" ");
		await tick(300);
		const sp0 = selected()[0];
		await waitFor(() => typeof selected()[0] === "number" && selected()[0] > sp0, 4000);
		const sp1 = selected()[0];
		if (!(typeof sp1 === "number" && sp1 > sp0)) fail("Space did not start replay (" + sp0 + " -> " + sp1 + ")");
		await press(" ");
		await tick(120);
		const sp2 = selected()[0];
		await tick(1600);
		if (selected()[0] !== sp2) fail("Space did not stop replay");

		// PageUp/PageDown land on TURN starts, never on an arbitrary station.
		await press("Home");
		await press("PageDown");
		const pd = selected()[0];
		if (!(typeof pd === "number" && pd > 0)) fail("PageDown did not move forward from station 0 (got " + JSON.stringify(pd) + ")");
		await press("PageDown");
		const pd2 = selected()[0];
		if (!(typeof pd2 === "number" && pd2 > pd)) fail("a second PageDown did not advance past " + pd + " (got " + JSON.stringify(pd2) + ")");
		await press("PageUp");
		if (selected()[0] !== pd) fail("PageUp did not return to " + pd + " (got " + JSON.stringify(selected()[0]) + ")");

		// `/` and `f` both focus the search box (README §7). Neither was ever pressed by
		// any probe: the shortcut gate accepted "the file mentions `f` somewhere", and `f`
		// appears 199 times as an ordinary letter. Assert the FOCUS moves, which is the
		// whole promise — and that it lands on the search input, not just anywhere.
		{
			// Written out one key at a time on purpose: the shortcut gate looks for a
			// literal `press("<key>")`, so a loop over ["/", "f"] would satisfy the prose
			// and not the check.
			root.focus();
			await press("/");
			const afterSlash = document.activeElement;
			if (!(afterSlash !== null && afterSlash.tagName === "INPUT" && String(afterSlash.className || "").indexOf("dstv_searchInput") >= 0)) {
				fail("`/` did not focus the search box (active: " + (afterSlash === null ? "null" : afterSlash.tagName + "." + String(afterSlash.className || "")) + ")");
			}
			if (typeof afterSlash.blur === "function") afterSlash.blur();
			root.focus();
			await press("f");
			const afterF = document.activeElement;
			if (!(afterF !== null && afterF.tagName === "INPUT" && String(afterF.className || "").indexOf("dstv_searchInput") >= 0)) {
				fail("`f` did not focus the search box (active: " + (afterF === null ? "null" : afterF.tagName + "." + String(afterF.className || "")) + ")");
			}
			if (typeof afterF.blur === "function") afterF.blur();
		}

		// `End` means two different things depending on WHERE focus is, and README footnote 1
		// now says so. Pin both so a future change cannot quietly merge them again.
		{
			const opt = [...document.querySelectorAll("[role=option]")];
			const last = opt[opt.length - 1];
			const first = opt[0];
			if (last === void 0 || first === void 0) fail("no stations for the End-semantics check");
			else {
				// Focus the FIRST station so the assertion measures a MOVE. Focusing the last
				// one first made the check pass even with the branch deleted.
				first.focus();
				await press("End");
				if (document.activeElement !== last) {
					fail("`End` on a station card moved focus to "
						+ (document.activeElement === null ? "null" : String(document.activeElement.getAttribute("aria-label") || document.activeElement.tagName))
						+ " instead of the last station");
				}
				if (selected().length === 0) fail("`End` on a station card cleared the selection; that is the panel-root behaviour");
				root.focus();
				await press("End");
				if (selected().length !== 0) fail("`End` on the panel root did not return to the overview (still selected " + JSON.stringify(selected()) + ")");
			}
		}

		// `r` toggles the request tab, but ONLY where a request exists. Pick a step
		// station (they carry `request`) and check both directions plus the guard.
		const stepSt = [...document.querySelectorAll(".dstv_station")]
			.find((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
		if (stepSt === undefined) fail("the fixture has no step station for the `r` check");
		else {
			stepSt.click();
			await tick();
			root.focus();
			// The tabs are `button.dstv_tab` with `aria-pressed` / `data-on`, not
			// `[role=tab]` with `aria-selected`. My first version selected on the ARIA
			// tab pattern, matched nothing, and reported "`r` did not switch the tab"
			// with the tab text as "" — the probe was wrong, not the shortcut. Read the
			// attribute the component actually sets.
			const tabOf = () => {
				const on = [...document.querySelectorAll("button.dstv_tab")]
					.filter((t) => t.getAttribute("aria-pressed") === "true");
				return on.length > 0 ? (on[0].textContent || "").trim() : "";
			};
			const t0 = tabOf();
			await press("r");
			const t1 = tabOf();
			if (t1 === t0) fail("`r` did not switch the detail tab (stayed on " + JSON.stringify(t0) + ")");
			await press("r");
			if (tabOf() !== t0) fail("a second `r` did not switch back to " + JSON.stringify(t0));
		}

		// Leave NO selection: group 4 asserts that typing a query does not move the
		// view, which only means anything from the overview state the keyboard group
		// ended in. My first version pressed Home here and the search group then failed
		// with "typing a query moved the view before any navigation" — the probe had
		// changed the precondition of a later assertion, which is worse than a gap.
		await press("End");
		if (selected().length !== 0) fail("could not return to the overview after the shortcut checks");
		info.shortcuts = "ok";
	}

	// 4) search: no false position before navigating, then ↓ walks the matches and scrolls
	const input = document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)");
	if (input === null) fail("the search input is missing");
	else {
		const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set;
		setter.call(input, "报错");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
		const counter = document.querySelector(".dstv_searchCount");
		if (counter === null) fail("the match counter did not render");
		else if (counter.textContent.indexOf("–/") < 0) fail("a fresh query already claims a position: " + counter.textContent);
		if (selected().length !== 0) fail("typing a query moved the view before any navigation");
		// The box must keep what the user typed, spaces included. Binding the trimmed
		// match string instead made a controlled input swallow the trailing space on every
		// keystroke, so "alpha beta" could not be typed one key at a time (it became
		// "alphabeta"). Assert the INPUT VALUE, which is the only place this shows up.
		{
			const keep = input.value;
			// A TRAILING space is the case that broke: trim() strips it, so the controlled
			// input re-rendered without it and the next word ran into the previous one.
			const spaced = "报错 ";
			setter.call(input, spaced);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			if (input.value !== spaced) fail("the search box rewrote the typed text: " + JSON.stringify(spaced) + " -> " + JSON.stringify(input.value));
			setter.call(input, keep);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
		}
		// The non-matching cards must actually LOOK dimmed. The rule used to name
		// `.dstv_listbox`, which no element carries — the row is `.dstv_hflow` — so the
		// container attribute was set, the minimap dimmed, and every card stayed at full
		// opacity. Asserting the attribute (or the class list) would have passed; only the
		// computed style proves the reader can tell matches from non-matches.
		{
			const probeCard = document.querySelector(".dstv_station:not([data-dim=true]):not([data-match=true]) .dstv_hcard");
			const matchCard = document.querySelector(".dstv_station[data-match=true] .dstv_hcard");
			if (probeCard === null) {
				// Every station matched: a legitimate outcome of this fixture, nothing to dim.
				if (matchCard === null) fail("the search left neither a matched nor a non-matched card, so dimming cannot be observed");
			} else {
				const dimmedOpacity = Number(getComputedStyle(probeCard).opacity);
				if (!(dimmedOpacity < 1)) fail("a non-matching card is not dimmed while searching (opacity " + String(dimmedOpacity) + ")");
				if (matchCard !== null && Number(getComputedStyle(matchCard).opacity) !== 1) {
					fail("a MATCHING card is dimmed while searching (opacity " + getComputedStyle(matchCard).opacity + ")");
				}
			}
		}
		const next = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "下一个命中");
		const prev = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "上一个命中");
		if (next === undefined || prev === undefined) fail("the prev/next match buttons are missing");
		else {
			if (next.disabled === true) fail("the next-match button is disabled while matches exist");
			next.click();
			await tick();
			if (counter.textContent.indexOf("1/") < 0) fail("the first ↓ did not land on match 1: " + counter.textContent);
			if (selected().length !== 1) fail("the first ↓ left no station selected");
			if (!fullyVisible(selected()[0])) fail("the matched station is not scrolled into view");
			next.click();
			await tick();
			if (counter.textContent.indexOf("2/") < 0) fail("the second ↓ did not advance: " + counter.textContent);
			// `↑` / `↓` inside the search box — a documented row (README §7) that was
			// silently missing from the implementation until §13.57. Assert the counter
			// MOVES: "the view did something" is not the claim, "next match" is.
			const searchBox = document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)");
			searchBox.focus();
			const cntBefore = counter.textContent;
			await press("ArrowDown");
			const cntDown = counter.textContent;
			if (cntDown === cntBefore) fail("`↓` in the search box did not move to the next match (stayed " + cntBefore + ")");
			await press("ArrowUp");
			if (counter.textContent !== cntBefore) fail("`↑` did not return to " + cntBefore + " (got " + counter.textContent + ")");
			// Enter / Shift+Enter — the third documented jump pair (README §7) and the
			// one most people actually use. Shift+Enter must move BACKWARD; testing only
			// Enter would pass even if shiftKey were ignored entirely.
			const shiftPress = async (k, shiftKey) => {
				document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }));
				await tick();
			};
			searchBox.focus();
			const cntEnter0 = counter.textContent;
			await shiftPress("Enter", false);
			const cntEnter1 = counter.textContent;
			if (cntEnter1 === cntEnter0) fail("`Enter` did not move to the next match (stayed " + cntEnter0 + ")");
			await shiftPress("Enter", true);
			if (counter.textContent !== cntEnter0) fail("`Shift+Enter` did not step back to " + cntEnter0 + " (got " + counter.textContent + ")");
			// ▲ the loaded-range badge (README §2 "检索范围显式标注"): while a search is
			// active and older history exists, the panel MUST say the search only covers
			// what is loaded — an unqualified "0 matches" is the lie this badge exists to
			// prevent. The harness session store starts with hasMore: true, so it must be
			// here; nothing verified it before (§13.61).
			const scope = document.querySelector(".dstv_scope");
			if (scope === null) fail("a search with hasMore=true rendered no ⬆ loaded-range badge");
			else {
				if ((scope.textContent || "").indexOf("仅已加载") < 0) fail("the scope badge does not say the range is limited: " + JSON.stringify((scope.textContent || "").slice(0, 40)));
				if (scope.getAttribute("title") === null) fail("the scope badge has no explanation tooltip");
				// It is an actionable control here: the harness supplies loadOlder, so the
				// badge must be a live button rather than the static notice variant.
				if (scope.tagName.toLowerCase() !== "button") fail("with loadOlder available the badge should be a button, got <" + scope.tagName.toLowerCase() + ">");
				if (scope.hasAttribute("data-static")) fail("the badge is marked data-static while a loader exists");
			}
			// And when older pages do NOT exist, the badge must vanish — a permanent
			// "loaded range only" warning on a fully loaded session is noise that teaches
			// readers to ignore it.
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: false }));
			await tick(120);
			if (document.querySelector(".dstv_scope") !== null) fail("the loaded-range badge is still shown on a fully loaded session");
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true }));
			await tick(120);
			if (document.querySelector(".dstv_scope") === null) fail("the loaded-range badge did not come back when hasMore returned");
			// Esc clears the query and leaves the overview reachable again. It must ALSO
			// retract the scope badge: a stale "loaded range only" chip next to an empty
			// box would be the same class of lie as an unqualified "0 matches".
			await press("Escape");
			if (searchBox.value !== "") fail("`Esc` did not clear the search box (value " + JSON.stringify(searchBox.value) + ")");
			if (document.querySelector(".dstv_scope") !== null) fail("the loaded-range badge survived Esc — the search is over, the warning is stale");
			info.search = counter.textContent;
		}
	}

	// 5) copy: the component must call the clipboard with a parsable anchor.
	// Re-select a STEP first: the search assertions above leave a text-only station
	// selected, which has no request and therefore no copy button — a probe error, not
	// a product one (measured: the button exists on every step station).
	const stepForCopy = opts().findIndex((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
	if (stepForCopy >= 0) { opts()[stepForCopy].click(); await tick(120); }
	const wrote = [];
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: async (t) => { wrote.push(t); } }
	});
	// The button's accessible name comes from its TEXT ("🔗 复制锚点"); it carries no
	// aria-label. Matching only on aria-label was a probe error.
	const copyBtn = [...document.querySelectorAll("button")].find((b) => /复制锚点/.test((b.getAttribute("aria-label") || "") + (b.textContent || "")));
	if (copyBtn === undefined) fail("the copy-anchor button is not on the selected step");
	else {
		copyBtn.click();
		await tick(120);
		if (wrote.length === 0) fail("clicking copy never called navigator.clipboard.writeText");
		else if (!/^tvp1:e\d+$/.test(wrote[wrote.length - 1])) fail("the copied anchor has the wrong shape: " + wrote[wrote.length - 1]);
		else info.copied = wrote[wrote.length - 1];

		// The other two clipboard buttons the README advertises, still on this same step
		// station: "📋 复制本步复盘" (a per-step markdown pack) and the header's
		// "📋 Markdown" (the whole trace). Both only ever ran inside the pure unit tests —
		// the BUTTONS were never clicked, so a broken wiring (wrong slice, wrong builder)
		// would have shipped silently (§13.65).
		const clickCopy = async (re) => {
			const before = wrote.length;
			const btn = [...document.querySelectorAll("button")]
				.find((b) => re.test((b.getAttribute("aria-label") || "") + (b.textContent || "")));
			if (btn === undefined) return null;
			btn.click();
			await tick(300);
			return wrote.length > before ? wrote[wrote.length - 1] : null;
		};

		const stepPack = await clickCopy(/复制本步/);
		if (stepPack === null) fail("clicking 📋 复制本步复盘 wrote nothing to the clipboard");
		else {
			// A per-step pack must be a markdown document about THIS step, not the whole
			// trace: headings, the step's own tool, and no other turn's text.
			if (stepPack.length < 80) fail("the step pack is suspiciously short (" + stepPack.length + " chars)");
			if (!/^#|\n#/.test(stepPack)) fail("the step pack has no markdown heading");
			if (stepPack.indexOf("pwsh") < 0 && stepPack.indexOf("read") < 0) fail("the step pack does not mention the tool this step called");
			if (stepPack.indexOf("128 passing") >= 0) fail("the step pack leaked another step's tool result into this step's pack");
			info.stepPack = stepPack.length;
		}

		const traceMd = await clickCopy(/Markdown/);
		if (traceMd === null) fail("clicking 📋 Markdown wrote nothing to the clipboard");
		else {
			// The whole-trace export must be strictly larger than one step's pack, and must
			// cover the fixture's later turns — that is what "整段轨迹" means.
			if (stepPack !== null && traceMd.length <= stepPack.length) fail("the whole-trace markdown (" + traceMd.length + ") is not larger than one step's pack (" + stepPack.length + ")");
			if (traceMd.indexOf("第 7 轮问题") < 0) fail("the whole-trace markdown does not include the later turns");
			if (!/附录|Appendix/.test(traceMd)) fail("the whole-trace markdown has no system-prompt appendix");
			info.traceMd = traceMd.length;
		}
	}

	// 6) replay: the interval advances the selection and pause stops it
	const play = [...document.querySelectorAll("button")].find((b) => /开始回放/.test((b.getAttribute("aria-label") || "") + (b.textContent || "")));
	if (play === undefined) fail("the replay button is missing");
	else {
		play.click();
		await tick(300);
		const n0 = selected()[0];
		await waitFor(() => typeof selected()[0] === "number" && selected()[0] > n0, 4000);
		const n1 = selected()[0];
		if (!(typeof n1 === "number" && n1 > n0)) fail("replay did not advance within 4 s (" + n0 + " -> " + n1 + ")");
		const pause = [...document.querySelectorAll("button")].find((b) => /暂停/.test((b.getAttribute("aria-label") || "") + (b.textContent || "")));
		if (pause === undefined) fail("the pause button did not appear during replay");
		else {
			pause.click();
			await tick(120);
			const p0 = selected()[0];
			await tick(1600);
			if (selected()[0] !== p0) fail("pause did not stop the replay");
			info.replay = n0 + " -> " + n1 + " -> paused";
		}
	}

	// 7) detail panel must scroll internally, never grow the page
	const detail = document.querySelector(".dstv_detail");
	const body = document.querySelector(".dstv_dBody");
	if (detail !== null && body !== null) {
		const pageBefore = document.documentElement.scrollHeight;
		body.scrollTop = 1e6;
		await tick(120);
		if (body.scrollHeight > body.clientHeight + 1 && body.scrollTop === 0) fail("the detail body claims to scroll but did not move");
		info.detailScroll = { canScroll: body.scrollHeight > body.clientHeight + 1, movedTo: body.scrollTop };
	}

	// 8) contrast in BOTH themes, on composited backgrounds.
	// Measuring a translucent tint against itself (or near-white text against the
	// harness's own white seat) produced nonsense numbers twice; composite the real
	// ancestor chain first. 4.5:1 is the WCAG AA floor for normal-size text.
	const parseColor = (c) => {
		let m = String(c).match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?/);
		if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === void 0 ? 1 : +m[4] };
		m = String(c).match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?/);
		if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === void 0 ? 1 : +m[4] };
		return null;
	};
	const overOn = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
	const bgOf = (el) => {
		let acc = null;
		for (let cur = el; cur !== null; cur = cur.parentElement) {
			const p = parseColor(getComputedStyle(cur).backgroundColor);
			if (p === null || p.a === 0) continue;
			acc = acc === null ? p : overOn(acc, p);
			if (acc.a >= 0.999) return acc;
		}
		const body = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
		return acc === null ? body : overOn(acc, body);
	};
	const relLum = (c) => {
		const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
		return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
	};
	const ratioOf = (a, b) => { const l1 = relLum(a), l2 = relLum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
	const contrastSweep = (label) => {
		const rows = [];
		for (const [sel, name] of [[".dstv_name", "station name"], [".dstv_hcard", "card text"], [".dstv_tag", "turn tag"], [".dstv_searchCount", "match counter"], [".dstv_dText", "detail text"], [".dstv_chip", "chip"], [".dstv_axLabel", "axis label"]]) {
			const el = document.querySelector(sel);
			if (el === null) continue;
			const cs = getComputedStyle(el);
			const fgRaw = parseColor(cs.color);
			if (fgRaw === null || fgRaw.a === 0) continue;
			const bg = bgOf(el);
			const fg = fgRaw.a < 1 ? overOn(fgRaw, bg) : fgRaw;
			rows.push({ name, ratio: ratioOf(fg, bg) });
		}
		for (const r of rows) {
			if (r.ratio < 4.5) fail(label + ": " + r.name + " measures " + r.ratio + ":1 (WCAG AA needs 4.5)");
		}
		return rows;
	};
	if (typeof window.__setTheme === "function") {
		window.__setTheme(false);
		await tick(120);
		info.contrastLight = contrastSweep("light theme").map((r) => r.ratio);
		window.__setTheme(true);
		await tick(120);
		info.contrastDark = contrastSweep("dark theme").map((r) => r.ratio);
		window.__setTheme(false);
		await tick(120);
	} else {
		fail("the harness cannot switch themes");
	}

	return JSON.stringify({ failures, info });
})()
