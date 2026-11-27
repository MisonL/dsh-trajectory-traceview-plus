/* Second half of the browser assertions (see probe.js for the header comment).

   SPLIT because `agent-browser eval` aborts at 30 s. Measured: the single file reached
   27.4 s once the live-path group was added, and a probe that dies at the cap reports an
   UNPARSABLE RESULT rather than a red assertion — strictly worse than a failure. Both
   halves share one page (browser-check opens it once and evals sequentially), so the
   second half continues from whatever state the first left (§13.70).

   Order matters: this file assumes probe.js already ran. */
(async function () {
	const tick = (ms) => new Promise((r) => setTimeout(r, ms === void 0 ? 120 : ms));
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
	const press = async (k) => {
		document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
		await tick();
	};
	// The clipboard stub from the first half captured into a closure this script cannot
	// reach (each eval is its own scope). Install a fresh one here — the anchor round-trip
	// below needs to read back what the copy button wrote.
	const wrote = [];
	try {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (t) => { wrote.push(t); } }
		});
	} catch { /* the first half already installed a working stub */ }
	// A FUNCTION, not a captured node. Group 8b remounts the panel, which REPLACES the
	// `.dstv_root` element — every later `root.focus()` then acted on a detached node, so
	// `press("End")` fired at nothing and the anchor/minimap groups reported the view
	// "would not return to the overview". Measured before the fix: four failures that all
	// looked like keyboard bugs and none of which were.
	const rootEl = () => document.querySelector(".dstv_root");
	const themeNow = () => {
		const d = document.documentElement;
		return d.getAttribute("data-theme") || (d.classList.contains("dark") ? "dark" : "light");
	};

	// 8b) a host remount must not throw the reader back to "overview, empty search".
	// The host unmounts this panel on every tab switch (measured root count 0 → 1), so
	// without persisted state the reader loses their place every single time.
	if (typeof window.__remount === "function") {
		const stepForResume = opts().findIndex((o) => (o.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
		if (stepForResume < 0) fail("no step station to test resume with");
		else {
			opts()[stepForResume].click();
			await tick(120);
			const searchEl = document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)");
			const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(searchEl), "value").set;
			setter.call(searchEl, "报错");
			searchEl.dispatchEvent(new Event("input", { bubbles: true }));
			await tick(120);
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
	const root = rootEl();
	const viewArea = root.parentElement;
	const rootCS = getComputedStyle(root);
	const boxH = Math.round(root.getBoundingClientRect().height);
	const contentH = root.scrollHeight;
	info.clamp = { boxH, contentH, overflowY: rootCS.overflowY };
	if (contentH > boxH + 1) {
		if (rootCS.overflowY === "visible") fail("the view is taller than its box but overflow-y is visible: the host clips the bottom " + (contentH - boxH) + "px");
		const before = root.scrollTop;
		root.scrollTop = 1e6;
		await tick(120);
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
		await tick(120);
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
					// `/(1)/` was written `/\(1\)|（1）|1/` — the trailing bare `1` is satisfied by
					// "…（1）" AND by any stray digit, so the assertion could never isolate the
					// count. Require the number to be parenthesised, and to match the number of
					// child cards the section actually renders.
					const countText = summary.textContent || "";
					const stated = /\((\d+)\)|（(\d+)）/.exec(countText);
					if (stated === null) fail("the sub-call summary does not state how many calls there are: " + JSON.stringify(countText));
					else {
						const statedCount = Number(stated[1] ?? stated[2]);
						const renderedChildren = (summary.parentElement || document).querySelectorAll(".dstv_subCard").length;
						if (statedCount !== renderedChildren) {
							fail("the sub-call summary claims " + statedCount + " call(s) but " + renderedChildren + " sub-card(s) rendered: " + JSON.stringify(countText));
						}
					}
					// Expand and verify the child card names the child tool, not the parent.
					const det = summary.parentElement;
					if (det !== null) det.open = true;
					await tick(120);
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
		const missingKpi = ["轮次", "步骤", "工具", "出错步骤", "工具总耗时"].filter((lb) => !texts.some((t2) => t2.indexOf(lb) >= 0));
		if (missingKpi.length > 0) fail("the KPI strip is missing " + JSON.stringify(missingKpi) + " (rendered: " + JSON.stringify(texts) + ")");
		// The label says what it counts: STEPS containing an error, not error events. The
		// fixture has 2 error stations, so the number must be 2 — asserting only that the
		// label exists would pass with the value stuck at 0.
		{
			const errKpi = kpis.find((k) => (k.textContent || "").indexOf("出错步骤") >= 0);
			const shown = errKpi === void 0 ? null : Number((errKpi.textContent || "").replace(/[^0-9]/g, ""));
			// The KPI counts stations that contain an error; the fixture renders at least one
			// of them as an error CARD. Assert the number is live (a stuck counter is the
			// failure this replaces), not an exact equality: error-kind stations and
			// error-containing steps are both counted, and only the latter carry the card class.
			// Count the stations whose accessible name says 出错 — the same surface the reader
			// sees — and require the chip to agree. Asserting only that the LABEL exists let a
			// stuck counter (always 0) pass, which is the failure mode worth guarding.
			const errorStations = [...document.querySelectorAll("[role=option]")]
				.filter((o) => /出错/.test(o.getAttribute("aria-label") || "")).length;
			if (shown === null) fail("the errors KPI chip is missing");
			else if (shown !== errorStations) {
				fail("the errors KPI says " + shown + " but " + errorStations + " station(s) are labelled 出错");
			}
		}
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
			await tick(120);
			if (clockBtn.getAttribute("data-on") !== "true") fail("clicking the clock toggle did not mark it active (data-on missing)");
			if (clockBtn.textContent === before) fail("the clock toggle label did not change when toggled: " + JSON.stringify(before));
			// Scale mode must change the painted gap band, not just the label.
			const band = document.querySelector(".dstv_gapBand");
			if (band !== null && !band.classList.contains("scaled")) fail("clock mode is on but the gap band is not marked scaled");
			clockBtn.click();
			await tick(120);
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
		// LOWER BOUND: the shape checks below all sit behind `if (keys().length > 0)`, so a
		// persistence layer that silently stopped writing would pass the entire block and
		// report info.storage = "none". Drive it explicitly: select a station, require a key
		// to appear, then clear and require it to be deleted rather than blanked.
		{
			const beforeSelect = keys().slice().sort().join("|");
			const target = [...document.querySelectorAll("[role=option]")][1];
			if (target === void 0) fail("no station to select for the storage write check");
			else {
				target.click();
				await tick(350);
				if (keys().length === 0) fail("selecting a station wrote no view-state key at all (persistence is silently dead)");
				const rootEl = document.querySelector(".dstv_root");
				if (rootEl !== null) rootEl.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
				await tick(350);
				if (keys().slice().sort().join("|") !== beforeSelect && keys().length > 2) {
					fail("clearing the selection did not delete its key: " + JSON.stringify(keys()));
				}
			}
		}

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

	// 15f) ⚡ 提示词变更 (README §2, "原始请求" tab): the diff between this request's
	// prompt and the previous one. `promptDiffOf` / `promptTextDiff` are well covered by
	// unit tests, but the fixture had no `promptChange` at all, so `.dstv_diffBox` could
	// never render — the whole block was unreachable in the browser (§13.67).
	{
		const openReqTab = async (label) => {
			const st = [...document.querySelectorAll(".dstv_station")].find((o) => new RegExp(label).test(o.getAttribute("aria-label") || ""));
			if (st === undefined) return false;
			st.click();
			await tick(250);
			const tab = [...document.querySelectorAll("button.dstv_tab")].find((x) => (x.textContent || "").indexOf("原始请求") >= 0);
			if (tab === undefined) return false;
			tab.click();
			await tick(300);
			return true;
		};

		// (a) turn-1 step-2 gained one tool and one prompt line.
		if (!await openReqTab("步骤 2")) fail("no turn-1 step-2 station for the prompt-diff check");
		else {
			const box = document.querySelector(".dstv_diffBox");
			if (box === null) fail("a request carrying promptChange rendered no ⚡ diff box");
			else {
				const text = box.textContent || "";
				if (text.indexOf("read") < 0) fail("the diff does not show the added tool: " + JSON.stringify(text.slice(0, 80)));
				const added = box.querySelector(".dstv_diffChip.add");
				if (added === null) fail("the added tool is not marked as an addition (+ chip)");
				// The system-prompt delta must state both sides, not just "changed".
				const delta = [...box.querySelectorAll(".dstv_diffChip.delta")].map((e) => (e.textContent || "").trim());
				if (delta.length === 0) fail("the diff shows no system-prompt size delta");
				else if (!/→/.test(delta[0])) fail("the delta does not show before AND after: " + JSON.stringify(delta[0]));
				// The changed LINES live behind a <details>.
				const det = box.querySelector(".dstv_diffText");
				if (det === null) fail("the diff has no expandable changed-lines section");
				else {
					det.open = true;
					await tick(120);
					const side = det.querySelector(".dstv_diffSide.add");
					if (side === null) fail("expanding the changed lines shows no added side");
					else if ((side.textContent || "").indexOf("新增一条") < 0) fail("the added side does not contain the new prompt line: " + JSON.stringify((side.textContent || "").slice(0, 60)));
					info.promptDiff = { added: true, lines: true };
				}
			}
		}

		// (b) turn-2 step-1 REMOVED both tools and two prompt lines — the mirror case. A
		//     diff that only ever shows additions is the classic half-implementation.
		if (!await openReqTab("轮次 2")) fail("no turn-2 station for the removal side of the diff");
		else {
			const box = document.querySelector(".dstv_diffBox");
			if (box === null) fail("the removal case rendered no diff box");
			else {
				if (box.querySelector(".dstv_diffChip.del") === null) fail("removed tools are not marked (- chip): " + JSON.stringify((box.textContent || "").slice(0, 80)));
				const det = box.querySelector(".dstv_diffText");
				if (det !== null) {
					det.open = true;
					await tick(120);
					const side = det.querySelector(".dstv_diffSide.del");
					if (side === null) fail("the removal case shows no removed-lines side");
					else if ((side.textContent || "").indexOf("请遵守规则") < 0) fail("the removed side does not contain the dropped line: " + JSON.stringify((side.textContent || "").slice(0, 60)));
				}
			}
		}
		// (c) the four sections the request tab is made of (README §2): 系统提示 / 工具目录 /
		//     消息列表 / Token 用量. Only the model-config header was ever looked at, so a
		//     section could vanish and the tab would still "work" (§13.68).
		//     Re-open a station whose request carries a real prompt (turn-1 step-1).
		if (!await openReqTab("步骤 1")) fail("no turn-1 step-1 station for the request-section check");
		else {
			const tabText = () => {
				const body = document.querySelector(".dstv_detail .dstv_dBody");
				return body === null ? "" : (body.textContent || "");
			};
			const sections = ["系统提示", "工具目录", "消息列表", "Token 用量"];
			const missing = sections.filter((lb) => tabText().indexOf(lb) < 0);
			if (missing.length > 0) fail("the request tab is missing section(s) " + JSON.stringify(missing) + " (README §2 promises all four)");

			// 工具目录 must list the tools this request actually carried — `pwsh` here.
			const catalog = [...document.querySelectorAll(".dstv_detail .dstv_dSection")]
				.find((e) => (e.textContent || "").indexOf("工具目录") >= 0);
			if (catalog === undefined) fail("no section carries the tool catalog");
			else if ((catalog.textContent || "").indexOf("pwsh") < 0) fail("the tool catalog does not list the request's own tool: " + JSON.stringify((catalog.textContent || "").slice(0, 60)));

			// 消息列表 is a RECONSTRUCTION and must say so (README §2 + §9 both warn about it).
			const msgs = [...document.querySelectorAll(".dstv_detail .dstv_dSection")]
				.find((e) => (e.textContent || "").indexOf("消息列表") >= 0);
			if (msgs === undefined) fail("no section carries the message list");
			// The label appears TWICE in this section from two different sources: the
			// evidence chip reads "近似重建" and the warning sentence reads "…按会话日志近似
			// 重建…". Matching /近似/ passed a mutation that deleted the sentence, because
			// the chip still satisfied it — the §13.60/§13.63 shape again. Assert the
			// SENTENCE (only it contains 按会话日志), so removing it is visible and the
			// short chip cannot stand in for it.
			else if (!/按会话日志/.test(msgs.textContent || "")) fail("the message list does not carry the full 'reconstructed from the session log' warning: " + JSON.stringify((msgs.textContent || "").slice(0, 80)));

			// Token 用量 must name both directions, IN THE UI'S OWN LANGUAGE. The chips used
			// to be hardcoded English ("in" / "out" / "cache-read") inside a Chinese panel
			// while README §2 called them 入站 / 出站 (§13.68). Assert the Chinese words in
			// the zh harness — matching /in|out/ would pass on the untranslated literals.
			if (!/入站/.test(tabText())) fail("the token section has no 入站 (inbound) chip: " + JSON.stringify(tabText().slice(0, 100)));
			if (!/出站/.test(tabText())) fail("the token section has no 出站 (outbound) chip");
			// The cache split is the part a prompt author actually checks.
			if (!/缓存读/.test(tabText())) fail("the token section does not split out cache reads");

			// 系统提示 must state its SIZE (README §2: "字符数 + 一键复制") — a prompt you
			// cannot size is a prompt you cannot budget.
			if (!/字符|chars/i.test(tabText())) fail("the system-prompt section states no character count");
			info.requestSections = sections.length;
		}

		// Back to the detail tab and the overview for the groups that follow.
		const backTab = [...document.querySelectorAll("button.dstv_tab")].find((x) => (x.textContent || "").indexOf("详情") >= 0);
		if (backTab !== undefined) { backTab.click(); await tick(120); }
		rootEl().focus();
		await press("End");
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
			rootEl().focus();
			await press("End");
			if (selected().length !== 0) fail("could not reach the overview before the anchor checks: " + JSON.stringify(selected()));

			// (1) A garbage anchor must be REFUSED — no move, and an explanation. README:
			//     "不会伪装成…" for the absent case; "不会假装成功" is the same rule.
			setA("not-an-anchor");
			await enterA();
			if (selected().length !== 0) fail("a malformed anchor moved the view to " + JSON.stringify(selected()));
			if (anchorNote().indexOf("无法识别") < 0) fail("a malformed anchor produced no explanation (note " + JSON.stringify(anchorNote()) + ")");
			// …and it must be ANNOUNCED, not just painted. Anchor paging can run for tens of
			// seconds with no other feedback, so there is a visually-hidden polite live
			// region for it. A region that exists but never fills is worse than none: it
			// looks like the affordance is covered (§13.71).
			{
				const lr = document.querySelector(".dstv_visuallyHidden[aria-live]");
				if (lr === null) fail("the panel has no aria-live region for anchor progress");
				else {
					if ((lr.getAttribute("aria-live") || "") !== "polite") fail("the anchor live region is not polite: " + JSON.stringify(lr.getAttribute("aria-live")));
					if ((lr.textContent || "").indexOf("无法识别") < 0) fail("the anchor note was painted but not announced (live region: " + JSON.stringify((lr.textContent || "").slice(0, 40)) + ")");
				}
			}

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
						rootEl().focus();
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
			await tick(120);
			rootEl().focus();
			await press("End");
			setA("tvp1:e999999");
			await enterA(1500);
			const gone = anchorNote();
			if (gone.indexOf("不在当前窗口") < 0 && gone.indexOf("未持久化") < 0 && gone.indexOf("已向前翻页") < 0) fail("an anchor outside the loaded window produced no honest note (note " + JSON.stringify(gone) + ")");
			if (selected().length !== 0) fail("an anchor outside the loaded window still selected " + JSON.stringify(selected()));
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true }));
			await tick(120);

			// (4) Escape clears the field and its note.
			setA("tvp1:e2");
			await tick(100);
			aIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
			await tick(120);
			if (aIn.value !== "") fail("Esc did not clear the anchor field: " + JSON.stringify(aIn.value));
			if (anchorNote() !== "") fail("Esc left the anchor note behind: " + JSON.stringify(anchorNote()));
			rootEl().focus();
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
		rootEl().focus();
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

	// 18) THE LIVE PATH. `snap.partial` is DSH's streaming snapshot — the state the panel
	// spends most of its life in while a model is generating. Every other group set
	// `partial: null`, and smoke covers the projection (124 references) but nothing ever
	// PAINTED it, so the live card, the live dot and the "replaced by the final record"
	// transition had zero browser coverage (§13.70).
	{
		// `setSnap` lives inside the degraded group's block, so it is out of scope here.
		const setSnap = async (snap) => { window.__store.set(snap); await tick(400); };
		const saved = { eventNodes: window.__store.value.eventNodes, requests: window.__store.value.requests, callSchemas: window.__store.value.callSchemas, runningCalls: window.__store.value.runningCalls, partial: null };
		await setSnap({ eventNodes: [
			{ kind: "user", seq: 1, time: 1, turn: 3, content: [{ type: "text", text: "继续" }] },
			{ kind: "assistant", seq: 2, time: 2, turn: 3, step: 1, messageId: "m1", blocks: [{ kind: "text", text: "已完成" }] }
		], requests: [], callSchemas: {}, runningCalls: [], partial: { turn: 3, step: 2, blocks: [{ kind: "text", text: "正在搜索…" }] } });
		await tick(400);
		const liveStations = [...document.querySelectorAll(".dstv_station")];
		if (liveStations.length < 2) fail("a streaming snapshot produced only " + liveStations.length + " station(s)");
		// The in-flight text must be on screen — that is the entire point of `partial`.
		const bodyText = (document.querySelector(".dstv_root") || {}).textContent || "";
		if (bodyText.indexOf("正在搜索") < 0) fail("the streaming partial's text is not rendered anywhere: " + JSON.stringify(bodyText.slice(0, 80)));
		// A live station must be marked as live, not just appear.
		const liveMarked = document.querySelectorAll("[data-live]").length;
		if (liveMarked === 0) fail("the streaming station carries no data-live marker");
		// Replay transport must know the trace is not finished: transport plays, it does not
		// claim a final length.
		const prog = document.querySelector(".dstv_progress, .dstv_playhead");
		if (prog === null) fail("the transport rendered no progress indicator while streaming");

		// The final record replaces the partial: the live marker must go away, and the
		// streaming text must NOT linger as a duplicate card.
		await setSnap({ eventNodes: [
			{ kind: "user", seq: 1, time: 1, turn: 3, content: [{ type: "text", text: "继续" }] },
			{ kind: "assistant", seq: 2, time: 2, turn: 3, step: 1, messageId: "m1", blocks: [{ kind: "text", text: "已完成" }] },
			{ kind: "assistant", seq: 3, time: 3, turn: 3, step: 2, messageId: "m2", blocks: [{ kind: "text", text: "结果在这里" }] }
		], requests: [], callSchemas: {}, runningCalls: [], partial: null });
		await tick(400);
		if (document.querySelectorAll("[data-live]").length > 0) fail("the live marker survived after the final record arrived");
		const settled = (document.querySelector(".dstv_root") || {}).textContent || "";
		if (settled.indexOf("正在搜索") >= 0) fail("the streaming preview lingered as a duplicate after the final record arrived");
		if (settled.indexOf("结果在这里") < 0) fail("the final record of the streamed step is not rendered");
		info.live = { painted: true, settledClean: true };

		await setSnap(saved);
		await tick(300);
		if (document.querySelectorAll(".dstv_station").length === 0) fail("the healthy snapshot did not come back after the live checks");
	}

	// 19) LOADING OLDER HISTORY. README §2 advertises 加载更早历史, and the probe only ever
	// checked that the BADGE turns into a button — never that paging actually prepends
	// anything, nor what happens to the reader's position when every index shifts. The
	// panel is index-keyed (aria-label "第 N / M", data-station-idx, anchor keys), so this
	// is exactly where a prepend goes wrong (§13.72).
	{
		// Everything below replaces the whole snapshot, so the healthy one has to come back
		// afterwards — the English pass that runs next opens a station and expects the real
		// fixture (it needs a request tab to exist).
		const healthy = JSON.parse(JSON.stringify({
			eventNodes: window.__store.value.eventNodes,
			requests: window.__store.value.requests,
			callSchemas: window.__store.value.callSchemas,
			runningCalls: window.__store.value.runningCalls
		}));
		const setSnap = async (nodes) => {
			window.__store.set({ eventNodes: nodes, requests: [], callSchemas: {}, runningCalls: [], partial: null });
			await tick(400);
		};
		const window_mk = (from, to) => {
			const nodes = [];
			for (let i = from; i < to; i += 1) {
				nodes.push({ kind: "user", seq: i * 2 + 1, time: 1000 + i * 1000, turn: i + 1, content: [{ type: "text", text: "q" + i }] });
				nodes.push({ kind: "assistant", seq: i * 2 + 2, time: 1200 + i * 1000, turn: i + 1, step: 1, messageId: "m" + i, blocks: [{ kind: "text", text: "a" + i }] });
			}
			return nodes;
		};
		const snapInfo = () => {
			const opts = [...document.querySelectorAll("[role=option]")];
			const sel = opts.findIndex((o) => o.getAttribute("aria-selected") === "true");
			return {
				n: opts.length,
				selIdx: sel,
				selLabel: sel >= 0 ? (opts[sel].getAttribute("aria-label") || "") : "",
				firstLabel: opts.length > 0 ? (opts[0].getAttribute("aria-label") || "") : "",
				idx: opts.map((o) => o.getAttribute("data-station-idx"))
			};
		};

		await setSnap(window_mk(100, 110));
		const before = snapInfo();
		if (before.n !== 20) fail("a 10-turn window produced " + before.n + " stations, expected 20");
		if (before.idx.join(",") !== before.idx.map((_, i) => String(i)).join(",")) fail("data-station-idx is not 0..N-1 in the first window: " + JSON.stringify(before.idx.slice(0, 5)));

		// Sit on the 6th station, then prepend ten older turns — the shape of a real
		// `loadOlder()` page.
		const optsNow = [...document.querySelectorAll("[role=option]")];
		if (optsNow.length > 5) optsNow[5].click();
		await tick(300);
		const picked = snapInfo();
		const pickedTurn = (picked.selLabel.match(/轮次 (\d+)/) || [])[1] || null;
		if (pickedTurn === null) fail("the selected station's aria-label carries no turn number: " + JSON.stringify(picked.selLabel));

		await setSnap(window_mk(90, 110));
		const after = snapInfo();
		if (after.n !== 40) fail("prepending 10 turns gave " + after.n + " stations, expected 40");
		// Every station was renumbered — the reader must still be on the SAME one.
		const afterTurn = (after.selLabel.match(/轮次 (\d+)/) || [])[1] || null;
		if (afterTurn !== pickedTurn) fail("prepending older history moved the reader: turn " + pickedTurn + " -> " + afterTurn + " (" + JSON.stringify(picked.selLabel) + " -> " + JSON.stringify(after.selLabel) + ")");
		if (after.selIdx === picked.selIdx) fail("the selection index did not shift at all after prepending 20 stations — the window did not really grow");
		// …and the visible numbering must be rebuilt, not the cached one.
		if (after.firstLabel.indexOf("/ 40") < 0) fail("the first station still advertises the old window size: " + JSON.stringify(after.firstLabel));
		if (after.selLabel.indexOf("/ 40") < 0) fail("the selected station still advertises the old window size: " + JSON.stringify(after.selLabel));
		if (after.idx.join(",") !== after.idx.map((_, i) => String(i)).join(",")) fail("data-station-idx is not 0..N-1 after prepending: " + JSON.stringify(after.idx.slice(0, 5)));

		info.prepend = { grew: before.n + " -> " + after.n, keptTurn: afterTurn };

		// Restore the REQUESTS too: the English pass opens a station and looks for the
		// 「原始请求」 tab, which does not exist when the window has no requests at all.
		window.__store.set(Object.assign({ partial: null }, healthy));
		await tick(400);
		if (document.querySelectorAll("[role=option]").length === 0) fail("the healthy window did not come back after the paging checks");
	}

	const healthySnap = JSON.parse(JSON.stringify({
		eventNodes: window.__store.value.eventNodes,
		requests: window.__store.value.requests,
		callSchemas: window.__store.value.callSchemas,
		runningCalls: window.__store.value.runningCalls
	}));

	// 20) CACHE vs LONG TEXT. The element cache decides "unchanged" from a signature, and a
	// real window carries ~1 MB of tool output. A signature that sampled only a prefix would
	// silently freeze a long body, so this changes ONE character deep inside a 20 000-char
	// body and requires the card to update (§13.73).
	{
		const big = (mark) => "x".repeat(10000) + mark + "x".repeat(10000);
		const snap = (mark) => ({
			eventNodes: [
				{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: big(mark) }] },
				{ kind: "assistant", seq: 2, time: 2, turn: 1, step: 1, messageId: "m1", blocks: [{ kind: "text", text: "ok" }] }
			],
			requests: [], callSchemas: {}, runningCalls: [], partial: null
		});
		window.__store.set(snap("SENTINEL-A"));
		await tick(400);
		const first = (document.querySelector(".dstv_root") || {}).textContent || "";
		if (first.indexOf("SENTINEL-A") < 0) fail("the 20k-char body was not rendered at all");
		window.__store.set(snap("SENTINEL-B"));
		await tick(400);
		const second = (document.querySelector(".dstv_root") || {}).textContent || "";
		if (second.indexOf("SENTINEL-B") < 0) fail("changing one character deep inside a long body did not update the card — the signature is not covering the whole string");
		if (second.indexOf("SENTINEL-A") >= 0) fail("the old long body is still on screen next to the new one");
		info.longText = "ok";

		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(300);
		if (document.querySelectorAll("[role=option]").length === 0) fail("the healthy window did not come back after the long-text check");
	}

	// 21) A BLOCK WITH NO `kind`. README §12 promises unknown data is NAMED, not guessed at.
	// The label used to be `${t("block.unknown")} · ${String(b.kind)}`, which renders the
	// literal word "undefined" when the kind is missing — found by feeding a real session
	// through the panel (315 of 695 station labels carried it). A future kind must still be
	// named; a MISSING kind must not be called "undefined" (§13.73).
	{
		window.__store.set({
			eventNodes: [
				{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "go" }] },
				{
					kind: "assistant", seq: 2, time: 2, turn: 1, step: 1, messageId: "m1",
					blocks: [
						{ kind: "text", text: "normal" },
						{ text: "no kind at all" },
						// `image` is already a KNOWN kind (it renders 「图片」), so the forward-compat
						// half needs a kind this build genuinely does not know.
						{ kind: "vector-embedding", data: "x" }
					]
				}
			],
			requests: [], callSchemas: {}, runningCalls: [], partial: null
		});
		await tick(400);
		const body = (document.querySelector(".dstv_root") || {}).textContent || "";
		const labels = [...document.querySelectorAll("[role=option]")].map((o) => o.getAttribute("aria-label") || "");
		if (body.indexOf("undefined") >= 0) fail("a block with no kind put the literal word \"undefined\" on screen");
		if (labels.some((l) => l.indexOf("undefined") >= 0)) fail("a block with no kind put \"undefined\" into a station's accessible name");
		if (body.indexOf("未知内容") < 0) fail("an unrecognised block rendered nothing at all — it must be named");
		// A FUTURE kind must still be named, or the placeholder above would be a regression
		// dressed as a fix.
		if (body.indexOf("vector-embedding") < 0) fail("a future block kind is no longer named (expected \"未知内容 · vector-embedding\")");
		info.unknownBlock = "ok";

		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(300);
	}

	// 22) THE CARD READS ITS CELLS. The element cache decides "unchanged" from a signature,
	// and the station card renders cell text, tool name/args/error and the duration bar — so
	// all of those are cache inputs. Hashing only the cell SHAPE left a settled step showing
	// its old text while the detail panel showed the new one (found by Codex review §13.75).
	// This changes cell text alone and requires BOTH the card and its aria-label to follow.
	{
		const mk = (text) => ({
			eventNodes: [
				{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "go" }] },
				{ kind: "assistant", seq: 2, time: 2, turn: 1, step: 1, messageId: "m1", blocks: [{ kind: "text", text }] }
			],
			requests: [], callSchemas: {}, runningCalls: [], partial: null
		});
		window.__store.set(mk("CELL-ALPHA"));
		await tick(400);
		if (((document.querySelector(".dstv_root") || {}).textContent || "").indexOf("CELL-ALPHA") < 0) fail("the cell text was not rendered at all");
		window.__store.set(mk("CELL-OMEGA"));
		await tick(400);
		const cards = [...document.querySelectorAll("[role=option]")];
		const stepCard = cards.find((c) => (c.getAttribute("aria-label") || "").indexOf("步骤") >= 0);
		if (stepCard === undefined) fail("no step card to check the cell update on");
		else {
			const text = stepCard.textContent || "";
			const label = stepCard.getAttribute("aria-label") || "";
			if (text.indexOf("CELL-OMEGA") < 0) fail("changing a cell's text did not update the station card (card still shows: " + JSON.stringify(text.slice(0, 60)) + ")");
			if (label.indexOf("CELL-OMEGA") < 0) fail("the station's accessible name still carries the old cell text: " + JSON.stringify(label.slice(0, 60)));
		}
		info.cellUpdate = "ok";

		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(300);
	}

	// 23) TWO CACHE INPUTS THAT ARE NOT ON THE STATION. Both were found by review, both are
	// invisible from the station object alone:
	//   a) the minimap tick's tab stop has an OVERVIEW half (`revealed === null && i === 0`),
	//      so hashing only the active half leaves tick 0 tabbable next to the selection;
	//   b) the duration bar divides by a GLOBAL maximum (`stats.maxToolMs`), so a card whose
	//      own fields are unchanged must still re-render when a DIFFERENT station gets slower.
	{
		const tickStops = () => [...document.querySelectorAll(".dstv_miniTick")]
			.map((t, i) => (t.tabIndex === 0 ? i : -1))
			.filter((i) => i >= 0);
		// Earlier groups leave a station selected; the overview tab stop only exists in the
		// overview state, so ask for it explicitly rather than depending on leftover state.
		const root = document.querySelector(".dstv_root");
		if (root !== null) root.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
		await tick(300);
		const overview = tickStops();
		if (overview.length !== 1 || overview[0] !== 0) fail("the overview minimap should expose exactly tick 0 as its tab stop, got " + JSON.stringify(overview));
		// (a2) `data-active` is a DIFFERENT value from the tab stop, and the two collide at
		// tick 0: the overview is tab=1/active=0, while selecting the first station is
		// tab=1/active=1. Hashing only the tab stop left the cached tick without
		// `data-active`, so the strip highlighted nothing while the cards did show the
		// selection. Assert the highlight, not just the tab stop.
		const activeTicks = () => [...document.querySelectorAll(".dstv_miniTick")]
			.map((t, i) => (t.getAttribute("data-active") === "true" ? i : -1))
			.filter((i) => i >= 0);
		if (activeTicks().length !== 0) fail("the overview must highlight no tick, got " + JSON.stringify(activeTicks()));
		document.querySelectorAll(".dstv_miniTick")[0]?.click();
		await tick(350);
		const activeAfterTickZero = activeTicks();
		if (activeAfterTickZero.length !== 1 || activeAfterTickZero[0] !== 0) {
			fail("clicking the first tick from the overview left the minimap highlight at " + JSON.stringify(activeAfterTickZero) + " (expected [0])");
		}
		if (root !== null) root.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
		await tick(300);

		const cards = [...document.querySelectorAll("[role=option]")];
		// `if (cards.length > 4)` turned a shrinking fixture into silence: with four or fewer
		// stations the selection/highlight check simply did not run, and the group still
		// reported PASS. Say so instead — the fixture is supposed to have fifteen.
		if (cards.length < 4) fail("the fixture lost stations for the minimap selection check (need >= 4, got " + cards.length + ")");
		else {
			cards[3].click();
			await tick(300);
			const afterSelect = tickStops();
			if (afterSelect.length !== 1) fail("the minimap exposes " + afterSelect.length + " tab stops after selecting a station: " + JSON.stringify(afterSelect));
			if (afterSelect[0] !== 3) fail("the minimap tab stop is on tick " + afterSelect[0] + " but the selection is 3");
			const activeAfterSelect = activeTicks();
			if (activeAfterSelect.length !== 1 || activeAfterSelect[0] !== 3) {
				fail("the minimap highlight is at " + JSON.stringify(activeAfterSelect) + " but the selection is 3");
			}
		}

		// (b) one card's own duration is unchanged; only the OTHER station gets slower.
		const mk = (dur1, dur2) => ({
			eventNodes: [
				{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "a" }] },
				{ kind: "assistant", seq: 2, time: 2, turn: 1, step: 1, messageId: "m1", blocks: [{ kind: "tool-call", callId: "c1", name: "bash", argsRaw: "{}" }] },
				{ kind: "tool-result", seq: 3, time: 2 + dur1, turn: 1, step: 1, callId: "c1", callTime: 2, name: "bash", content: [{ type: "text", text: "ok" }], isError: false },
				{ kind: "user", seq: 4, time: 100000, turn: 2, content: [{ type: "text", text: "b" }] },
				{ kind: "assistant", seq: 5, time: 100001, turn: 2, step: 1, messageId: "m2", blocks: [{ kind: "tool-call", callId: "c2", name: "bash", argsRaw: "{}" }] },
				{ kind: "tool-result", seq: 6, time: 100001 + dur2, turn: 2, step: 1, callId: "c2", callTime: 100001, name: "bash", content: [{ type: "text", text: "ok" }], isError: false }
			],
			requests: [], callSchemas: {}, runningCalls: [], partial: null
		});
		const bars = () => [...document.querySelectorAll(".dstv_durBar i")].map((e) => e.style.width);
		window.__store.set(mk(1000, 100));
		await tick(400);
		const before = bars();
		window.__store.set(mk(1000, 5000));
		await tick(400);
		const after = bars();
		if (before.length < 2 || after.length < 2) fail("the duration bars did not render: " + JSON.stringify(before));
		else if (before[0] !== "100%" || after[0] === "100%") fail("the first station's bar kept its old proportion (" + JSON.stringify(before) + " -> " + JSON.stringify(after) + ") after the OTHER station became the slowest — the global maximum is not a cache input");
		info.cacheInputs = { tickStops: overview.length, bars: before[0] + " -> " + after[0] };

		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(300);
	}

	// 24) nested sub-calls must reach the screen, not just the copy.
	// The detail panel rendered exactly one level of `subCalls`; everything deeper was
	// invisible while the single-step copy AND the whole-trace export printed the whole
	// chain — the screen showed strictly less than the file you could copy from it.
	{
		window.__store.set({
			eventNodes: [
				{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: "q" }] },
				{ kind: "assistant", seq: 2, time: 2, turn: 1, step: 1, messageId: "nm", blocks: [{ kind: "tool-call", callId: "n1", name: "task", argsRaw: "{}" }] },
				{ kind: "tool-result", seq: 3, time: 3, turn: 1, step: 1, callId: "n1", callTime: 2, name: "task",
					content: [{ type: "text", text: "PARENT" }],
					subCalls: [{ callId: "n2", name: "child", argsRaw: "{}", resultText: "CHILD", durationMs: 10,
						subCalls: [{ callId: "n3", name: "grandchild", argsRaw: "{}", resultText: "GRANDCHILD", durationMs: 5 }] }] }
			],
			requests: [], callSchemas: {}, runningCalls: {}, partial: null
		});
		await tick(500);
		const stepCard = [...document.querySelectorAll("[role=option]")].find((o) => /步骤/.test(o.getAttribute("aria-label") || ""));
		if (stepCard === void 0) fail("no step station to open for the nested sub-call check");
		else {
			stepCard.click();
			await tick(450);
			document.querySelectorAll(".dstv_detail details").forEach((d) => { d.open = true; });
			await tick(250);
			const txt = (document.querySelector(".dstv_detail") || {}).innerText || "";
			if (!txt.includes("grandchild")) fail("a sub-sub-call never reached the detail panel (depth-2 name missing)");
			const depths = [...document.querySelectorAll(".dstv_subCard")].map((e) => e.getAttribute("data-depth"));
			if (depths.filter((d) => d === null).length !== 1 || depths.filter((d) => d === "1").length !== 1) {
				fail("the nested sub-call cards are not at depths [0,1]: " + JSON.stringify(depths));
			}
			info.nested = { depths: depths };
		}
		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(300);
	}

	// 25) the content signature must not collide on REAL inputs.
	// FNV-1a is 32-bit; `mix` folds a number into 64 bits of state, and two ordinary
	// timestamps 24h apart landed on the same signature (1700000000000 vs 1704294967296).
	// The cached card kept 06:13:20 while the minimap tick — whose signature carries the
	// rendered clock — had already moved. Same class as the timezone change: the card shows
	// a FORMATTED clock, so the signature has to include the formatted text.
	{
		const mkClock = (time) => ({
			eventNodes: [
				{ kind: "user", seq: 7, time: time, turn: 1, content: [{ type: "text", text: "same" }] },
				{ kind: "assistant", seq: 8, time: time + 1000, turn: 1, step: 1, messageId: "cm", blocks: [{ kind: "text", text: "ok" }] }
			],
			requests: [], callSchemas: {}, runningCalls: {}, partial: null
		});
		window.__store.set(mkClock(1700000000000));
		await tick(450);
		const firstText = (document.querySelector(".dstv_station") || {}).innerText || "";
		window.__store.set(mkClock(1704294967296));
		await tick(450);
		const secondText = (document.querySelector(".dstv_station") || {}).innerText || "";
		if (firstText === secondText) {
			fail("a timestamp 24h later produced the SAME card text (signature collision): " + JSON.stringify(firstText.replace(/\n/g, "|")));
		}
		info.collision = { before: firstText.replace(/\n/g, "|"), after: secondText.replace(/\n/g, "|") };
		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(300);
	}

	return JSON.stringify({ failures, info });
})()
