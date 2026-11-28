/* Fourth half of the browser assertions (see probe.js for the header comment).

   Split a THIRD time for the same reason as the first two (§13.70): `agent-browser eval`
   aborts at 30 s and a dead probe reports an unparsable result instead of a red
   assertion. Measured before this split: probe-detail2.js spent 37 s end to end, so the
   mutation run that proves these groups CAN fail died at the cap instead of failing.

   This half owns the groups added after 0.11.6 — each one builds its own fixture and
   restores the healthy snapshot afterwards, so it can run on the state the previous
   halves leave. */

(async function () {
	const healthySnap = window.__detailBase;
	const tick = (ms) => new Promise((r) => setTimeout(r, ms === void 0 ? 120 : ms));
	const failures = [];
	const info = {};
	const fail = (m) => failures.push(m);
	const opts = () => [...document.querySelectorAll("[role=option]")];
	const wrote = [];
	try {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (t) => { wrote.push(t); } }
		});
	} catch { /* an earlier half already installed a working stub */ }

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

	// 23l) the card must tell a compaction REPLAY apart from a missing call.
	// Both used to read "调用不在窗口内". For a replay that is simply false, and it sends
	// the reader hunting for a bug that is not there.
	{
		const base = { requests: [], callSchemas: {}, runningCalls: {}, partial: null };
		window.__store.set(Object.assign({ eventNodes: [
			{ kind: "user", seq: 1, time: 1000, turn: 1, content: [{ type: "text", text: "问" }] },
			{ kind: "assistant", seq: 2, time: 2000, turn: 1, step: 1, messageId: "m1", blocks: [{ kind: "tool-call", callId: "REPLAYED", name: "read", argsRaw: "{}" }] },
			{ kind: "tool-result", seq: 3, time: 3000, turn: 1, step: 1, callId: "REPLAYED", name: "read", callTime: 2000, content: [{ type: "text", text: "FILE" }] },
			{ kind: "user", seq: 50, time: 50000, turn: 2, content: [{ type: "text", text: "二" }] },
			{ kind: "tool-result", seq: 2085, time: 60000, turn: 2, step: 1, callId: "REPLAYED", name: "read", callTime: null, content: [{ type: "text", text: "FILE" }] },
			{ kind: "tool-result", seq: 3000, time: 70000, turn: 3, step: 1, callId: "NEVER-SEEN", name: "x", callTime: null, content: [{ type: "text", text: "OTHER" }] }
		] }, base));
		await tick(500);
		const cards = [...document.querySelectorAll("[role=option]")];
		const replayedCard = cards.find((o) => /压缩重放/.test(o.getAttribute("aria-label") || ""));
		const genuineCard = cards.filter((o) => /孤立工具结果/.test(o.getAttribute("aria-label") || ""));
		if (replayedCard === void 0) fail("the compaction replay is not labelled as a replay on screen (" + JSON.stringify(cards.map((o) => o.getAttribute("aria-label"))) + ")");
		else if (genuineCard.length !== 1) fail("expected exactly one genuine orphan, found " + genuineCard.length);
		else {
			const replayChip = [...replayedCard.querySelectorAll(".dstv_chip")].map((c) => (c.textContent || "").trim()).join("|");
			const genuineChip = [...genuineCard[0].querySelectorAll(".dstv_chip")].map((c) => (c.textContent || "").trim()).join("|");
			if (!/相同/.test(replayChip)) fail("the replay card's chip does not point at the original result: " + JSON.stringify(replayChip));
			if (!/不在窗口内/.test(genuineChip)) fail("the genuine orphan lost its 'outside the window' chip: " + JSON.stringify(genuineChip));
			info.replay = { replayChip, genuineChip };
		}
		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(250);
	}

	// 23m) a window that starts mid-conversation must still show the real system prompt.
	// `prompt.system` is empty in that case (contract), and the panel used to print
	// "0 字" + "…" — claiming the model ran without a system prompt.
	{
		const base = { callSchemas: new Map(), runningCalls: [], partial: null };
		window.__store.set(Object.assign({
			eventNodes: [
				{ kind: "user", seq: 100, time: 1000, turn: 1, content: [{ type: "text", text: "问" }] },
				{ kind: "assistant", seq: 101, time: 2000, turn: 1, step: 1, messageId: "m1", blocks: [{ kind: "text", text: "答" }] }
			],
			systemPrompts: [{ seq: 2, time: 500, turn: 0, step: 0, text: "你是助手，这是被窗口切掉的系统提示。", update: false }],
			requests: [{ purpose: "assistant", turn: 1, step: 1, status: "complete", startSeq: 100, startedAt: 900, completedAt: 2500, prompt: { system: "", tools: [], config: {} } }]
		}, base));
		await tick(700);
		const optsS = [...document.querySelectorAll("[role=option]")];
		if (optsS.length < 2) fail("the system-prompt fixture did not render two stations");
		else {
			optsS[1].click();
			await tick(500);
			const reqTab = [...document.querySelectorAll("button.dstv_tab")].find((x) => (x.textContent || "").indexOf("原始请求") >= 0);
			if (reqTab === void 0) fail("no 原始请求 tab for the system-prompt check");
			else {
				reqTab.click();
				await tick(600);
				const body = document.querySelector(".dstv_root").textContent || "";
				if (!/被窗口切掉的系统提示/.test(body)) fail("the system prompt that sits outside the window was not shown at all");
				if (!/来自窗口外的系统事件 e2/.test(body)) fail("the recovered system prompt is not labelled as coming from outside the window");
				if (/0 字/.test(body)) fail("the request page still reports 0 chars for a request that does have a system prompt");
				info.sysOutside = { ok: true };
			}
		}
		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(250);
	}

	// 23n) every number in the KPI strip must survive the export.
	// Screen said "900 ms 工具总耗时"; the export header said nothing about it.
	{
		const mkE = (n) => {
			const out = [];
			for (let i = 1; i <= n; i += 1) {
				out.push({ kind: "user", seq: i * 10, time: 1000 + i * 1000, turn: i, content: [{ type: "text", text: "问" + i }] });
				out.push({ kind: "assistant", seq: i * 10 + 1, time: 1500 + i * 1000, turn: i, step: 1, messageId: "m" + i, blocks: [{ kind: "tool-call", callId: "c" + i, name: "bash", argsRaw: "{}" }] });
				out.push({ kind: "tool-result", seq: i * 10 + 2, time: 1800 + i * 1000, turn: i, step: 1, callId: "c" + i, name: "bash", callTime: 1500 + i * 1000, content: [{ type: "text", text: "输出" }] });
			}
			return out;
		};
		window.__store.set(Object.assign({ eventNodes: mkE(2) }, { requests: [], callSchemas: new Map(), runningCalls: [], partial: null }));
		await tick(600);
		const kpiStrip = [...document.querySelectorAll(".dstv_kpi")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim());
		const durText = kpiStrip.find((x) => /耗时|time/i.test(x)) || "";
		const durNum = (durText.match(/(\d+(?:\.\d+)?)/) || [])[1] || "";
		if (durNum === "") fail("the KPI strip shows no tool-time number to compare against");
		else {
			const btn = [...document.querySelectorAll(".dstv_root button")].find((b) => /Markdown/.test(b.textContent || ""));
			if (btn === void 0) fail("no export button for the KPI/export check");
			else {
				btn.click();
				await tick(700);
				const md = String(wrote[wrote.length - 1] || "");
				const head = md.split("\n").slice(0, 6).join("\n");
				if (!/工具总耗时|Tool time/.test(head)) fail("the export header does not carry the tool-time KPI at all");
				if (durNum !== "" && head.indexOf(durNum) < 0) fail("the export header omits the tool-time number shown on screen (" + durText + ")");
				info.exportKpi = { durText, found: head.indexOf(durNum) >= 0 };
			}
		}
		window.__store.set(Object.assign({ partial: null }, healthySnap));
		await tick(250);
	}

	window.__probeDetail3 = { failures: failures.slice(), info: info };
	return JSON.stringify({ failures, info });
})()
