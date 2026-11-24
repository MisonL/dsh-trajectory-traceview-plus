#!/usr/bin/env node
/**
 * Report the three places a release has to exist, side by side.
 *
 * §13.43, §13.45 and §13.47 are the same failure three times: the repository was
 * self-consistent while an outside world disagreed.
 *
 *   git tag          ← what this checkout claims
 *   GitHub Release   ← what the badge on the repo page reads
 *   npm registry     ← what `npm i <name>` actually installs
 *
 * Each one is invisible from inside the others. After `git push` + `git tag` +
 * `gh release create` the repo looks finished; if `npm publish` never ran, everyone
 * installing by package name still gets the previous version and nothing errors.
 *
 * NOT a CI gate, deliberately: it needs network access to registry.npmjs.org and
 * api.github.com, and a gate that fails when the network is flaky trains people to
 * ignore it. Run it before announcing a release:
 *
 *   node scripts/release-status.mjs          # report; exit 1 if npm is behind
 *   node scripts/release-status.mjs --warn   # report only, always exit 0
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WARN_ONLY = process.argv.includes('--warn');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version);
const name = String(pkg.name);

const run = (cmd, args) => {
	try {
		return { ok: true, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
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

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log('release-status: ' + name + '@' + version + '\n');
for (const r of rows) console.log('  ' + (r.present ? '●' : '○') + ' ' + pad(r.place, 16) + r.detail);
const absent = rows.filter((r) => !r.present);
if (absent.length > 0) {
	console.log('\nmissing from ' + absent.length + ' place(s):');
	for (const r of absent) if (r.missing) console.log('  ' + r.place + ':  ' + r.missing);
}
// ── verdict ──────────────────────────────────────────────────────────────────
//
// Every absent row must fail, not just npm. The first version only exited non-zero
// for the npm row and then printed "consistent everywhere" with a missing GitHub
// Release — a false green produced by this script itself, and exactly the shape
// §13.37 / §13.44 / §13.50 record three times over (the checker is wrong, not the
// state). The verdict is now derived from `absent` as a whole.
if (absent.length === 0) {
	console.log('\nrelease-status: consistent everywhere');
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
