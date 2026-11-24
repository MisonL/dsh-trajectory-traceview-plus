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
const npmView = run('npm', ['view', name + '@' + version, 'version']);
const latest = run('npm', ['view', name, 'dist-tags.latest']);
rows.push({
	place: 'npm registry',
	present: npmView.ok && npmView.out.includes(version),
	detail: npmView.ok && npmView.out.includes(version)
		? 'published' + (latest.ok ? ' (dist-tags.latest = ' + latest.out + ')' : '')
		: 'MISSING — `npm i ' + name + '@latest` still installs ' + (latest.ok ? latest.out : '(unknown)'),
	missing: 'npm publish',
});

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log('release-status: ' + name + '@' + version + '\n');
for (const r of rows) console.log('  ' + (r.present ? '●' : '○') + ' ' + pad(r.place, 16) + r.detail);
const absent = rows.filter((r) => !r.present);
if (absent.length > 0) {
	console.log('\nmissing from ' + absent.length + ' place(s):');
	for (const r of absent) if (r.missing) console.log('  ' + r.place + ':  ' + r.missing);
}
if (absent.some((r) => r.place === 'npm registry')) {
	const msg = 'release-status: ' + version + ' is tagged but NOT on npm — anyone installing by package name gets the old version';
	if (WARN_ONLY) console.log('\n' + msg + ' (warn only)');
	else {
		console.error('\n' + msg);
		process.exit(1);
	}
}
console.log('\nrelease-status: consistent everywhere');
