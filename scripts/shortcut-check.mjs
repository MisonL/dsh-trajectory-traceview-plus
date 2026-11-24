#!/usr/bin/env node
/**
 * Every shortcut the README documents must have an assertion in the browser probe.
 *
 * §13.56 and §13.57 are the two halves of one bug class, found hours apart:
 *
 *   §13.56  README §7 listed nine keys; the `keyboard` group tested four of them and
 *           then reported "ok". The other five — Space, PageUp/PageDown, `/`, `f`,
 *           `r` — were promised to users and verified by nothing.
 *   §13.57  One of the remaining rows, `↑` / `↓` in the search box, turned out to be
 *           not merely untested but NOT IMPLEMENTED. The panel handler bails out for
 *           input targets and the search handler only knew Enter/Escape, so the two
 *           most natural keys did nothing at all.
 *
 * Both were invisible for the same reason: the shortcut table is prose, and nothing
 * connects prose to code. A reader of the table believes nine keys work; a reader of
 * the probe report sees "ok". This gate is that missing connection — one-directional
 * on purpose. It does NOT prove an assertion is meaningful (only that the key is
 * named somewhere in the probe); it proves nobody added a documented key and forgot
 * to look at it.
 *
 * The reverse direction is deliberately not enforced: the probe may test keys the
 * table omits (arrow keys inside a focused station, for example), and requiring the
 * table to be exhaustive would turn a useful doc into a mirror of the implementation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const problems = [];

// ── the table ────────────────────────────────────────────────────────────────
const sectionStart = read('README.md').indexOf('## 7. 快捷键');
if (sectionStart < 0) {
	problems.push('README.md has no "## 7. 快捷键" section — the check has nothing to read');
}
const section = sectionStart < 0 ? '' : read('README.md').slice(sectionStart);
const tableEnd = section.indexOf('\n## ', 5);
const table = tableEnd < 0 ? section : section.slice(0, tableEnd);

// A row looks like: `| `←` / `→` | 上一个 / 下一个站点 |`
// Take every backticked key in the FIRST cell. Cells like `` `↑` / `↓`（搜索时） ``
// contain two keys and a qualifier; both keys must be covered.
const rows = [...table.matchAll(/^\|\s*(`[^|]+?`)\s*\|/gm)].map((m) => m[1]);
if (rows.length === 0) {
	problems.push('README §7 has no shortcut rows; the patterns have drifted from the table');
}

// How each key appears in the probe source. A mismatch here is a silent hole: the
// gate would report OK while checking nothing.
const PROBE_NAME = {
	'←': 'ArrowLeft',
	'→': 'ArrowRight',
	'↑': 'ArrowUp',
	'↓': 'ArrowDown',
	'空格': '" "',
	Esc: 'Escape',
	'`Esc`': 'Escape',
	'`空格`': '" "',
};

const probe = read('test/browser/probe.js');
const covered = [];
for (const row of rows) {
	const keys = [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
	for (const key of keys) {
		const needle = PROBE_NAME[key] ?? key;
		// `Enter` shows up as shiftPress("Enter", …) and press("Enter"); a bare
		// substring test is right here because the probe names keys as string literals.
		if (!probe.includes(needle)) {
			problems.push('README §7 documents `' + key + '` but test/browser/probe.js never mentions '
				+ JSON.stringify(needle) + ' — the key is promised and never exercised');
		} else {
			covered.push(key);
		}
	}
}

if (covered.length === 0 && problems.length === 0) {
	problems.push('not a single documented key matched the probe — the mapping has drifted');
}

if (problems.length > 0) {
	for (const p of problems) console.error('  ✗ ' + p);
	console.error('shortcut-check: FAIL (' + problems.length + ' problem(s))');
	process.exit(1);
}
console.log('shortcut-check: README §7 的 ' + rows.length + ' 行 / ' + covered.length
	+ ' 个键在 probe 里都有断言');
console.log('SHORTCUTS OK');
