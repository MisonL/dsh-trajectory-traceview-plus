#!/usr/bin/env node
/**
 * Fail when a file that ships in the npm tarball carries this machine's absolute paths.
 *
 * `docs/DESIGN.md` is published (`files` lists `docs/`). It accumulated ten paths such as
 * `/Users/<name>/Documents/...` and `/Volumes/...` — the username, the working directory and
 * the Node install layout, shipped to everyone who installs the plugin. No credentials, but
 * it is fingerprint material that no reader needs, and it was invisible because the earlier
 * sweep (§13.38) only covered `scripts/`.
 *
 * The rule: anything inside `files` may mention the repo's own NAME, never a home directory
 * or a volume path. Documentation that legitimately describes a check (this file's own
 * `$ git ls-files … grep -E '/Users/…'` example) is allowed through by the marker below.
 *
 *   node scripts/path-leak-check.mjs
 *
 * Exempt: a line carrying `path-leak-check: allow` (the rule it documents) — used exactly
 * once, in DESIGN §13.38, so the guard cannot be turned into a blanket excuse.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const ALLOW = "path-leak-check: allow";
const PATTERN = /\/Users\/[A-Za-z][\w.-]*|\/Volumes\/[A-Za-z]|\/home\/[A-Za-z][\w.-]*|\/private\/tmp\//;

/** Expand the `files` list into the concrete files npm would pack. */
function shippedFiles() {
	const out = [];
	const walk = (rel) => {
		const abs = path.join(root, rel);
		if (!fs.existsSync(abs)) return;
		const st = fs.statSync(abs);
		if (st.isDirectory()) {
			for (const name of fs.readdirSync(abs)) walk(path.join(rel, name));
			return;
		}
		out.push(rel);
	};
	for (const entry of pkg.files ?? []) {
		const clean = entry.replace(/\/$/, "");
		walk(clean);
	}
	return out;
}

const TEXT = /\.(md|js|mjs|cjs|json|yml|yaml|ts|txt)$/;
const problems = [];
let scanned = 0;

for (const rel of shippedFiles()) {
	if (!TEXT.test(rel)) continue;
	scanned += 1;
	const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
	lines.forEach((line, i) => {
		if (line.includes(ALLOW)) return;
		if (!PATTERN.test(line)) return;
		problems.push(rel + ":" + (i + 1) + " — " + line.trim().slice(0, 120));
	});
}

if (problems.length > 0) {
	console.error("path-leak-check: " + problems.length + " absolute path(s) would be published:");
	for (const p of problems) console.error("  ✗ " + p);
	console.error("  replace them with <repo> / <workdir> / $NODE_HOME, or mark the line `" + ALLOW + "`");
	process.exit(1);
}

console.log("path-leak-check: OK (" + scanned + " shipped text file(s), no local paths)");
