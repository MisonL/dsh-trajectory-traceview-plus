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
		// The panel has been searched and navigated by now, so at most one key may exist.
		const ks = keys();
		if (ks.length > 1) fail("more than one view-state key was written: " + JSON.stringify(ks));
		if (ks.length === 1) {
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
