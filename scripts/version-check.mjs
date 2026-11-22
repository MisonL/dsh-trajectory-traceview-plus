#!/usr/bin/env node
/**
 * Fail when the released version, its Git tag, and the changelog disagree.
 *
 * `README.md` §14 used to admit this was unchecked ("版本号与 tag 不一致 → 暂无自动
 * 检查，人工确认"). A human reminder is exactly the kind of rule that rots: the
 * dangerous case is silent, because `npm publish` succeeds whether or not the tag
 * exists, and a tag can point at a commit whose `package.json` still says the old
 * version — so the tarball a user installs is not the tree the tag claims.
 *
 * Three hard failures, one notice:
 *
 *   F1  tag `v<version>` exists but that commit's package.json says another version
 *   F2  `CHANGELOG.md` has no heading for `<version>`
 *   F3  `<version>` is not greater than the highest other tag (version went backwards)
 *   note  no tag yet — a development state, not an error
 *
 * Deliberately does NOT require a tag: work-in-progress commits bump the version
 * before the tag is cut, and failing there would train people to skip the check.
 *
 *   node scripts/version-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version);

/** Numeric triple from `1.2.3` / `v1.2.3`; anything else (pre-release) keeps its text. */
function parse(v) {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v);
	return m === null ? null : { nums: [Number(m[1]), Number(m[2]), Number(m[3])], rest: m[4] };
}
function compare(a, b) {
	for (let i = 0; i < 3; i += 1) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
	// A pre-release sorts BEFORE its release (1.0.0-rc < 1.0.0).
	if (a.rest === b.rest) return 0;
	if (a.rest === '') return 1;
	if (b.rest === '') return -1;
	return a.rest < b.rest ? -1 : 1;
}

const self = parse(version);
if (self === null) {
	console.error('version-check: package.json version is not semver: ' + JSON.stringify(version));
	process.exit(1);
}

const failures = [];
const notices = [];

// ── F3: the version must move forward relative to every other tag ──────────────
const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
const others = tags.filter((t) => t !== 'v' + version).map((t) => ({ tag: t, v: parse(t) })).filter((x) => x.v !== null);
if (others.length > 0) {
	const highest = others.reduce((best, x) => (compare(x.v, best.v) > 0 ? x : best));
	if (compare(self, highest.v) <= 0) {
		failures.push('F3 package.json is ' + version + ' but tag ' + highest.tag + ' is already that high or higher — the version went backwards');
	}
}

// ── F1: an existing tag must describe the same version it is named after ───────
const tagName = 'v' + version;
if (tags.includes(tagName)) {
	let taggedVersion = null;
	try {
		taggedVersion = JSON.parse(git('show', tagName + ':package.json')).version;
	} catch {
		failures.push('F1 tag ' + tagName + ' exists but its package.json could not be read');
	}
	if (taggedVersion !== null && String(taggedVersion) !== version) {
		failures.push('F1 tag ' + tagName + ' points at a commit whose package.json says ' + taggedVersion + ' — the tag and the published tree disagree');
	}
	// A tag that is not reachable from HEAD cannot describe what is being shipped.
	try {
		git('merge-base', '--is-ancestor', tagName, 'HEAD');
	} catch {
		notices.push('tag ' + tagName + ' is not an ancestor of HEAD — this checkout is not the tagged tree');
	}
} else {
	notices.push('no tag ' + tagName + ' yet (development state; tag before publishing)');
}

// ── F2: the changelog must mention the version being released ─────────────────
let changelog = '';
try {
	changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
} catch {
	failures.push('F2 CHANGELOG.md is missing');
}
if (changelog !== '' && changelog.indexOf('## ' + version) < 0) {
	failures.push('F2 CHANGELOG.md has no "## ' + version + '" heading — a release without an entry is a release nobody can read about');
}

for (const n of notices) console.log('version-check: note: ' + n);
if (failures.length > 0) {
	for (const f of failures) console.error('version-check: FAIL ' + f);
	process.exit(1);
}
console.log('VERSION OK (' + version + ', ' + tags.length + ' tag(s) seen)');
