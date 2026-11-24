#!/usr/bin/env node
/**
 * Fail when `docs/DESIGN.md` references a section that does not exist.
 *
 * The document has accumulated ~170 `§x.y` references across a few hundred
 * sessions of work. That is enough for real drift: a renumbered section, or a
 * section deleted because its conclusion was withdrawn, leaves the surrounding
 * prose pointing at nothing — and a reader who follows the pointer finds no
 * explanation where one was promised.
 *
 * Two kinds of reference are treated differently on purpose:
 *
 *   - a reference to an existing section            → fine
 *   - a reference to a missing section, on a line
 *     that itself says 已删除 / 被我删掉             → allowed, and COUNTED
 *   - any other reference to a missing section      → failure
 *
 * The middle case is not a loophole: §13.05 argues against a conclusion that
 * used to live in §13.04, and §13.05 would be unreadable without naming it. What
 * the rule forbids is a pointer to nowhere that does not admit it.
 *
 *   node scripts/doc-ref-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOC = join(ROOT, 'docs', 'DESIGN.md');
const md = readFileSync(DOC, 'utf8');

// `\s+`, not `\s*`: a section only counts if the `#` run is followed by a space,
// which is exactly what Markdown itself requires. With `\s*` this script accepted
// `###13.25` — a line that renders as plain paragraph text — as a live section, so a
// `§13.25` pointer would resolve here while leading the reader to nothing on GitHub.
// doc-heading-check.mjs is the guard that fails on such a line; the two now agree on
// what a section is instead of disagreeing silently.
const sections = new Set([...md.matchAll(/^###\s+(\d+\.\d+)/gm)].map((m) => m[1]));
const lines = md.split('\n');

const dangling = [];
let markedDeleted = 0;
lines.forEach((line, i) => {
	const refs = [...line.matchAll(/§\s*(\d+\.\d+)/g)].map((m) => m[1]);
	if (refs.length === 0) return;
	// The admission has to be on the same line as the reference: a paragraph-long
	// caveat elsewhere in the section would otherwise excuse every pointer in it.
	const admitsDeletion = /已删除|被我删掉/.test(line);
	for (const ref of refs) {
		if (sections.has(ref)) continue;
		if (admitsDeletion) { markedDeleted += 1; continue; }
		dangling.push('line ' + (i + 1) + ': §' + ref + ' — ' + line.trim().slice(0, 80));
	}
});

console.log('doc-ref-check: ' + sections.size + ' sections, ' + markedDeleted + ' reference(s) to withdrawn sections (explicitly marked)');
if (dangling.length > 0) {
	for (const d of dangling) console.error('  ✗ ' + d);
	console.error('doc-ref-check: FAIL (' + dangling.length + ' reference(s) to sections that do not exist)');
	process.exit(1);
}
console.log('DOC REFS OK');
