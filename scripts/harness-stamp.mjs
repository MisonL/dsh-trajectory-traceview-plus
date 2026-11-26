#!/usr/bin/env node
/**
 * Is `test/browser/harness.html` built from the CURRENT `lib/client.js`?
 *
 * Why this exists: manual browser probing goes
 *
 *     edit src/  ->  build-client.mjs  ->  open harness.html
 *
 * which skips `browser-harness.mjs` — the page keeps an OLD inlined bundle, so every
 * measurement and every "is the fix working?" check silently describes the previous
 * revision. That cost a real debugging cycle (§13.75): a correct element-cache fix looked
 * broken, and the tempting next move was to revert it.
 *
 * `browser-check.mjs` always regenerates the harness, so it never sees this. Only a human
 * (or an agent) driving the page by hand does.
 *
 *   node scripts/harness-stamp.mjs          # explain, exit 1 when stale
 *   node scripts/harness-stamp.mjs --quiet  # exit code only
 *
 * Exits 0 when the harness is absent (CI does not build one) or when it is current.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const harnessPath = path.join(root, "test/browser/harness.html");
const clientPath = path.join(root, "lib/client.js");
const quiet = process.argv.includes("--quiet");

const say = (msg) => { if (!quiet) console.log(msg); };

if (!fs.existsSync(harnessPath)) {
	say("harness-stamp: no test/browser/harness.html (nothing to check)");
	process.exit(0);
}

const current = createHash("sha256").update(fs.readFileSync(clientPath)).digest("hex").slice(0, 16);
const html = fs.readFileSync(harnessPath, "utf8");
const found = /window\.__HARNESS_CLIENT_HASH__\s*=\s*"([0-9a-f]+)"/.exec(html);

if (found === null) {
	say("harness-stamp: STALE — the page carries no bundle stamp, so it predates this guard.");
	say("  before probing by hand: node scripts/browser-harness.mjs");
	process.exit(1);
}

if (found[1] !== current) {
	say("harness-stamp: STALE — harness.html inlines " + found[1] + " but lib/client.js is " + current + ".");
	say("  Anything you observe in that page describes the OLD bundle.");
	say("  before probing by hand: node scripts/browser-harness.mjs");
	process.exit(1);
}

say("harness-stamp: OK (" + current + ")");
process.exit(0);
