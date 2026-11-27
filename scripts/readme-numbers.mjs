#!/usr/bin/env node
/**
 * Fail when a count stated in the READMEs disagrees with the thing it counts.
 *
 * Three numbers in the docs are derived, not invented, and every one of them has
 * drifted at least once:
 *
 *   - "CI 门禁 7 项"          ← the number of named steps in check.yml, minus Install
 *   - "npm run check 跑 N 步" ← the number of `&&` segments in package.json
 *   - "13 组观测 / 47 条断言" ← probe.js: `info.X =` assignments, `fail(` calls
 *
 * Reading the README and comparing it to the workflow by eye already failed twice
 * (the directory tree said "5 项门禁" for weeks after the count became 7). A number
 * that can be computed should never be typed.
 *
 * Every count is derived STATICALLY — no browser, no agent-browser, no network — so
 * this can run as a gate anywhere, including CI.
 *
 *   node scripts/readme-numbers.mjs            # check
 *   node scripts/readme-numbers.mjs --print    # show what it thinks the counts are
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ── the three truths, each taken from the file that defines it ────────────────
const wf = read('.github/workflows/check.yml');
const namedSteps = [...wf.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
const ciGates = namedSteps.filter((n) => n !== 'Install').length;

const pkg = JSON.parse(read('package.json'));
const version = String(pkg.version);
const localSteps = pkg.scripts.check.split('&&').map((s) => s.trim()).filter(Boolean).length;

// Two probe files, one count. `probe-en.js` was split out because `agent-browser eval`
// aborts at 30 s and the language switch pushed the single file over it (§13.69) — and
// leaving it out of this count is exactly the one-source-vs-two-sources blindness this
// very block has already been fixed for once (§13.44).
const PROBE_FILES = ['test/browser/probe.js', 'test/browser/probe-detail.js', 'test/browser/probe-en.js'];
const probes = PROBE_FILES.map((f) => read(f));
const observedGroups = new Set();
let assertions = 0;
for (const src of probes) {
	for (const m of src.matchAll(/info\.([a-zA-Z]\w*)\s*=/g)) observedGroups.add(m[1]);
	assertions += [...src.matchAll(/\bfail\(/g)].length;
}

// ── checks added OUTSIDE probe.js ────────────────────────────────────────────
//
// The counts above read probe.js only, so they were blind to everything
// scripts/browser-check.mjs adds itself: `parsed.info.narrow` (a group) and two
// `parsed.failures.push(...)` calls (assertions) in the `--shots` 375px probe.
// The script therefore printed "14 observation groups" in that mode while both
// READMEs said 13, and the gate stayed green — the same one-source-vs-two-sources
// blindness as §13.44, one file over.
//
// Both extra counts are gated, and the READMEs state them on the `--shots` line.
const browserCheck = read('scripts/browser-check.mjs');
const extraGroupNames = new Set(
	[...browserCheck.matchAll(/(?:parsed\.)?info\.([a-zA-Z]\w*)\s*=/g)]
		.map((m) => m[1])
		.filter((n) => !observedGroups.has(n)),
);
// Only `push("…")` is an assertion. `push(...other)` forwards failures produced
// ELSEWHERE (the English pass collects its own) — counting it as an assertion inflated the
// total by one for every forwarded bundle, and the gate would then demand README numbers
// that describe nothing a reader could point at.
const extraAssertions = [...browserCheck.matchAll(/(?:parsed\.)?failures\.push\(\s*["'`]/g)].length;

const truth = {
	ciGates, localSteps, groups: observedGroups.size, assertions,
	extraGroups: extraGroupNames.size, extraAssertions,
	// The `--shots` line ends with a TOTAL ("共 36 组" / "(36 total)"), not the extra.
	// It was not a claim at all until now, so it drifted silently while the line's other
	// numbers were gated: the English copy read "(30 total)" for six releases after the
	// base grew past it. A number written down twice goes stale (§13.37) — including the
	// one that is a SUM of two numbers the same file already checks.
	shotsTotalGroups: observedGroups.size + extraGroupNames.size,
};

if (process.argv.includes('--print')) {
	console.log('CI 门禁 ' + ciGates + ' 项（workflow 具名步骤 ' + namedSteps.length + ' − Install）');
	console.log('npm run check ' + localSteps + ' 步');
	console.log('probe.js 观测组 ' + truth.groups + ' 个 / 断言 ' + assertions + ' 条');
	console.log('--shots 合计 ' + truth.shotsTotalGroups + ' 组（基础 ' + truth.groups + ' + 额外 ' + truth.extraGroups + '）');
	console.log('browser-check 额外 ' + truth.extraGroups + ' 组 / ' + truth.extraAssertions + ' 条断言'
		+ (extraGroupNames.size > 0 ? '（组：' + [...extraGroupNames].join(', ') + '）' : ''));
	process.exit(0);
}

// ── what each README claims, matched by the sentence it appears in ────────────
//
// The line's CONTEXT decides which number it is, not the number's suffix. The first
// version of this audit classified "门禁本身是 7 项" as a browser-check count because
// it looked for `N 项` — the audit was wrong, not the document. Anchoring on the
// sentence is what made it correct.
const problems = [];
const counted = { ciGates: 0, localSteps: 0, groups: 0, assertions: 0, extraGroups: 0, extraAssertions: 0, shotsTotalGroups: 0 };

const claim = (file, lineNo, kind, found, want) => {
	counted[kind] += 1;
	if (found !== want) {
		problems.push(file + ':' + lineNo + ' — ' + kind + ' says ' + found + ', actual ' + want);
	}
};

for (const file of ['README.md', 'README.en.md']) {
	read(file).split('\n').forEach((line, i) => {
		const at = i + 1;

		// ── specific claims first, generic ones afterwards ────────────────────
		//
		// The `--shots` line says "另加 1 组 / 2 条断言（375px …，共 14 组）". The
		// generic `(\d+) 条断言 -> 47` rule happily matched that "2" and reported
		// `assertions says 2, actual 47` — the gate was wrong, not the document
		// (§13.37, §13.44). So: a specific rule claims a span of the line, and the
		// generic rules skip any match that starts inside a claimed span. Order and
		// precedence are explicit instead of accidental.
		const claimedSpans = [];
		const claimSpan = (m, kind, found, want) => {
			claimedSpans.push([m.index, m.index + m[0].length]);
			claim(file, at, kind, found, want);
		};
		const isClaimed = (idx) => claimedSpans.some(([s, e]) => idx >= s && idx < e);

		for (const m of line.matchAll(/--shots[^\n]{0,80}?另加\s*(\d+)\s*组/g)) claimSpan(m, 'extraGroups', Number(m[1]), truth.extraGroups);
		for (const m of line.matchAll(/--shots[^\n]{0,80}?另加\s*\d+\s*组\s*\/\s*(\d+)\s*条/g)) claimSpan(m, 'extraAssertions', Number(m[1]), truth.extraAssertions);
		for (const m of line.matchAll(/--shots[^\n]{0,60}?(?:adds?|plus)\s*(\d+)\s*(?:more\s*)?group/g)) claimSpan(m, 'extraGroups', Number(m[1]), truth.extraGroups);
		for (const m of line.matchAll(/--shots[^\n]{0,60}?adds?\s*\d+\s*more\s*group\s*\/\s*(\d+)\s*assertions?/g)) claimSpan(m, 'extraAssertions', Number(m[1]), truth.extraAssertions);
		// The total at the end of the same line: "…（375px 溢出，共 36 组）" / "(36 total)".
		// Scoped to the `--shots` line so an unrelated "共 N 组" elsewhere is not misread.
		for (const m of line.matchAll(/--shots[^\n]{0,90}?共\s*(\d+)\s*组/g)) claimSpan(m, 'shotsTotalGroups', Number(m[1]), truth.shotsTotalGroups);
		for (const m of line.matchAll(/--shots[^\n]{0,90}?\((\d+)\s*total\)/g)) claimSpan(m, 'shotsTotalGroups', Number(m[1]), truth.shotsTotalGroups);

		// "CI：7 项门禁" / "the seven gates" / "门禁本身是 7 项" / "those 7 gates"
		for (const m of line.matchAll(/(\d+)\s*项门禁/g)) if (!isClaimed(m.index)) claim(file, at, 'ciGates', Number(m[1]), ciGates);
		for (const m of line.matchAll(/(\d+)\s*gates\b/g)) if (!isClaimed(m.index)) claim(file, at, 'ciGates', Number(m[1]), ciGates);
		for (const m of line.matchAll(/门禁(?:本身)?是\s*(\d+)\s*项/g)) if (!isClaimed(m.index)) claim(file, at, 'ciGates', Number(m[1]), ciGates);

		// "其中 6 步" / "6 of them"
		for (const m of line.matchAll(/(\d+)\s*步/g)) {
			if (isClaimed(m.index)) continue;
			// "7 项门禁（…）" style lines also contain 步 sometimes; require the verb nearby.
			if (!/跑|runs?|其中|of them/.test(line)) continue;
			claim(file, at, 'localSteps', Number(m[1]), localSteps);
		}
		for (const m of line.matchAll(/(\d+)\s*of them/g)) if (!isClaimed(m.index)) claim(file, at, 'localSteps', Number(m[1]), localSteps);

		// "跑 47 条断言 / 记录 13 组观测" and its English twin
		for (const m of line.matchAll(/(\d+)\s*条断言/g)) if (!isClaimed(m.index)) claim(file, at, 'assertions', Number(m[1]), assertions);
		for (const m of line.matchAll(/(\d+)\s*assertions?/g)) if (!isClaimed(m.index)) claim(file, at, 'assertions', Number(m[1]), assertions);
		for (const m of line.matchAll(/(\d+)\s*组观测/g)) if (!isClaimed(m.index)) claim(file, at, 'groups', Number(m[1]), truth.groups);
		for (const m of line.matchAll(/(\d+)\s*recorded groups/g)) if (!isClaimed(m.index)) claim(file, at, 'groups', Number(m[1]), truth.groups);
	});
}

// ── the `npm run check` comment must enumerate the steps that are really there ──
//
// The count check above ("7 步") caught the number but not the LIST. Both READMEs
// said `npm run check  # build --check + version-check + smoke` long after the
// command had grown to seven steps — the number was right three lines further down
// while the comment beside the command was three versions out of date. A reader who
// trusts the comment would skip provenance, both doc gates and the numbers gate.
//
// Scope: this fires on a line that *attempts an enumeration* — one whose comment
// names at least one real step. A bare `npm run check  # 5. run the gates` in the
// release ritual makes no claim about WHICH steps, so demanding all seven there
// would be this gate inventing a rule the prose never stated. The second half of the
// guard keeps that from becoming an escape hatch: each README must still contain at
// least one real enumeration.
const checkScripts = [...pkg.scripts.check.matchAll(/node (scripts\/[\w.-]+\.mjs|test\/[\w.-]+\.cjs)/g)]
	.map((m) => m[1]);
// Normalize to the word the prose uses: `scripts/build-client.mjs` -> `build-client`,
// `test/smoke.test.cjs` -> `smoke` (the `.test` infix is not spoken).
const shortOf = (script) => script
	.replace(/^scripts\//, '').replace(/^test\//, '')
	.replace(/\.mjs$/, '').replace(/\.test\.cjs$/, '').replace(/\.cjs$/, '');
const aliasOf = (short) => (short === 'build-client' ? /build(?: --check)?/ : null);
const names = (block, script) => {
	const alias = aliasOf(shortOf(script));
	return alias !== null ? alias.test(block) : block.includes(shortOf(script));
};

let listChecked = 0;
for (const file of ['README.md', 'README.en.md']) {
	let enumerations = 0;
	const lines = read(file).split('\n');
	lines.forEach((line, i) => {
		// Matches the code-block comment AND the prose enumeration (the 'local `npm run
		// check` runs 7 of them (...)' sentence). The historical staleness happened in the
		// code block, but the prose copy makes the same claim and drifts the same way.
		if (!/npm run check\b/.test(line)) return;
		listChecked += 1;
		// The comment may continue on the next line (it is long); join both.
		const block = line + ' ' + (lines[i + 1] ?? '');
		// Does this line attempt an enumeration at all?
		if (!checkScripts.some((s) => names(block, s))) return;
		enumerations += 1;
		for (const script of checkScripts) {
			if (!names(block, script)) problems.push(file + ':' + (i + 1) + ' — `npm run check` list omits ' + script);
		}
	});
	if (enumerations === 0) {
		problems.push(file + ' — no `npm run check` line enumerates the steps any more; the guard has nothing to check');
	}
}

// ── the version written into the install commands ────────────────────────────
//
// The README now teaches an exact pin (`…@0.11.1`) and a tag-pinned GitHub spec
// (`github:…#v0.11.1`), because `@latest` is unreliable here (pnpm's release-age
// policy) and an unpinned `github:` follows the branch HEAD (§13.49). That makes the
// version appear in the place a user copies FIRST — and it silently goes stale on the
// next release. So gate it: every `dsh-trajectory-traceview-plus@X.Y.Z` and every
// `#vX.Y.Z` in the READMEs must equal package.json's version.
//
// Deliberately only these two shapes: prose that mentions an older version on
// purpose ("0.11.0 shipped a wrong README") must stay writable.
let versionRefs = 0;
for (const file of ['README.md', 'README.en.md']) {
	read(file).split('\n').forEach((line, i) => {
		for (const m of line.matchAll(/dsh-trajectory-traceview-plus@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)) {
			versionRefs += 1;
			if (m[1] !== version) problems.push(file + ':' + (i + 1) + ' — install command pins ' + m[1] + ', package.json says ' + version);
		}
		for (const m of line.matchAll(/#v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)) {
			versionRefs += 1;
			if (m[1] !== version) problems.push(file + ':' + (i + 1) + ' — tag spec pins v' + m[1] + ', package.json says ' + version);
		}
	});
}

const total = Object.values(counted).reduce((a, b) => a + b, 0);
if (total === 0 || listChecked === 0 || versionRefs === 0) {
	// A gate that matches nothing is worse than no gate: it reports success forever.
	console.error('readme-numbers: found NO claim to check (numbers ' + total + ', `npm run check` lines '
		+ listChecked + ', version refs ' + versionRefs + ') — the patterns have drifted from the prose');
	process.exit(1);
}

console.log('readme-numbers: 核对 ' + total + ' 处数字（门禁 ' + ciGates + ' / 本地 ' + localSteps
	+ ' / 观测组 ' + truth.groups + ' / 断言 ' + assertions + '）+ ' + versionRefs + ' 处版本引用');
if (problems.length > 0) {
	for (const p of problems) console.error('  ✗ ' + p);
	console.error('readme-numbers: FAIL (' + problems.length + ' 处不一致)');
	process.exit(1);
}
console.log('README NUMBERS OK');
