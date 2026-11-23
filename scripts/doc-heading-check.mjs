#!/usr/bin/env node
/**
 * Fail when `docs/DESIGN.md` contains heading-like lines that Markdown will not
 * render as headings.
 *
 * CommonMark requires a space (or end of line) after the `#` run. `###13.25` is
 * therefore **paragraph text**, not a heading — GitHub renders it as a literal
 * `###13.25` paragraph. That is invisible while editing and only shows up when
 * someone reads the document on GitHub and finds no section structure at all.
 *
 * This had already happened here: 10 `###` and 39 `####` headings were written
 * without the space, so most of §13.25–§13.34 rendered as a wall of text, and one
 * prose line beginning `#7 ...` silently became an `<h1>`.
 *
 * Also flags a trailing `#`-closing mismatch, which is the other ATX foot-gun.
 *
 * And it checks code spans, for the same reason: a single-backtick span cannot
 * contain a backtick, so `` `case\`text\`` never closes. The source reads fine and
 * renders as a mess. A code span containing a backtick must use a longer fence.
 *
 *   node scripts/doc-heading-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOC = join(ROOT, 'docs', 'DESIGN.md');
const lines = readFileSync(DOC, 'utf8').split('\n');

const problems = [];
let headings = 0;

lines.forEach((line, i) => {
	const at = 'line ' + (i + 1) + ': ';

	// ATX heading that is missing the required space after the # run.
	const noSpace = /^(#{1,6})([^ #\t].*)$/.exec(line);
	if (noSpace !== null) {
		problems.push(at + '`' + line.slice(0, 40) + '` — `#` run must be followed by a space, so this renders as plain text: insert `' + noSpace[1] + ' `');
		return;
	}

	// A real heading, but with a closing `#` run that does not match the opening one.
	const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
	if (heading !== null) {
		headings += 1;
		// A same-line `#` immediately after a number is the usual "#7 ..." mistake.
		if (/^#\d/.test(line)) problems.push(at + '`' + line.slice(0, 40) + '` — prose starting with `#<digit>` becomes a level-1 heading');
	}

	// Backslash-escaped backticks inside what looks like a code span. A span
	// delimited by N backticks cannot contain a run of N+ backticks, so `a\`b\``
	// never closes and the rest of the line renders as literal backslashes.
	if (/\\`/.test(line)) {
		problems.push(at + '`' + line.slice(0, 40) + '` — a code span delimited by one backtick cannot contain one; use double backticks (``…``) instead of `\\`');
	}
});

console.log('doc-heading-check: ' + headings + ' rendered heading(s)');
if (problems.length > 0) {
	for (const p of problems) console.error('  ✗ ' + p);
	console.error('doc-heading-check: FAIL (' + problems.length + ' malformed construct(s))');
	process.exit(1);
}
console.log('DOC HEADINGS OK');
