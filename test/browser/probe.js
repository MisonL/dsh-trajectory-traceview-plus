/* In-page assertions for scripts/browser-check.mjs. Returns {failures:[], info:{}}. */
(async function () {
	const tick = (ms) => new Promise((r) => setTimeout(r, ms === void 0 ? 120 : ms));
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
	const nameless = [...document.querySelectorAll("button,a,input")].filter((el) => {
		if (el.getAttribute("aria-label") !== null && el.getAttribute("aria-label") !== "") return false;
		return (el.textContent || "").trim() === "" && el.tagName !== "INPUT";
	});
	if (nameless.length > 0) fail(nameless.length + " interactive element(s) with no accessible name");

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
		await tick(2200);
		const sp1 = selected()[0];
		if (!(typeof sp1 === "number" && sp1 > sp0)) fail("Space did not start replay (" + sp0 + " -> " + sp1 + ")");
		await press(" ");
		await tick(200);
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
			await tick(200);
			if (document.querySelector(".dstv_scope") !== null) fail("the loaded-range badge is still shown on a fully loaded session");
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true }));
			await tick(200);
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
	if (stepForCopy >= 0) { opts()[stepForCopy].click(); await tick(200); }
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
		await tick(200);
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
		await tick(2200);
		const n1 = selected()[0];
		if (!(typeof n1 === "number" && n1 > n0)) fail("replay did not advance within 2.5 s (" + n0 + " -> " + n1 + ")");
		const pause = [...document.querySelectorAll("button")].find((b) => /暂停/.test((b.getAttribute("aria-label") || "") + (b.textContent || "")));
		if (pause === undefined) fail("the pause button did not appear during replay");
		else {
			pause.click();
			await tick(200);
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
		await tick(200);
		info.contrastLight = contrastSweep("light theme").map((r) => r.ratio);
		window.__setTheme(true);
		await tick(200);
		info.contrastDark = contrastSweep("dark theme").map((r) => r.ratio);
		window.__setTheme(false);
		await tick(200);
	} else {
		fail("the harness cannot switch themes");
	}

	// 8b) a host remount must not throw the reader back to "overview, empty search".
	// The host unmounts this panel on every tab switch (measured root count 0 → 1), so
	// without persisted state the reader loses their place every single time.
	if (typeof window.__remount === "function") {
		const stepForResume = opts().findIndex((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
		if (stepForResume < 0) fail("no step station to test resume with");
		else {
			opts()[stepForResume].click();
			await tick(200);
			const searchEl = document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)");
			const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(searchEl), "value").set;
			setter.call(searchEl, "报错");
			searchEl.dispatchEvent(new Event("input", { bubbles: true }));
			await tick(200);
			const beforeIdx = selected().slice();
			window.__remount();
			await tick(600);
			const afterIdx = selected().slice();
			const afterQuery = (document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)") || {}).value;
			if (afterIdx.join() !== beforeIdx.join()) fail("a remount lost the selection: " + beforeIdx.join() + " -> " + afterIdx.join());
			if (afterQuery !== "报错") fail("a remount lost the search query: " + JSON.stringify(afterQuery));
			// …and it must NOT leak into a different conversation.
			window.__remount({ sessionKey: "session-2" });
			await tick(600);
			const otherIdx = selected().slice();
			const otherQuery = (document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)") || {}).value;
			if (otherIdx.length !== 0) fail("view state leaked into another session: " + otherIdx.join());
			if (otherQuery !== "") fail("the search query leaked into another session: " + JSON.stringify(otherQuery));
			info.resume = { before: beforeIdx.join(), after: afterIdx.join(), query: afterQuery, leaked: otherIdx.length };
		}
	} else {
		fail("the harness cannot remount the view");
	}

	// 9) the host PINS the box: a view taller than its flex parent must scroll internally,
	//    never overflow into a host that clips it. This is the bug that shipped once: box
	//    501px, content 692px, overflow visible, and the bottom 191px was unreachable.
	const root = document.querySelector(".dstv_root");
	const viewArea = root.parentElement;
	const rootCS = getComputedStyle(root);
	const boxH = Math.round(root.getBoundingClientRect().height);
	const contentH = root.scrollHeight;
	info.clamp = { boxH, contentH, overflowY: rootCS.overflowY };
	if (contentH > boxH + 1) {
		if (rootCS.overflowY === "visible") fail("the view is taller than its box but overflow-y is visible: the host clips the bottom " + (contentH - boxH) + "px");
		const before = root.scrollTop;
		root.scrollTop = 1e6;
		await tick(200);
		const maxScroll = root.scrollHeight - root.clientHeight;
		if (maxScroll > 0 && Math.abs(root.scrollTop - maxScroll) > 2) fail("the view cannot scroll to its last pixel (scrollTop " + root.scrollTop + " of " + maxScroll + ")");
		root.scrollTop = before;
		await tick(120);
	}
	// Everything interactive must be REACHABLE: intersect each rect with every clipping
	// ancestor first — comparing raw rects to the composer reported a phantom overlap.
	const clippedRect = (el) => {
		const r = el.getBoundingClientRect();
		let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
		for (let p = el.parentElement; p !== null; p = p.parentElement) {
			const cs = getComputedStyle(p);
			if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
				const pr = p.getBoundingClientRect();
				box = { left: Math.max(box.left, pr.left), top: Math.max(box.top, pr.top), right: Math.min(box.right, pr.right), bottom: Math.min(box.bottom, pr.bottom) };
			}
			if (p === document.body) break;
		}
		return box;
	};
	const seatEl = document.querySelector('[class*="composerSeat"]');
	const unreachable = [];
	for (const el of document.querySelectorAll(".dstv_root button")) {
		const raw = el.getBoundingClientRect();
		if (raw.width === 0 || raw.height === 0) continue;
		const v = clippedRect(el);
		if (v.width <= 0 || v.height <= 0) { unreachable.push((el.textContent || "").trim().slice(0, 12) + ": clipped away entirely"); }
	}
	if (unreachable.length > 0) fail(unreachable.length + " control(s) clipped away: " + unreachable.slice(0, 3).join(" | "));
	if (seatEl !== null) {
		const seat = seatEl.getBoundingClientRect();
		root.scrollTop = 1e6;
		await tick(200);
		const underComposer = [...document.querySelectorAll(".dstv_root button")].filter((el) => {
			const v = clippedRect(el);
			return v.width > 0 && v.height > 0 && v.bottom > seat.top + 1 && v.top < seat.bottom;
		});
		root.scrollTop = 0;
		await tick(120);
		if (underComposer.length > 0) fail(underComposer.length + " control(s) sit under the host composer at max scroll");
		info.clamp.underComposer = underComposer.length;
	}

	// 10) tokens resolve (a missing host token silently kills the whole visual design)
	const rootStyle = getComputedStyle(document.querySelector(".dstv_root"));
	const missingVars = ["--dsw-alias-border-l2", "--dsw-alias-label-primary", "--dsw-alias-bg-layer-1"]
		.filter((v) => rootStyle.getPropertyValue(v).trim() === "");
	if (missingVars.length > 0) fail("theme token(s) unresolved: " + missingVars.join(", "));

	//11) the panel is a named landmark. The host renders no <main>, so axe reported
	// every node in this panel as "region: content not contained by landmarks"
	// (27 nodes measured). Declaring the panel a labelled region cleared our elements
	// (27 ->6; the6 left are the host sidebar). Assert the attribute survives, so a
	// refactor cannot silently drop it back to an unlabelled div.
	{
		const reg = document.querySelector(".dstv_root");
		const roleOk = reg !== null && reg.getAttribute("role") === "region";
		const labelOk = reg !== null && (reg.getAttribute("aria-label") || "").trim() !== "";
			info.landmark = { roleOk, label: reg !== null ? reg.getAttribute("aria-label") : null };
		if (!roleOk) fail("the panel root is not role=region (axe region violation returns)");
		if (!labelOk) fail("the panel region has no accessible name");
	}

	// 15c) the two detail-panel surfaces no browser test ever opened: nested sub-call
	// cards (`.dstv_subCard`, README §2 "子调用链完整卡片") and the evidence-level chips
	// (`.dstv_evRow`, README §2 "证据等级"). Both are pure paint over data the unit tests
	// already classify — the same gap as §13.60–§13.63, now closed for the last two
	// probe=0 items on the feature list (§13.64).
	{
		// --- sub-call cards: the fixture's `bash` result carries one nested `jest` call.
		// Tool calls live INSIDE step stations — there is no "工具" station kind, so the
		// first version of this block matched nothing and the whole group silently skipped
		// its real assertions. Dumped the labels to find out (measured list of 15) and
		// selected the turn-2 step, which is the one carrying the nested `jest` call.
		const toolSt = [...document.querySelectorAll(".dstv_station")]
			.find((o) => /轮次 2|turn 2/.test(o.getAttribute("aria-label") || ""));
		if (toolSt === undefined) fail("the fixture has no turn-2 step station to inspect sub-calls on");
		else {
			toolSt.click();
			await tick(300);
			const body = document.querySelector(".dstv_detail .dstv_dBody");
			if (body === null) fail("opening a tool station rendered no detail body");
			else {
				// The sub-call list lives inside a <details>; it must be present even when
				// collapsed (a reader who never expands it still needs the count).
				const summary = [...body.querySelectorAll("summary")]
					.find((e) => /子调用|sub-call/i.test(e.textContent || ""));
				if (summary === undefined) fail("the tool detail shows no sub-call section although the fixture has one");
				else {
					if (!/\(1\)|（1）|1/.test(summary.textContent || "")) fail("the sub-call summary does not state how many calls there are: " + JSON.stringify(summary.textContent));
					// Expand and verify the child card names the child tool, not the parent.
					const det = summary.parentElement;
					if (det !== null) det.open = true;
					await tick(200);
					const cards = [...body.querySelectorAll(".dstv_subCard")];
					if (cards.length === 0) fail("expanding the sub-call section rendered no .dstv_subCard");
					else if (!/jest/.test(cards[0].textContent || "")) fail("the sub-call card does not name the child tool: " + JSON.stringify((cards[0].textContent || "").slice(0, 60)));
					info.subCalls = cards.length;
				}
			}
		}

		// --- evidence chips: only the request tab has them, and only for a station whose
		// request carries a prompt (the fixture's first two steps do).
		const clickTab = async (match) => {
			const tab = [...document.querySelectorAll("button.dstv_tab")]
				.find((t) => (t.textContent || "").indexOf(match) >= 0);
			if (tab === undefined) return false;
			tab.click();
			await tick(300);
			return true;
		};
		const stepSt = [...document.querySelectorAll(".dstv_station")]
			.find((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
		if (stepSt === undefined) fail("the fixture has no step station for the evidence chips");
		else {
			stepSt.click();
			await tick(300);
			const opened = await clickTab("原始请求");
			if (!opened) fail("no 原始请求 tab on the detail panel");
			else {
				const row = document.querySelector(".dstv_evRow");
				if (row === null) fail("the request tab shows no evidence-level chips (README §2 promises them)");
				else {
					const chips = [...row.querySelectorAll(".dstv_ev")].map((e) => (e.textContent || "").trim());
					if (chips.length === 0) fail("the evidence row is present but empty");
					// Every chip must carry a tooltip explaining its level — a bare label like
					// "近似重建" without an explanation is the thing README §2 says must not happen.
					for (const c of row.querySelectorAll(".dstv_ev")) {
						if ((c.getAttribute("title") || "").trim() === "") fail("an evidence chip has no explanation tooltip: " + JSON.stringify(c.textContent));
					}
					if (!chips.some((c) => /重建|reconstruct/i.test(c))) fail("the message list is reconstructed but no chip says so: " + JSON.stringify(chips));
					info.evidence = chips.length;
				}
				await clickTab("详情");
			}
		}
	}

	// 15a) the detail panel's ⤢ expand / ⤡ collapse toggle (README §2: "详情面板可 ⤢ 展开
	// 全高 / ⤡ 收起"). `.dstv_panelToggle` was never clicked by any test; the panel grows
	// to full height and, crucially, must still CONTAIN its scrolling body afterwards —
	// expanding a panel whose body then overflows the window defeats the purpose.
	{
		const stepEl = [...document.querySelectorAll(".dstv_station")]
			.find((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
		if (stepEl === undefined) fail("no step station to open the detail panel on");
		else {
			stepEl.click();
			await tick(300);
			const detail = document.querySelector(".dstv_detail");
			if (detail === null) fail("clicking a step station opened no .dstv_detail");
			else {
				const toggle = detail.querySelector(".dstv_panelToggle");
				if (toggle === null) fail("the detail panel has no ⤢ expand button");
				else {
					const beforeH = detail.getBoundingClientRect().height;
					const wasFull = detail.classList.contains("full");
					toggle.click();
					await tick(300);
					const isFull = detail.classList.contains("full");
					if (isFull === wasFull) fail("the ⤢ toggle did not change the panel's expand state (still full=" + wasFull + ")");
					if (!isFull) fail("the first click did not EXPAND the panel");
					const afterH = detail.getBoundingClientRect().height;
					if (!(afterH > beforeH)) fail("expanding did not make the panel taller (" + beforeH + " -> " + afterH + ")");
					if (toggle.textContent !== "⤡") fail("the button glyph did not switch to ⤡ when expanded: " + JSON.stringify(toggle.textContent));
					// Its body must still scroll internally rather than pushing the page.
					const body = detail.querySelector(".dstv_dBody");
					if (body !== null) {
						const cs = getComputedStyle(body);
						if (cs.overflowY !== "auto" && cs.overflowY !== "scroll") fail("the expanded panel's body no longer scrolls internally (overflow-y=" + cs.overflowY + ")");
					}
					toggle.click();
					await tick(300);
					if (detail.classList.contains("full")) fail("the second click did not collapse the panel again");
					if (toggle.textContent !== "⤢") fail("the glyph did not return to ⤢ after collapsing");
				}
			}
		}
	}

	// 15b) the header controls the README §2 feature bullets promise: KPI summary and
	// the ⏱ isometric/clock axis toggle. Both were rendered by code that no browser test
	// ever looked at — the same "classifier tested, paint not" gap as §13.60/§13.61, found
	// by walking the feature list item by item (§13.62).
	{
		// KPI: every number README §2 names must be present, checked BY LABEL and not by
		// count. A "at least 6 cells" rule passed a mutation that deleted the errors cell,
		// because this fixture renders 7 (five fixed + tokens in + tokens out) — the count
		// stayed above the floor while a promised number vanished (§13.62).
		const kpis = [...document.querySelectorAll(".dstv_kpi")];
		const texts = kpis.map((k) => (k.textContent || "").trim());
		const missingKpi = ["轮次", "步骤", "工具", "错误", "工具总耗时"].filter((lb) => !texts.some((t2) => t2.indexOf(lb) >= 0));
		if (missingKpi.length > 0) fail("the KPI strip is missing " + JSON.stringify(missingKpi) + " (rendered: " + JSON.stringify(texts) + ")");
		// Token KPIs are conditional (only when the session reports any), so assert them by
		// their presence-in-this-fixture rather than requiring them in every session.
		if (!texts.some((t2) => /token|Token/.test(t2))) fail("the KPI strip shows no token figure although the fixture reports usage: " + JSON.stringify(texts));
		if (texts.some((t2) => t2 === "")) fail("a KPI cell rendered empty text: " + JSON.stringify(texts));
		// The model chip is part of the same promise ("current model name").
		const modelChip = document.querySelector(".dstv_modelChip");
		if (modelChip === null) fail("the header shows no model chip");
		else if ((modelChip.textContent || "").indexOf("deepseek-chat") < 0) fail("the model chip does not name the model: " + JSON.stringify(modelChip.textContent));

		// The clock-axis toggle: OFF by default, ON after a click, and the state must be
		// READABLE (data-on), because the only other signal is a colour shift.
		const clockBtn = [...document.querySelectorAll("button.dstv_btn")]
			.find((b) => (b.getAttribute("title") || "").indexOf("时钟") >= 0 || /⏱/.test(b.textContent || ""));
		if (clockBtn === undefined) fail("the ⏱ isometric/clock axis toggle is missing from the header");
		else {
			if (clockBtn.getAttribute("data-on") === "true") fail("the clock axis starts ON; README says isometric is the default");
			const before = clockBtn.textContent;
			clockBtn.click();
			await tick(200);
			if (clockBtn.getAttribute("data-on") !== "true") fail("clicking the clock toggle did not mark it active (data-on missing)");
			if (clockBtn.textContent === before) fail("the clock toggle label did not change when toggled: " + JSON.stringify(before));
			// Scale mode must change the painted gap band, not just the label.
			const band = document.querySelector(".dstv_gapBand");
			if (band !== null && !band.classList.contains("scaled")) fail("clock mode is on but the gap band is not marked scaled");
			clockBtn.click();
			await tick(200);
			if (clockBtn.getAttribute("data-on") === "true") fail("clicking the clock toggle twice did not turn it off");
			info.clock = { toggle: true, band: band !== null };
		}
		info.kpi = texts.length;
	}

	// 15) the ONE thing this plugin writes to storage (README §10 promises exactly
	// this and nothing more). Nothing used to check it at all — the README said
	// "nothing is written to storage", which was simply false, and no test could have
	// caught the lie in either direction (§13.59). Assert the shape the doc now states:
	// one sessionStorage key per conversation, { revealed, query }, tab-scoped, and
	// deleted rather than blanked when empty.
	{
		const keys = () => {
			const out = [];
			for (let i = 0; i < window.sessionStorage.length; i += 1) {
				const k = window.sessionStorage.key(i);
				if (k !== null && k.indexOf("dstv:view:1:") === 0) out.push(k);
			}
			return out;
		};
		// README §10 says ONE key PER CONVERSATION — not one key total. The earlier group
		// deliberately remounts the panel under `session-2` to prove state does not leak
		// across conversations, so two keys is the CORRECT outcome here; asserting "at
		// most one" was my own misreading of the promise (measured: it went red the moment
		// a new group touched the panel).
		const ks = keys();
		if (ks.length > 2) fail("more than two view-state keys were written for two conversations: " + JSON.stringify(ks));
		if (new Set(ks).size !== ks.length) fail("duplicate view-state keys: " + JSON.stringify(ks));
		for (const k of ks) if (!/^dstv:view:1:.+$/.test(k)) fail("a view-state key does not follow the documented prefix+session shape: " + k);
		if (keys().length > 0) {
			const raw = window.sessionStorage.getItem(ks[0]);
			let parsed = null;
			try { parsed = JSON.parse(raw); } catch { parsed = null; }
			if (parsed === null || typeof parsed !== "object") fail("the view-state entry is not a JSON object: " + String(raw).slice(0, 60));
			else {
				const extra = Object.keys(parsed).filter((k) => k !== "revealed" && k !== "query");
				if (extra.length > 0) fail("the view-state entry carries fields the README does not disclose: " + extra.join(", "));
				if (!(parsed.revealed === null || Number.isSafeInteger(parsed.revealed))) fail("revealed is neither null nor an integer: " + JSON.stringify(parsed.revealed));
				if (typeof parsed.query !== "string") fail("query is not a string: " + JSON.stringify(parsed.query));
				else if (parsed.query.length > 200) fail("query exceeds the documented 200-char cap: " + parsed.query.length);
			}
			info.storage = ks[0] + " (" + String(window.sessionStorage.getItem(ks[0])).length + " bytes)";
		} else {
			info.storage = "none";
		}
		// localStorage must stay untouched — that half of the claim is absolute.
		if (window.localStorage.length > 0) fail("localStorage was written (" + window.localStorage.length + " key(s)); the README says it never is");
		// NOT checking cookies at runtime, on purpose. This harness runs from a `file://`
		// URL, and there `document.cookie = "x"` is silently a no-op: measured, writing a
		// cookie here leaves `document.cookie === ""`. An assertion "no cookie was set"
		// would therefore pass no matter what the code did — a permanent false green, the
		// §13.52 shape again. The claim is checked statically in the smoke test instead
		// (no `document.cookie =` anywhere in src/), which is where it can actually fail.
	}

	// 15e) the anchor field — README §2's headline Plus feature ("粘进工具栏的 🔗 输入框
	// 回车即可精确定位；地址栏会同步成 #tvp1:e3019"). Three separate promises, none of
	// them ever exercised in a browser: the jump, the address-bar sync, and the refusal
	// to fake success (§13.66).
	{
		const aIn = document.querySelector("input.dstv_anchorInput");
		if (aIn === null) fail("the 🔗 anchor field is missing from the toolbar");
		else {
			const setA = (v) => {
				const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(aIn), "value").set;
				setter.call(aIn, v);
				aIn.dispatchEvent(new Event("input", { bubbles: true }));
			};
			const enterA = async (ms) => {
				aIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
				await tick(ms === void 0 ? 600 : ms);
			};
			// The anchor note is a warn chip, but so are the drift/malformed chips. Match on
			// the anchor-specific phrasing rather than "the first warn chip" — picking the
			// first one read the fixture's drift chip and reported a phantom failure.
			const anchorNote = () => {
				const re = /锚点格式无法识别|正在向前加载|未持久化|不在当前窗口|已向前翻页|已落定/;
				const c = [...document.querySelectorAll(".dstv_chip.warn")]
					.map((e) => (e.textContent || "").trim())
					.filter((x) => re.test(x));
				return c.length === 0 ? "" : c[c.length - 1];
			};

			// A previous group left a station selected and the clock button focused, so
			// pressing End from there does nothing: focus the panel first, then deselect.
			root.focus();
			await press("End");
			if (selected().length !== 0) fail("could not reach the overview before the anchor checks: " + JSON.stringify(selected()));

			// (1) A garbage anchor must be REFUSED — no move, and an explanation. README:
			//     "不会伪装成…" for the absent case; "不会假装成功" is the same rule.
			setA("not-an-anchor");
			await enterA();
			if (selected().length !== 0) fail("a malformed anchor moved the view to " + JSON.stringify(selected()));
			if (anchorNote().indexOf("无法识别") < 0) fail("a malformed anchor produced no explanation (note " + JSON.stringify(anchorNote()) + ")");

			// (2) Round-trip: take a station's OWN copied anchor, deselect, paste it back.
			//     Asserting a hardcoded "tvp1:e2 lands on position 2" would encode the
			//     fixture's layout; a round trip asserts the property that matters — the
			//     anchor you were given brings you back to the station you took it from.
			const stepIdx = opts().findIndex((o) => /步骤 2|step 2/.test(o.getAttribute("aria-label") || ""));
			if (stepIdx < 0) fail("the fixture has no turn-1 step-2 station for the anchor round-trip");
			else {
				opts()[stepIdx].click();
				await tick(250);
				const copyBtn = [...document.querySelectorAll("button")]
					.find((b) => /复制锚点/.test((b.getAttribute("aria-label") || "") + (b.textContent || "")));
				if (copyBtn === undefined) fail("no copy-anchor button on the round-trip station");
				else {
					const before = wrote.length;
					copyBtn.click();
					await tick(250);
					if (wrote.length === before) fail("copy-anchor wrote nothing during the round-trip");
					else {
						const anchor = wrote[wrote.length - 1];
						root.focus();
						await press("End");
						await tick(150);
						if (selected().length !== 0) fail("could not deselect before pasting the anchor back");
						setA(anchor);
						await enterA();
						const back = selected();
						if (back.length !== 1) fail("pasting " + anchor + " back selected " + JSON.stringify(back) + " instead of one station");
						else if (back[0] !== stepIdx) fail("pasting " + anchor + " back landed on station " + back[0] + " instead of " + stepIdx);
						// The address bar must mirror it: that is what makes the link shareable.
						if (location.hash !== "#" + anchor) fail("the address bar was not synced to " + anchor + ": " + JSON.stringify(location.hash));
						info.anchor = { roundTrip: anchor + " -> " + back.join(), hash: location.hash };
					}
				}
			}

			// (3) An anchor that is not in this session must SAY so, not silently do nothing
			//     and not page forever. Turn hasMore off so the paging loop exits at once.
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: false }));
			await tick(200);
			root.focus();
			await press("End");
			setA("tvp1:e999999");
			await enterA(1500);
			const gone = anchorNote();
			if (gone.indexOf("不在当前窗口") < 0 && gone.indexOf("未持久化") < 0 && gone.indexOf("已向前翻页") < 0) fail("an anchor outside the loaded window produced no honest note (note " + JSON.stringify(gone) + ")");
			if (selected().length !== 0) fail("an anchor outside the loaded window still selected " + JSON.stringify(selected()));
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true }));
			await tick(200);

			// (4) Escape clears the field and its note.
			setA("tvp1:e2");
			await tick(100);
			aIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
			await tick(200);
			if (aIn.value !== "") fail("Esc did not clear the anchor field: " + JSON.stringify(aIn.value));
			if (anchorNote() !== "") fail("Esc left the anchor note behind: " + JSON.stringify(anchorNote()));
			root.focus();
			await press("End");
		}
	}

	// 15d) the minimap is a SECOND navigation affordance for the same stations
	// (README §2: "顶部 minimap：每个站点一个色块…点击色块即跳转，回放时高亮当前站点").
	// Clicking a tick was never tested — only that ticks exist. A minimap that renders
	// but does not seek is decoration, and the station list would be the only way in (§13.65).
	{
		const ticks = [...document.querySelectorAll("button.dstv_miniTick")];
		if (ticks.length !== opts().length) fail("the minimap has " + ticks.length + " ticks for " + opts().length + " stations — they must be 1:1");
		if (ticks.length === 0) fail("the minimap rendered no ticks");
		else {
			// Colour coding is the minimap's whole value: every tick must declare a kind.
			const kindless = ticks.filter((t) => (t.getAttribute("data-k") || "") === "");
			if (kindless.length > 0) fail(kindless.length + " minimap tick(s) carry no data-k colour key");
			// Click a tick in the middle and require the station list to follow.
			const target = Math.min(7, ticks.length - 1);
			ticks[target].click();
			await tick(300);
			const sel = selected();
			if (sel.length !== 1 || sel[0] !== target) fail("clicking minimap tick " + target + " selected " + JSON.stringify(sel) + " — the two affordances disagree");
			// …and the active tick must be the one that is selected.
			const active = [...document.querySelectorAll("button.dstv_miniTick")]
				.filter((t) => t.getAttribute("data-active") === "true")
				.map((t) => Number(t.getAttribute("data-tick-idx")));
			if (active.length !== 1 || active[0] !== target) fail("the minimap highlight is on " + JSON.stringify(active) + " but the selection is " + JSON.stringify(sel));
			info.minimap = { ticks: ticks.length, seek: target };
		}
		// Return to the overview so later groups start from the documented state. Focus
		// the PANEL first: after clicking a tick, activeElement is that tick button, whose
		// own roving-focus handler consumes End and never reaches the panel handler.
		root.focus();
		await press("End");
		if (selected().length !== 0) fail("could not return to the overview after the minimap checks");
	}

	// 16) README §12 makes three promises about degraded data and NOTHING verified them
	// in a real browser — the unit tests cover the classifier, never the painted result:
	//   "malformed data must not crash the page, it degrades and warns"
	//   "an incompatible version must say so loudly, never fake an empty state"
	//   "a kind:'unknown' node is a first-class station, not evidence of drift"
	// Driving the store directly is the honest way to test these: they are states the
	// host produces, not something a user can click into (§13.60).
	{
		const saved = window.__store.value;
		const setSnap = async (snap) => { window.__store.set(snap); await tick(400); };
		const txt = (sel) => {
			const el = document.querySelector(sel);
			return el === null ? null : (el.textContent || "").slice(0, 120);
		};

		// (a) a genuinely empty session → the empty state, with the legend, no crash.
		await setSnap({ eventNodes: [], requests: [], callSchemas: {}, runningCalls: [], partial: null });
		const emptyTxt = txt(".dstv_empty");
		if (emptyTxt === null) fail("an empty snapshot rendered no .dstv_empty block");
		else if (emptyTxt.indexOf("暂无轨迹数据") < 0) fail("the empty state does not explain itself: " + JSON.stringify(emptyTxt.slice(0, 40)));
		if (document.querySelector(".dstv_incompat") !== null) fail("an empty-but-valid session was reported as INCOMPATIBLE — empty is not drift");
		if (document.querySelector(".dstv_emptyLegend") === null) fail("the empty state dropped the colour legend");

		// (b) every kind unfamiliar, contract still valid → must escalate loudly with codes.
		await setSnap({ eventNodes: [{ kind: "message.user", seq: 1, time: 1 }, { kind: "zzz.renamed", seq: 2, time: 2 }], requests: [], callSchemas: {}, runningCalls: [], partial: null });
		const incTxt = txt(".dstv_incompat");
		if (incTxt === null) fail("a snapshot with zero recognizable kinds showed the EMPTY state instead of an incompatibility notice — that is the 'fake empty' README §12 forbids");
		else {
			if (incTxt.indexOf("无法识别") < 0) fail("the incompatibility notice does not say what happened: " + JSON.stringify(incTxt.slice(0, 40)));
			const codes = txt(".dstv_incompatCodes");
			if (codes === null || codes.indexOf("unrecognized-kinds") < 0) fail("the notice lists no reason codes: " + JSON.stringify(codes));
		}

		// (c) the documented fallback kind is NOT drift: one `unknown` node next to a real
		//     station must render as stations, with no incompatibility banner. This is the
		//     regression R4 in the smoke suite records (one exotic event once blanked the
		//     whole panel) — here we check the painted outcome, not the classifier.
		await setSnap({ eventNodes: [
			{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "hi" }] },
			{ kind: "unknown", seq: 2, time: 2, type: "exotic", data: {} },
		], requests: [], callSchemas: {}, runningCalls: [], partial: null });
		if (document.querySelector(".dstv_incompat") !== null) fail("a documented kind:'unknown' node still triggers the incompatibility banner");
		if (document.querySelectorAll(".dstv_station").length === 0) fail("a session with one unknown node rendered no stations at all");
		// The banner is the loud half; the header CHIP is the quiet half, and it is the one
		// that actually fired in the R4 regression (the node was counted as drift, so the
		// header said "1 条记录无法识别" while the view rendered fine). Asserting only on
		// the banner missed it: measured, removing "unknown" from KNOWN_NODE_KINDS kept
		// this whole group green.
		const driftChip = [...document.querySelectorAll(".dstv_chip.warn")]
			.map((e) => (e.textContent || "").trim())
			.find((c) => c.indexOf("无法识别") >= 0);
		if (driftChip !== undefined) fail("the documented kind:'unknown' node was counted as drift: header says " + JSON.stringify(driftChip));

		// (d) PARTLY damaged — and there are TWO different header chips for this, which a
		//     first version of this probe conflated. Both render the SAME visible text
		//     ("N 条记录结构异常") from two different locale keys, so matching on text alone
		//     proved neither of them: removing the contract chip entirely left this green
		//     because the invalid-records chip happened to be showing. Trigger each one on
		//     its own condition and read the chip's title, which names the locale key.
		//
		//   hMalformed ← snapshotContract().ok === false   (valid kind+seq, bad `content`)
		//   hInvalid   ← nodeStats.invalid > 0             (missing/empty kind, bad seq)
		const chipInfo = () => [...document.querySelectorAll(".dstv_chip.warn")]
			.map((e) => ({ text: (e.textContent || "").trim(), title: e.getAttribute("title") || "" }));

		await setSnap({ eventNodes: [
			{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "hi" }] },
			{ kind: "assistant", seq: 2, time: 2, turn: 1, step: 1, messageId: "m1", blocks: [], content: "not-an-array" },
		], requests: [], callSchemas: {}, runningCalls: [], partial: null });
		const c1 = chipInfo();
		if (!c1.some((c) => c.title.indexOf("字段形状不符合预期") >= 0)) fail("a bad \`content\` shape produced no contract-level ⚠ chip (chips: " + JSON.stringify(c1) + ")");
		if (document.querySelectorAll(".dstv_station").length === 0) fail("the healthy record next to a bad-content record was not rendered");
		if (window.__errors.length > 0) fail("a malformed snapshot threw in the browser: " + String(window.__errors[0]));

		await setSnap({ eventNodes: [
			{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "hi" }] },
			{ kind: "", seq: 2, time: 2 },
			{ seq: 3, time: 3 },
		], requests: [], callSchemas: {}, runningCalls: [], partial: null });
		const c2 = chipInfo();
		if (!c2.some((c) => c.title.indexOf("缺少 kind 或 seq") >= 0)) fail("records with a missing kind/seq produced no invalid-records ⚠ chip (chips: " + JSON.stringify(c2) + ")");

		// (e) and the healthy state must come back — a degradation that never recovers is
		//     indistinguishable from a crash for the reader.
		await setSnap(saved);
		if (document.querySelectorAll(".dstv_station").length === 0) fail("the healthy snapshot did not come back after the degraded cases");
		if (document.querySelector(".dstv_incompat") !== null || document.querySelector(".dstv_warn") !== null) fail("a warning banner survived the return to healthy data");
		info.degraded = { empty: true, incompatible: true, unknownKind: "ok", malformed: true, recovered: true };
	}

	return JSON.stringify({ failures, info });
})()
