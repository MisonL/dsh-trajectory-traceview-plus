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
const tag = run('git', ['tag', '--list', 'v' + version]);
const headTagged = run('git', ['describe', '--tags', '--exact-match', 'HEAD']);
rows.push({
	place: 'git tag',
	present: tag.out.split('\n').filter(Boolean).includes('v' + version),
	detail: headTagged.ok ? 'HEAD is exactly v' + version : 'HEAD is not exactly v' + version,
	missing: 'git tag -a v' + version + ' -m "…" && git push origin v' + version,
});

// 2. GitHub Release — what the repo-page badge reads. No gh? Then say so, don't guess.
const gh = run('gh', ['api', 'repos/' + (run('git', ['remote', 'get-url', 'origin']).out.match(/github\.com[:/]([^/]+\/[^/.]+)/) ?? [])[1] + '/releases/tags/v' + version]);
rows.push({
	place: 'GitHub Release',
	present: gh.ok,
	detail: gh.ok ? 'exists (the version badge resolves)' : 'not found — the badge shows a red "no releases"',
	missing: 'gh release create v' + version + ' --notes-file …',
});

// 3. npm registry — what `npm i <name>@latest` installs.
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
	for (const r of absent) console.log('  ' + r.place + ':  ' + r.missing);
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
