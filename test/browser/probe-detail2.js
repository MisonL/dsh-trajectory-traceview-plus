/* Third half of the browser assertions (see probe.js for the header comment).

   Split a SECOND time for the same reason the first split happened (§13.70): this half
   alone reached 30.4 s, and an eval that hits the 30 s cap reports an unparsable result
   instead of a red assertion. Continues from the state probe-detail.js leaves.

   `healthySnap` is handed over on `window.__detailBase` because each eval is its own
   scope; recomputing it here would capture whatever the previous half left mid-fixture. */

/* Second half of the browser assertions (see probe.js for the header comment).

   SPLIT because `agent-browser eval` aborts at 30 s. Measured: the single file reached
   27.4 s once the live-path group was added, and a probe that dies at the cap reports an
   UNPARSABLE RESULT rather than a red assertion — strictly worse than a failure. Both
   halves share one page (browser-check opens it once and evals sequentially), so the
   second half continues from whatever state the first left (§13.70).

   Order matters: this file assumes probe.js already ran. */
	const healthySnap = window.__detailBase;
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

	// 23b) the panel root must SHOW focus, and the glyph-only toggle must have a name.
	// A real Tab landed on `.dstv_root` with `:focus-visible=true` and `outline-style:none`
	// — the shortcut-owning element was the one place a keyboard user could not see focus.
	// The expand/collapse button announced itself as "button, ⤢": a glyph is not a name.
	{
		const rootEl = document.querySelector(".dstv_root");
		if (rootEl === null) fail("no panel root to focus");
		else {
			rootEl.focus();
			await tick(200);
			const style = getComputedStyle(rootEl);
			if (style.outlineStyle === "none" || style.outlineWidth === "0px") {
				fail("the focused panel root has no visible outline (style " + style.outlineStyle + ", width " + style.outlineWidth + ")");
			}
			const toggle = document.querySelector(".dstv_panelToggle");
			if (toggle === null) fail("the expand/collapse button is missing");
			else {
				const name = (toggle.getAttribute("aria-label") || "").trim();
				if (name === "") fail("the expand button has no accessible name (its text is " + JSON.stringify((toggle.textContent || "").trim()) + ")");
				if (toggle.getAttribute("aria-expanded") === null) fail("the expand button does not expose aria-expanded");
				const before = toggle.getAttribute("aria-expanded");
				toggle.click();
				await tick(250);
				if (toggle.getAttribute("aria-expanded") === before) fail("aria-expanded did not change after expanding the panel");
				toggle.click();
				await tick(250);
			}
		}
	}

	// 23c) follow mode must follow the LIVE TIP, not just the overview.
	// The scroll effect bailed out whenever a station was selected, so with 跟随 on and the
	// newest station selected, a newly streamed record landed off-screen (measured: 13
	// stations, station 13 selected, 14th arrives, scrollLeft unchanged, new card 268 px
	// past the right edge).
	{
		const mkNodes = (n) => {
			const out = [];
			for (let i = 1; i <= n; i += 1) out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "q" + i }] });
			return out;
		};
		const snapOf = (n) => ({ eventNodes: mkNodes(n), requests: [], callSchemas: {}, runningCalls: {}, partial: null });
		window.__store.set(snapOf(13));
		await tick(600);
		const sc = document.querySelector(".dstv_scroller");
		const followBtn = [...document.querySelectorAll("button")].find((b) => /跟随/.test(((b.title || "") + (b.getAttribute("aria-label") || ""))));
		if (sc === null) fail("no scroller for the follow check");
		else if (followBtn === void 0) fail("the follow toggle is missing");
		else {
			const cardsNow = [...document.querySelectorAll("[role=option]")];
			cardsNow[cardsNow.length - 1].click();
			await tick(300);
			followBtn.click();
			await tick(350);
			if (followBtn.getAttribute("aria-pressed") !== "true") fail("the follow toggle did not turn on");
			window.__store.set(snapOf(14));
			await tick(600);
			const scrollWidth = sc.scrollWidth;
			const clientWidth = sc.clientWidth;
			const atEnd = Math.abs(sc.scrollLeft + clientWidth - scrollWidth) < 8;
			if (!atEnd) fail("follow is on but the newest station is off-screen (scrollLeft " + Math.round(sc.scrollLeft) + " + " + clientWidth + " < " + scrollWidth + ")");
			info.follow = { atEnd: true };
			window.__store.set(Object.assign({ partial: null }, healthySnap));
			await tick(300);
		}
	}

	// 23d) the search counter must follow the MATCH, not an array index.
	// After a page load the counter read "2/3" while the selection sat on what had become
	// the 3rd of 3 matches: the pointer was an index into `matches`, which changes meaning
	// the moment the station list grows.
	{
		const mkHit = (n) => {
			const out = [];
			for (let i = 1; i <= n; i += 1) out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: (i % 5 === 0 ? "HIT" : "no") + i }] });
			return out;
		};
		window.__store.set({ eventNodes: mkHit(10), requests: [], callSchemas: {}, runningCalls: {}, partial: null });
		await tick(350);
		const rootEl = document.querySelector(".dstv_root");
		const searchEl = document.querySelector("input.dstv_searchInput:not(.dstv_anchorInput)");
		if (rootEl === null || searchEl === null) fail("no root/search box for the match-counter check");
		else {
			const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(searchEl), "value").set;
			setter.call(searchEl, "HIT");
			searchEl.dispatchEvent(new Event("input", { bubbles: true }));
			await tick(200);
			rootEl.focus();
			for (let k = 0; k < 2; k += 1) {
				searchEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
				await tick(150);
			}
			const counterOf = () => {
				const el = document.querySelector(".dstv_searchCount");
				return el === null ? "" : (el.textContent || "");
			};
			if (!/^2\/2/.test(counterOf())) fail("expected the counter at 2/2 before paging, got " + JSON.stringify(counterOf()));
			// A REAL page load: the same stations keep their ids, one older match is prepended.
			window.__store.set({ eventNodes: [{ kind: "user", seq: 3, time: 100, turn: 0, content: [{ type: "text", text: "HIT early" }] }, ...mkHit(10)], requests: [], callSchemas: {}, runningCalls: {}, partial: null });
			await tick(450);
			const opts = [...document.querySelectorAll("[role=option]")];
			const hits = opts.map((o, i) => ({ i, hit: (o.textContent || "").indexOf("HIT") >= 0 })).filter((x) => x.hit).map((x) => x.i);
			const sel = opts.findIndex((o) => o.getAttribute("aria-selected") === "true");
			const expected = hits.indexOf(sel) + 1;
			const shownMatch = /^(\d+)\//.exec(counterOf());
			if (expected <= 0) fail("the selection is not on a matching station after paging (selected " + sel + ", hits " + JSON.stringify(hits) + ")");
			else if (shownMatch === null || Number(shownMatch[1]) !== expected) {
				fail("the match counter says " + JSON.stringify(counterOf()) + " but the selection is match " + expected + " of " + hits.length);
			}
			info.matchCounter = counterOf();
			setter.call(searchEl, "");
			searchEl.dispatchEvent(new Event("input", { bubbles: true }));
			await tick(150);
			window.__store.set(Object.assign({ partial: null }, healthySnap));
			await tick(150);
		}
	}

	// 23f) a LIVE session switch (panel stays mounted) must reset cleanly.
	// Z3 exists because this path hid a stale `setMatchPtr` for one release: the reset
	// effect only runs when the conversation changes WHILE mounted, and the probe never
	// did that. The ReferenceError was swallowed by React's boundary, so the symptom was
	// not a crash but a half-finished reset.
	{
		const errBefore = (window.__errors || []).length;
		window.__render({ sessionKey: "live-switch-2" });
		await tick(400);
		const stillMounted = document.querySelector(".dstv_root") !== null;
		const selectedNow = [...document.querySelectorAll("[role=option]")]
			.filter((o) => o.getAttribute("aria-selected") === "true").length;
		const fresh = (window.__errors || []).slice(errBefore);
		if (!stillMounted) fail("a live session switch unmounted the panel");
		else if (fresh.length > 0) fail("a live session switch threw: " + String(fresh[0]).slice(0, 160));
		else if (selectedNow !== 0) fail("a live session switch kept " + selectedNow + " station(s) selected instead of returning to the overview");
		info.liveSwitch = { errors: fresh.length, selected: selectedNow };
		window.__render({ sessionKey: "s" });
		await tick(300);
	}

	// 23e) remount → FIRST page load must keep the STATION, not the index.
	// The pin-by-id effect skipped its first run after a remount (`prevRevealedRef` was
	// seeded with the restored value, so it looked like "nothing changed") and
	// `selectedIdRef` stayed empty; the first prepend then kept the INDEX: measured
	// "6 / 10 用户 T6" became "6 / 13 用户 T3".
	//
	// The remount must pass the SAME sessionKey. Without it the fixture falls back to its
	// default session and the panel reads a different storage key, so nothing is restored
	// and the sequence being tested never happens (that is why this group was absent).
	{
		const mkT = (from, to) => {
			const out = [];
			for (let i = from; i <= to; i += 1) out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "T" + i }] });
			return out;
		};
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		const viewKeys = () => Object.keys(window.sessionStorage).filter((k) => k.indexOf("dstv:view:") === 0);
		for (const k of viewKeys()) window.sessionStorage.removeItem(k);
		// The fixture can now load older history for real, and selecting a station scrolls the
		// list enough to trigger it. These two groups build their windows by hand, so turn that
		// off rather than fight it.
		if (window.__sessionStore) window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: false }));
		window.__store.set(Object.assign({ eventNodes: mkT(1, 10) }, base));
		await tick(500);
		const opts = () => [...document.querySelectorAll("[role=option]")];
		const textOf = () => {
			const cur = opts().find((o) => o.getAttribute("aria-selected") === "true");
			return cur === undefined ? "" : ((cur.getAttribute("aria-label") || "").split("，").pop() || "");
		};
		if (opts().length < 6) fail("not enough stations for the remount-prepend check (" + opts().length + ")");
		else {
			opts()[5].click();
			await tick(800);
			const keys = viewKeys();
			if (keys.length !== 1) fail("expected exactly one view-state key before the remount, got " + JSON.stringify(keys));
			else {
				const sessionKey = keys[0].slice("dstv:view:1:".length);
				const before = textOf();
				window.__remount({ sessionKey });
				await tick(700);
				const restored = textOf();
				if (restored === "") fail("the remount did not restore the selection, so the pin cannot be exercised");
				else if (restored !== before) fail("the remount restored " + JSON.stringify(restored) + " instead of " + JSON.stringify(before));
				else {
					// A REAL page load: older stations are prepended, the existing ones keep their ids.
					window.__store.set(Object.assign({
						eventNodes: [
							{ kind: "user", seq: 3, time: 100, turn: 0, content: [{ type: "text", text: "OLD0" }] },
							{ kind: "user", seq: 6, time: 200, turn: 0, content: [{ type: "text", text: "OLD1" }] },
							{ kind: "user", seq: 9, time: 300, turn: 0, content: [{ type: "text", text: "OLD2" }] }
						].concat(mkT(1, 10))
					}, base));
					await tick(700);
					const after = textOf();
					if (after !== restored) {
						fail("after a remount the first page load moved the selection from " + JSON.stringify(restored) + " to " + JSON.stringify(after) + " (index kept, station lost)");
					}
					info.remountPrepend = { restored, after };
				if (window.__sessionStore) window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true }));
					window.__store.set(Object.assign({ partial: null }, healthySnap));
					await tick(250);
				}
			}
		}
	}

	// 23g) a remount whose FIRST FRAME has no stations must still pin the selection.
	// The host restores `revealed` and only then hands over the station list. Recording the
	// pin against an empty list wrote "nothing is selected", and the next page load kept the
	// index: measured T6 → T3. `selectedIdRef` therefore has to distinguish "not recorded
	// yet" from "recorded, overview".
	{
		const mkT = (from, to) => {
			const out = [];
			for (let i = from; i <= to; i += 1) out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "T" + i }] });
			return out;
		};
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		const viewKeys = () => Object.keys(window.sessionStorage).filter((k) => k.indexOf("dstv:view:") === 0);
		for (const k of viewKeys()) window.sessionStorage.removeItem(k);
		if (window.__sessionStore) window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: false }));
		window.__store.set(Object.assign({ eventNodes: mkT(1, 10) }, base));
		await tick(450);
		const opts = () => [...document.querySelectorAll("[role=option]")];
		const textOf = () => {
			const cur = opts().find((o) => o.getAttribute("aria-selected") === "true");
			return cur === undefined ? "" : ((cur.getAttribute("aria-label") || "").split("，").pop() || "");
		};
		if (opts().length < 6) fail("not enough stations for the empty-first-frame check (" + opts().length + ")");
		else {
			opts()[5].click();
			await tick(600);
			const keys = viewKeys();
			if (keys.length !== 1) fail("expected one view-state key before the empty-frame remount, got " + JSON.stringify(keys));
			else {
				const sessionKey = keys[0].slice("dstv:view:1:".length);
				const before = textOf();
				// The host mounts with the restored position and NO stations yet.
				window.__store.set(Object.assign({ eventNodes: [] }, base));
				window.__remount({ sessionKey });
				await tick(150);
				if (opts().length !== 0) fail("the empty first frame did not actually render empty (" + opts().length + " stations)");
				// …then the list arrives.
				window.__store.set(Object.assign({ eventNodes: mkT(1, 10) }, base));
				await tick(500);
				if (textOf() !== before) fail("the list arriving did not restore " + JSON.stringify(before) + ", got " + JSON.stringify(textOf()));
				// …and the first page load must keep that station, not its index.
				window.__store.set(Object.assign({ eventNodes: [
					{ kind: "user", seq: 3, time: 100, turn: 0, content: [{ type: "text", text: "OLD0" }] },
					{ kind: "user", seq: 6, time: 200, turn: 0, content: [{ type: "text", text: "OLD1" }] },
					{ kind: "user", seq: 9, time: 300, turn: 0, content: [{ type: "text", text: "OLD2" }] }
				].concat(mkT(1, 10)) }, base));
				await tick(600);
				const after = textOf();
				if (after !== before) fail("after an empty first frame the first page load moved the selection from " + JSON.stringify(before) + " to " + JSON.stringify(after));
				info.emptyFrame = { before, after };
				if (window.__sessionStore) window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true }));
				window.__store.set(Object.assign({ partial: null }, healthySnap));
				await tick(250);
			}
		}
	}

	// 23h) follow mode must NOT drag the view when the reader is on an older station.
	// 23c pins the "at the tip" half; this is the other half. A `followTipRef` that stayed
	// true would still pass 23c while yanking the viewport away from whatever the reader
	// deliberately opened.
	{
		const mkF = (n) => {
			const out = [];
			for (let i = 1; i <= n; i += 1) out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "F" + i }] });
			return out;
		};
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		const sc = document.querySelector(".dstv_scroller");
		const followBtn = () => [...document.querySelectorAll("button")].find((b) => /跟随/.test(((b.title || "") + (b.getAttribute("aria-label") || ""))));
		const atEnd = () => Math.abs(sc.scrollLeft + sc.clientWidth - sc.scrollWidth) < 8;
		const optsF = () => [...document.querySelectorAll("[role=option]")];
		if (sc === null) fail("no scroller for the follow-negative check");
		else if (followBtn() === void 0) fail("the follow toggle is missing (negative check)");
		else {
			window.__store.set(Object.assign({ eventNodes: mkF(12) }, base));
			await tick(450);
			if (followBtn().getAttribute("aria-pressed") !== "true") { followBtn().click(); await tick(250); }
			optsF()[3].click();
			await tick(300);
			// Selecting a station turns follow OFF by design; turn it back on to test the pin.
			if (followBtn().getAttribute("aria-pressed") !== "true") { followBtn().click(); await tick(250); }
			const beforeLeft = Math.round(sc.scrollLeft);
			window.__store.set(Object.assign({ eventNodes: mkF(13) }, base));
			await tick(500);
			const afterLeft = Math.round(sc.scrollLeft);
			if (atEnd()) fail("follow dragged the view to the newest station while the reader was on station 4 (scrollLeft " + beforeLeft + " -> " + afterLeft + ")");
			if (afterLeft !== beforeLeft) fail("follow scrolled " + beforeLeft + " -> " + afterLeft + " although the reader was on an older station");
			info.followNegative = { beforeLeft, afterLeft };
			window.__store.set(Object.assign({ partial: null }, healthySnap));
			await tick(250);
		}
	}

	// 23i) a huge message must not be poured into the DOM, and must not be LOST either.
	// `dstv_clamp4` hides the overflow but the text node and the `title` attribute kept the
	// whole string: 1 MB of assistant text painted in 1,575 ms with 1,000,007 characters in
	// the DOM (the tooltip alone carried the megabyte). The card now clamps; copy must still
	// hand over every byte.
	{
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		const HUGE = "z".repeat(1e6);
		window.__store.set(Object.assign({ eventNodes: [{ kind: "user", seq: 1, time: 1, turn: 1, content: [{ type: "text", text: HUGE }] }] }, base));
		await tick(450);
		const inner = document.querySelector(".dstv_station .dstv_text");
		if (inner === null) fail("no station text node for the huge-message check");
		else {
			const shown = (inner.textContent || "").length;
			const tip = (inner.getAttribute("title") || "").length;
			if (shown > 20400) fail("the card rendered " + shown + " characters of a 1 MB message into the DOM");
			if (tip > 500) fail("the card tooltip carries " + tip + " characters");
			if (!/…$/.test(inner.textContent || "")) fail("the clamped card text does not say it was cut");
			// The full text must still be reachable: select the station and copy from the panel.
			const rootEl = document.querySelector(".dstv_root");
			const opts = [...document.querySelectorAll("[role=option]")];
			opts[0].click();
			await tick(400);
			const copyBtn = [...document.querySelectorAll(".dstv_root button")].find((b) => (b.getAttribute("aria-label") || "").indexOf("复制") >= 0 || (b.title || "").indexOf("复制") >= 0);
			if (copyBtn === void 0) fail("no copy button in the detail panel for the huge-message check");
			else {
				copyBtn.click();
				await tick(500);
				const tail = wrote.slice(-1)[0];
				const last = tail === void 0 ? "" : String(tail);
				// A lower bound, not equality: this button copies the whole step, which is the
				// 1 MB body plus its headings (measured 1,000,088). The property under test is
				// that clamping the CARD does not clamp what you get out of the panel.
				if (last.length < 1e6) {
					fail("copying a clamped card handed over only " + last.length + " characters of a 1000000-character message");
				}
				info.huge = { shown, tip, copied: last.length };
			}
			window.__store.set(Object.assign({ partial: null }, healthySnap));
			await tick(250);
		}
	}

	// 23j) three presses of → inside one tick must advance three stations.
	// The step functions read `revealed` from the render closure, so repeats that arrive
	// before React re-renders all saw the SAME value and collapsed into one step. Real key
	// auto-repeat sits on that boundary. They now use the functional form.
	{
		const mkA = (n) => {
			const out = [];
			for (let i = 1; i <= n; i += 1) out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "A" + i }] });
			return out;
		};
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		window.__store.set(Object.assign({ eventNodes: mkA(10) }, base));
		await tick(450);
		const rootK = document.querySelector(".dstv_root");
		const selIdx = () => [...document.querySelectorAll("[role=option]")].findIndex((o) => o.getAttribute("aria-selected") === "true");
		rootK.focus();
		rootK.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
		await tick(250);
		if (selIdx() !== 0) fail("Home did not land on the first station before the repeat check (" + selIdx() + ")");
		else {
			// One tick, three presses — no chance for React to re-render in between.
			for (let i = 0; i < 3; i += 1) {
				rootK.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
			}
			await tick(400);
			const landed = selIdx();
			if (landed !== 3) fail("three → presses in one tick advanced to station " + (landed + 1) + " instead of 4 (repeats were merged)");
			info.repeat = { landed };
			window.__store.set(Object.assign({ partial: null }, healthySnap));
			await tick(250);
		}
	}

	// 23k) an anchor OUTSIDE the window must page backwards until it is covered.
	// README §2's headline promise is "paste an anchor, press Enter, land on it". The probe
	// only ever tested an anchor INSIDE the loaded window and the "not in this window" note —
	// the paging loop between those two states was never exercised, because the fixture's
	// `loadOlder` resolved instantly and loaded nothing. It now really prepends, so this can
	// be driven end to end.
	{
		const mkN = (from, to) => {
			const out = [];
			for (let i = from; i <= to; i += 1) out.push({ kind: "user", seq: i, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "N" + i }] });
			return out;
		};
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		if (window.__sessionStore) window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: true, loadingOlder: false }));
		window.__store.set(Object.assign({ eventNodes: mkN(100, 109) }, base));
		await tick(500);
		const box = document.querySelector("input.dstv_anchorInput");
		const optsN = () => [...document.querySelectorAll("[role=option]")];
		if (box === null) fail("no anchor box for the paging-jump check");
		else if (optsN().length !== 10) fail("the fixture did not start at 10 stations (" + optsN().length + ")");
		else {
			const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value").set;
			setter.call(box, "tvp1:e97");
			box.dispatchEvent(new Event("input", { bubbles: true }));
			box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
			// The fixture prepends 3 stations per page after a 60 ms delay.
			let landed = -1;
			for (let i = 0; i < 10 && landed < 0; i += 1) {
				await tick(300);
				landed = optsN().findIndex((o) => o.getAttribute("aria-selected") === "true");
			}
			const grew = optsN().length;
			const note = [...document.querySelectorAll(".dstv_chip.warn")].map((e) => (e.textContent || "").trim()).join("/");
			if (grew <= 10) fail("pasting an anchor outside the window loaded no older history (" + grew + " stations)");
			if (landed !== 0) fail("pasting tvp1:e97 selected station " + landed + " after paging, expected the first (seq 97)");
			if (/不在当前窗口/.test(note)) fail("the anchor WAS reachable by paging but the panel said it is not in the window: " + JSON.stringify(note));
			info.anchorPaging = { stations: grew, landed, note };
			window.__sessionStore.set(Object.assign({}, window.__sessionStore.value, { hasMore: false }));
			window.__store.set(Object.assign({ partial: null }, healthySnap));
			await tick(250);
		}
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
