#!/usr/bin/env node
/**
 * Report the places a release has to exist, side by side.
 *
 * §13.43, §13.45, §13.47, §13.49, §13.51 and §13.52 are one failure repeated:
 * the repository was self-consistent while an outside world disagreed, or while this
 * very script reported success over a row it had just printed as missing.
 *
 *   git tag          ← what this checkout claims
 *   tag = shipped    ← does the tree you would publish still match the tag?
 *   GitHub Release   ← what the badge on the repo page reads
 *   npm registry     ← metadata AND whether the tarball bytes actually serve
 *   npm @latest      ← does the resolver hand out that version, or silently an older one?
 *
 * Each is invisible from inside the others. After `git push` + `git tag` +
 * `gh release create` the repo looks finished; if `npm publish` never ran, everyone
 * installing by package name still gets the previous version and nothing errors.
 *
 * NOT a CI gate, deliberately: it needs network access to registry.npmjs.org and
 * api.github.com, and a gate that fails when the network is flaky trains people to
 * ignore it. Run it before announcing a release:
 *
 *   node scripts/release-status.mjs          # report; exit 1 if any row is missing
 *   node scripts/release-status.mjs --warn   # report only, always exit 0
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WARN_ONLY = process.argv.includes('--warn');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version);
const name = String(pkg.name);

const run = (cmd, args, cwd = ROOT) => {
	try {
		return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
	} catch (e) {
		return { ok: false, out: ((e.stdout ?? '') + (e.stderr ?? '')).trim() };
	}
};

const rows = [];

// 1. git tag — local truth, no network.
//
// The row asks ONE question: does `v<version>` exist? It deliberately does NOT ask
// "is HEAD exactly at that tag", which is the wrong question and was the original
// bug here: any repository that keeps working after a release has HEAD past the
// last tag, so that condition is false ~always. Reporting it as a ●/○ turned a
// permanent, normal state into a yellow light that could never clear — exactly the
// kind of noise that trains people to stop reading the output.
//
// What actually matters before a publish is whether the tree you would ship equals
// the tree the tag points at, so that gets its own row (2), with the file list when
// they differ.
const tag = run('git', ['tag', '--list', 'v' + version]);
const hasTag = tag.out.split('\n').filter(Boolean).includes('v' + version);
const headTagged = run('git', ['describe', '--tags', '--exact-match', 'HEAD']);
rows.push({
	place: 'git tag',
	present: hasTag,
	detail: hasTag
		? 'v' + version + ' exists' + (headTagged.ok ? ' (and HEAD is exactly on it)' : ' (HEAD has moved past it, which is normal)')
		: 'missing — nothing in git claims this version',
	missing: 'git tag -a v' + version + ' -m "…" && git push origin v' + version,
});

// 2. shipped tree vs tagged tree — only meaningful with a tag, and only for what
// actually ships at runtime. Documentation and scripts after the tag are fine;
// a different `lib/` after the tag means the tarball and the tag disagree.
const RUNTIME = ['lib', 'package.json', 'cordis.patch.yml'];
let drift = null;
if (hasTag) {
	// `v<version>` against the WORKING TREE, not `v<version>..HEAD`: the dangerous case is an
	// uncommitted edit to lib/ right before publishing, and a commit-range diff cannot see it.
	// (Caught here: appending one line to lib/client.js sailed through and reported all green.)
	const diff = run('git', ['diff', '--name-only', 'v' + version, '--', ...RUNTIME]);
	const files = diff.out.split('\n').map((s) => s.trim()).filter(Boolean);
	drift = files;
	rows.push({
		place: 'tag = shipped',
		present: diff.ok && files.length === 0,
		detail: !diff.ok
			? 'could not compare (is this a git checkout with tag v' + version + '?)'
			: files.length === 0
				? 'runtime files identical to v' + version + ' (docs/scripts moved on, that is fine)'
				: 'runtime files CHANGED after the tag: ' + files.slice(0, 4).join(', ') + (files.length > 4 ? ' …' : ''),
		missing: files && files.length > 0
			? 'publishing now would ship a tree the tag does not describe — bump the version and retag'
			: '',
	});
}

// 3. GitHub Release — what the repo-page badge reads. No gh? Then say so, don't guess.
const gh = run('gh', ['api', 'repos/' + (run('git', ['remote', 'get-url', 'origin']).out.match(/github\.com[:/]([^/]+\/[^/.]+)/) ?? [])[1] + '/releases/tags/v' + version]);
rows.push({
	place: 'GitHub Release',
	present: gh.ok,
	detail: gh.ok ? 'exists (the version badge resolves)' : 'not found — the badge shows a red "no releases"',
	missing: 'gh release create v' + version + ' --notes-file …',
});

// 4. npm registry — what `npm i <name>@latest` installs.
//
// Two separate facts, because they failed separately: the VERSION being present in
// the packument (metadata) and the TARBALL being downloadable (bytes). Right after
// 0.11.1's publish, `versions` and `dist-tags.latest` both said 0.11.1 while
// `…/dsh-trajectory-traceview-plus-0.11.1.tgz` returned HTTP 404 for ~2 minutes —
// so `dsh plugin add pkg@0.11.1` failed with "Tarball server returned HTTP 404"
// while every metadata check looked perfect. `npm view <pkg>@<v> version` cannot
// see that; only fetching the URL can.
const npmView = run('npm', ['view', name + '@' + version, 'version']);
const latest = run('npm', ['view', name, 'dist-tags.latest']);
const published = npmView.ok && npmView.out.includes(version);
let tarballState = 'not checked';
let tarballCode = '';
if (published) {
	const url = run('npm', ['view', name + '@' + version, 'dist.tarball']).out;
	// HEAD, no cache-buster: a cache-buster would defeat the very cache that is stale,
	// hiding exactly the window a real installer would fall into.
	const code = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-I', url]).out;
	tarballCode = code;
	tarballState = code === '200' ? 'tarball downloads' : 'tarball URL returns HTTP ' + code + ' (metadata is live, bytes are not)';
}
rows.push({
	place: 'npm registry',
	present: published && tarballState === 'tarball downloads',
	detail: !published
		? 'MISSING — `npm i ' + name + '@latest` still installs ' + (latest.ok ? latest.out : '(unknown)')
		: 'published' + (latest.ok ? ' (dist-tags.latest = ' + latest.out + ')' : '') + ', ' + tarballState,
	missing: published && tarballState !== 'tarball downloads'
		? 'wait for the CDN (a few minutes) then re-check; `npm view` is not enough'
		: 'npm publish',
});

// 5. npm @latest — does the resolver actually hand out that version?
//
// Advisory row, NOT part of the verdict. pnpm 12 applies a supply-chain delay
// (`minimumReleaseAge`) whose default appears in no config output: right after a
// publish, `pnpm add <pkg>@latest` silently resolves to the PREVIOUS version while
// `npm view` reports the new one (§13.49). The window clears by itself, so making it
// fail would light a red lamp for hours after every release and teach people to
// ignore the output — the exact way §13.45's permanent yellow was useless.
//
// The check is the pair a sibling session proposed: resolve `@latest` twice, once
// with the delay on and once with it disabled, `--lockfile-only` so nothing downloads.
// If the two disagree, the resolver is holding the new release back and anyone using
// `@latest` is getting the old one.
const resolveLatest = (extra) => {
	const dir = mkdtempSync(join(tmpdir(), 'dsr-'));
	try {
		writeFileSync(join(dir, 'package.json'), '{"name":"probe","version":"1.0.0"}\n');
		run('pnpm', ['add', name + '@latest', '--lockfile-only', ...extra], dir);
		const lock = readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8');
		const m = new RegExp('^\\s{2}' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '@([^:\\s]+):', 'm').exec(lock);
		return m === null ? null : m[1];
	} catch {
		return null;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
const resolvedDefault = resolveLatest([]);
const resolvedNoDelay = resolveLatest(['--config.minimumReleaseAge=0']);
if (resolvedDefault === null || resolvedNoDelay === null) {
	// A row that quietly disappears is its own kind of blindness: the reader cannot
	// tell "nothing to report" from "could not check". Say which it is.
	rows.push({
		place: 'npm @latest',
		present: false,
		advisory: true,
		detail: 'could not resolve (pnpm unavailable, or the lockfile shape changed) — check by hand',
		missing: '',
	});
} else {
	const held = resolvedDefault !== resolvedNoDelay;
	// "self-heals" without a number is not information. pnpm's built-in default is
	// 1440 minutes (24 h) — not the "few hours" an earlier version of this message
	// implied, which is why the same advisory was still showing 6.2 h after the
	// publish and looked like a bug. Say how old the release is and when it clears.
	let window = '';
	if (held) {
		// A dotted key like `time.0.11.2` returns empty from npm (digit segments do not
		// resolve), so read the whole time map and pick the key out of it.
		// so read the whole time map and pick the key out of it.
		const times = run('npm', ['view', name, 'time', '--json']);
		let published = '';
		try {
			// `npm view … --json` wraps the object in an array; unwrap before reading the key.
			const raw = JSON.parse(times.out);
			const map = Array.isArray(raw) ? raw[0] : raw;
			published = map?.[version] ?? '';
		} catch { published = ''; }
		const t = Date.parse(published);
		if (Number.isFinite(t)) {
			const ageH = (Date.now() - t) / 3_600_000;
			const leftH = Math.max(0, 24 - ageH);
			window = '; published ' + ageH.toFixed(1) + ' h ago, clears in ~' + leftH.toFixed(1)
				+ ' h (pnpm default minimumReleaseAge = 1440 min)';
		}
	}
	rows.push({
		place: 'npm @latest',
		present: !held,
		advisory: true,
		detail: held
			? 'resolver holds the new release back: @latest → ' + resolvedDefault
				+ ', with minimumReleaseAge=0 → ' + resolvedNoDelay
				+ window + '; install docs pin the version'
			: 'resolver reaches ' + resolvedDefault + (resolvedDefault === version ? ' (the current release)' : ''),
		missing: '',
	});
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log('release-status: ' + name + '@' + version + '\n');
const mark = (r) => (r.advisory && !r.present ? '◐' : r.present ? '●' : '○');
for (const r of rows) console.log('  ' + mark(r) + ' ' + pad(r.place, 16) + r.detail);
const absent = rows.filter((r) => !r.present && !r.advisory);
const advisories = rows.filter((r) => r.advisory && !r.present);
if (absent.length > 0) {
	console.log('\nmissing from ' + absent.length + ' place(s):');
	for (const r of absent) if (r.missing) console.log('  ' + r.place + ':  ' + r.missing);
}
if (advisories.length > 0) {
	console.log('\n◐ = real but time-bounded, does not block:');
	for (const r of advisories) console.log('  ' + r.place + ':  ' + r.detail);
}
// ── verdict ──────────────────────────────────────────────────────────────────
//
// Every absent row must fail, not just npm. The first version only exited non-zero
// for the npm row and then printed "consistent everywhere" with a missing GitHub
// Release — a false green produced by this script itself, and exactly the shape
// §13.37 / §13.44 / §13.50 record three times over (the checker is wrong, not the
// state). The verdict is now derived from `absent` as a whole.
if (absent.length === 0) {
	// Say the advisory out loud in the summary line. §13.52 was this script printing
	// 'consistent everywhere' while a row above it said ○; a reader who skims the last
	// line must not be able to come away believing there was nothing to see.
	console.log('\nrelease-status: consistent everywhere'
		+ (advisories.length > 0 ? ' (' + advisories.length + ' advisory above, not blocking)' : ''));
	process.exit(0);
}

const reasons = [];
if (absent.some((r) => r.place === 'git tag')) {
	reasons.push('no git tag claims this version — nothing else can be trusted');
}
if (absent.some((r) => r.place === 'tag = shipped')) {
	reasons.push('the working tree\'s runtime files differ from the tag — a publish now would ship something the tag does not describe');
}
if (absent.some((r) => r.place === 'GitHub Release')) {
	reasons.push('no GitHub Release — the version badge on the repo page shows a red "no releases"');
}
if (absent.some((r) => r.place === 'npm registry')) {
	// Two very different causes read the same to a user ("install fails"), so the
	// message has to name which one it is.
	reasons.push(!published
		? 'not on npm at all — anyone installing by package name still gets the previous version'
		: 'in the npm packument but the tarball is not downloadable yet (HTTP ' + tarballCode +
			') — `dsh plugin add` fails rather than installing something wrong; this one is safe, wait for the CDN');
}

if (WARN_ONLY) {
	console.log('\nrelease-status (warn only):');
	for (const r of reasons) console.log('  · ' + r);
	process.exit(0);
}
console.error('\nrelease-status: NOT consistent — ' + reasons.length + ' problem(s):');
for (const r of reasons) console.error('  · ' + r);
process.exit(1);
