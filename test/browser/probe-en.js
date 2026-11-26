/**
 * The English pass, run as a SECOND eval.
 *
 * `agent-browser eval` gives up after 30 s ("Resource temporarily unavailable"), and the
 * main probe already sat at ~28 s — adding a language switch plus two remounts pushed it
 * over the cap, which failed as an unparsable result rather than as a red assertion.
 * Splitting keeps both halves comfortably inside the limit and leaves the main probe room
 * to grow (§13.69).
 *
 * Scope note: it scans CHROME only. Station labels mix in the session's own text (the
 * fixture's Chinese user message), which is data, not a translation defect.
 */
(async () => {
	const tick = (ms) => new Promise((r) => setTimeout(r, ms === void 0 ? 60 : ms));
	const failures = [];
	const fail = (m) => failures.push(m);
	const info = {};

	if (typeof window.__setLocale !== "function") {
		fail("the harness cannot switch locale");
		return JSON.stringify({ failures, info });
	}
	// Poll for the condition rather than sleeping a guessed duration.
	const waitFor = async (fn, budgetMs) => {
		const until = Date.now() + (budgetMs === void 0 ? 2000 : budgetMs);
		while (Date.now() < until) {
			if (fn()) return true;
			await tick(50);
		}
		return fn();
	};

	window.__setLocale("en");
	const switched = await waitFor(() => /Turn|Step|Station/.test((document.querySelector(".dstv_root") || {}).textContent || ""));
	if (!switched) fail("switching to en did not translate the panel chrome at all");

	const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
	const leaks = [];
	const look = (el, where) => {
		const check = (v, kind) => {
			if (typeof v === "string" && v !== "" && cjk.test(v)) leaks.push(where + " " + kind + ": " + v.slice(0, 40));
		};
		check((el.textContent || "").trim(), "text");
		check(el.getAttribute("aria-label"), "aria");
		check(el.getAttribute("title"), "title");
	};
	for (const el of document.querySelectorAll(".dstv_root button:not([role=option]), .dstv_root summary")) look(el, "control");
	for (const el of document.querySelectorAll(".dstv_root .dstv_kpi, .dstv_root .dstv_tab, .dstv_root .dstv_dLabel, .dstv_root .dstv_tag")) look(el, "label");
	// The panel ROOT is checked for its accessible name only. Its textContent is the whole
	// subtree — station cards and the detail panel — which is mostly session DATA (the
	// fixture's own Chinese message), not translation. Scanning it reported a leak that was
	// simply the fixture talking.
	const rootEl = document.querySelector(".dstv_root");
	if (rootEl !== null) {
		const rootName = rootEl.getAttribute("aria-label") || "";
		if (rootName !== "" && cjk.test(rootName)) leaks.push("panel aria: " + rootName.slice(0, 40));
	}
	const aIn = document.querySelector("input.dstv_anchorInput");
	if (aIn !== null) {
		const ph = aIn.getAttribute("placeholder") || "";
		if (cjk.test(ph)) leaks.push("anchor placeholder: " + ph.slice(0, 30));
	}
	// The DETAIL panel is where most of the words live, and it only renders once a station
	// is selected — so the first pass above covered the header and missed everything below.
	// A mutation that hardcoded Chinese into a usage chip stayed green until this was added.
	const stepEl = [...document.querySelectorAll(".dstv_root [role=option]")]
		.find((o) => /Step|步骤/.test(o.getAttribute("aria-label") || ""));
	if (stepEl === undefined) fail("no step station to open the English detail panel on");
	else {
		stepEl.click();
		await tick(400);
		const tab = [...document.querySelectorAll("button.dstv_tab")]
			.find((x) => /Raw request|原始请求/.test(x.textContent || ""));
		if (tab === undefined) fail("no request tab on the English detail panel");
		else {
			tab.click();
			await tick(400);
			// Chrome inside the detail body: labels, section headers, chips — not the code
			// blocks and not the message text (both are session data).
			for (const el of document.querySelectorAll(".dstv_detail .dstv_dLabel, .dstv_detail .dstv_dSecHead, .dstv_detail .dstv_cfgChip, .dstv_detail .dstv_chip")) look(el, "detail");
			const evRow = document.querySelector(".dstv_evRow");
			if (evRow !== null) look(evRow, "evidence");
			const diffBox = document.querySelector(".dstv_diffBox");
			if (diffBox !== null) {
				for (const el of diffBox.querySelectorAll(".dstv_dLabel, .dstv_diffChip, summary")) look(el, "diff");
			}
		}
	}

	if (leaks.length > 0) fail("the English UI still shows Chinese in " + leaks.length + " place(s): " + JSON.stringify(leaks.slice(0, 4)));
	if (rootEl !== null && (rootEl.getAttribute("aria-label") || "").trim() === "") fail("the panel lost its accessible name after switching language");
	info.englishLeaks = leaks.length;

	window.__setLocale("zh");
	await waitFor(() => /轮次|步骤/.test((document.querySelector(".dstv_root") || {}).textContent || ""));
	if (!/轮次|步骤/.test((document.querySelector(".dstv_root") || {}).textContent || "")) fail("switching back to zh did not restore the Chinese chrome");
	info.localeSwitch = "ok";

	// 22b) THE SAME SWITCH WITHOUT A REMOUNT — the shape a real host has. `__setLocale` above
	// remounts (the fixture hands the component one stable `t`, so it has to), which starts the
	// element caches empty and proves nothing about an in-place switch.
	//
	// What this asserts, and what it does NOT: it proves the user-visible outcome — after `t`
	// changes identity on a live instance, no card keeps the old language's chrome. It does
	// NOT isolate the `cacheScopeRef` clear in the view: disabling that clear still passes,
	// because the element signature already hashes translated station fields (`label`, `meta`)
	// and the fold is memoised on `t`, so a new `t` produces new signatures anyway. The clear
	// stays as defence in depth (a future field could stop being translated at fold time), and
	// §13.78 records that the mutation does not reach it.
	{
		window.__setLocaleInPlace("en");
		await waitFor(() => /Turn|Step|Station/.test((document.querySelector(".dstv_root") || {}).textContent || ""));
		const text = (document.querySelector(".dstv_root") || {}).textContent || "";
		if (!/Step|Station|Turn/.test(text)) fail("an in-place locale switch did not translate the panel at all");
		// Only the CHROME may be checked: the fixture's conversation text is Chinese on
		// purpose and must survive the switch. Station labels are the stale parts (they come
		// from cached elements, and their position/kind/turn segments are translated), so check
		// the label for the Chinese terms those segments use — none of which appear in the
		// fixture's DATA.
		// Terms used by the LABEL only, and none of them occur in the fixture's DATA (the
		// compaction station's text says 「压缩成摘要」, so 「压缩」 would be a false positive).
		const chromeTerms = /步骤|轮次|用户|未知事件/;
		const labelLeaks = [...document.querySelectorAll("[role=option]")]
			.map((o) => o.getAttribute("aria-label") || "")
			.filter((l) => chromeTerms.test(l));
		if (labelLeaks.length > 0) fail("after an in-place switch to en, " + labelLeaks.length + " station labels kept the previous language's chrome: " + JSON.stringify(labelLeaks.slice(0, 2).map((l) => l.slice(0, 50))));
		// And the detail panel, which is NOT cached and therefore the control case.
		const panelText = (document.querySelector(".dstv_detail") || {}).textContent || "";
		if (chromeTerms.test(panelText)) fail("the (uncached) detail panel kept Chinese chrome after an in-place switch: " + JSON.stringify(panelText.slice(0, 80)));
		info.localeSwitchInPlace = "ok";
		window.__setLocaleInPlace("zh");
		await tick(120);
	}

	return JSON.stringify({ failures, info });
})()
