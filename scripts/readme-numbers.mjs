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
const localSteps = pkg.scripts.check.split('&&').map((s) => s.trim()).filter(Boolean).length;

const probe = read('test/browser/probe.js');
const observedGroups = new Set([...probe.matchAll(/info\.([a-zA-Z]\w*)\s*=/g)].map((m) => m[1]));
const assertions = [...probe.matchAll(/\bfail\(/g)].length;

const truth = { ciGates, localSteps, groups: observedGroups.size, assertions };

if (process.argv.includes('--print')) {
	console.log('CI 门禁 ' + ciGates + ' 项（workflow 具名步骤 ' + namedSteps.length + ' − Install）');
	console.log('npm run check ' + localSteps + ' 步');
	console.log('probe.js 观测组 ' + truth.groups + ' 个 / 断言 ' + assertions + ' 条');
	process.exit(0);
}

// ── what each README claims, matched by the sentence it appears in ────────────
//
// The line's CONTEXT decides which number it is, not the number's suffix. The first
// version of this audit classified "门禁本身是 7 项" as a browser-check count because
// it looked for `N 项` — the audit was wrong, not the document. Anchoring on the
// sentence is what made it correct.
const problems = [];
const counted = { ciGates: 0, localSteps: 0, groups: 0, assertions: 0 };

const claim = (file, lineNo, kind, found, want) => {
	counted[kind] += 1;
	if (found !== want) {
		problems.push(file + ':' + lineNo + ' — ' + kind + ' says ' + found + ', actual ' + want);
	}
};

for (const file of ['README.md', 'README.en.md']) {
	read(file).split('\n').forEach((line, i) => {
		const at = i + 1;

		// "CI：7 项门禁" / "the seven gates" / "门禁本身是 7 项" / "those 7 gates"
		for (const m of line.matchAll(/(\d+)\s*项门禁/g)) claim(file, at, 'ciGates', Number(m[1]), ciGates);
		for (const m of line.matchAll(/(\d+)\s*gates\b/g)) claim(file, at, 'ciGates', Number(m[1]), ciGates);
		for (const m of line.matchAll(/门禁(?:本身)?是\s*(\d+)\s*项/g)) claim(file, at, 'ciGates', Number(m[1]), ciGates);

		// "其中 6 步" / "6 of them"
		for (const m of line.matchAll(/(\d+)\s*步/g)) {
			// "7 项门禁（…）" style lines also contain 步 sometimes; require the verb nearby.
			if (!/跑|runs?|其中|of them/.test(line)) continue;
			claim(file, at, 'localSteps', Number(m[1]), localSteps);
		}
		for (const m of line.matchAll(/(\d+)\s*of them/g)) claim(file, at, 'localSteps', Number(m[1]), localSteps);

		// "跑 47 条断言 / 记录 13 组观测" and its English twin
		for (const m of line.matchAll(/(\d+)\s*条断言/g)) claim(file, at, 'assertions', Number(m[1]), assertions);
		for (const m of line.matchAll(/(\d+)\s*assertions?/g)) claim(file, at, 'assertions', Number(m[1]), assertions);
		for (const m of line.matchAll(/(\d+)\s*组观测/g)) claim(file, at, 'groups', Number(m[1]), truth.groups);
		for (const m of line.matchAll(/(\d+)\s*recorded groups/g)) claim(file, at, 'groups', Number(m[1]), truth.groups);
	});
}

const total = Object.values(counted).reduce((a, b) => a + b, 0);
if (total === 0) {
	// A gate that matches nothing is worse than no gate: it reports success forever.
	console.error('readme-numbers: found NO numeric claim to check — the patterns have drifted from the prose');
	process.exit(1);
}

console.log('readme-numbers: 核对 ' + total + ' 处数字（门禁 ' + ciGates + ' / 本地 ' + localSteps
	+ ' / 观测组 ' + truth.groups + ' / 断言 ' + assertions + '）');
if (problems.length > 0) {
	for (const p of problems) console.error('  ✗ ' + p);
	console.error('readme-numbers: FAIL (' + problems.length + ' 处不一致)');
	process.exit(1);
}
console.log('README NUMBERS OK');
