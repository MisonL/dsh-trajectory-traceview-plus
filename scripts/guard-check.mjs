#!/usr/bin/env node
/**
 * Prove the P1 growth guard can still tell linear from quadratic.
 *
 * §13.55 found the guard was measuring the wrong thing: it took the MINIMUM of the
 * three per-round ratios. Noise is one-sided (scheduling hiccups only lengthen a
 * sample), so a round where the small sample got inflated and the big one did not
 * produces an abnormally LOW ratio — and min() keeps exactly that round. With a
 * known O(n^2) under jitter it missed 12 of 20 trials.
 *
 * Fixing the estimator is easy. Keeping it fixed is the hard part: nothing in the
 * normal green suite would notice if a future edit reintroduced coupling, because
 * the guard passes on healthy code either way. This script is the missing test —
 * it feeds the SAME measurement protocol two functions whose complexity is known
 * in advance and checks the verdict, under the same one-sided jitter that broke it.
 *
 *   node scripts/bench-fold.mjs --guard-check
 *
 * Not in CI on purpose: it measures wall time, so a loaded machine makes it flaky,
 * and a flaky gate trains people to ignore gates. Run it after touching the P1
 * block, or when a performance claim is being made.
 */
const cpuMs = (fn, n, reps, jitter) => {
	let best = Infinity;
	for (let i = 0; i < 5; i += 1) {
		const before = process.cpuUsage();
		for (let r = 0; r < reps; r += 1) fn(n);
		const used = process.cpuUsage(before);
		// One-sided noise, exactly the shape real scheduling produces.
		const ms = ((used.user + used.system) / 1000 / reps) * (1 + Math.random() * jitter);
		if (ms < best) best = ms;
	}
	return best;
};

const callMs = (fn, n, jitter) => {
	let reps = 1;
	let ms = cpuMs(fn, n, 1, jitter);
	while (ms * reps < 15 && reps < 64) {
		reps *= 2;
		ms = cpuMs(fn, n, reps, jitter);
	}
	return ms;
};

const linear = (n) => { let a = 0; for (let i = 0; i < n; i += 1) a += i; return a; };
const quadratic = (n) => { let a = 0; for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) a += 1; return a; };

/** The production estimator: min of each size, then divide. */
const newEstimator = (fn, base, jitter) => {
	const smalls = [];
	const bigs = [];
	for (let r = 0; r < 3; r += 1) {
		smalls.push(callMs(fn, base, jitter));
		bigs.push(callMs(fn, base * 2, jitter));
	}
	return Math.min(...bigs) / Math.min(...smalls);
};

/** The estimator §13.55 replaced — kept here so the regression is demonstrable. */
const oldEstimator = (fn, base, jitter) => {
	const ratios = [];
	for (let r = 0; r < 3; r += 1) {
		ratios.push(callMs(fn, base * 2, jitter) / callMs(fn, base, jitter));
	}
	return Math.min(...ratios);
};

const THRESHOLD = 3;
const JITTER = 2;
const TRIALS = 12;

let oldMissed = 0;
let newMissed = 0;
let newFalseAlarm = 0;
for (let t = 0; t < TRIALS; t += 1) {
	if (oldEstimator(quadratic, 3100, JITTER) <= THRESHOLD) oldMissed += 1;
	if (newEstimator(quadratic, 3100, JITTER) <= THRESHOLD) newMissed += 1;
	if (newEstimator(linear, 400000, JITTER) > THRESHOLD) newFalseAlarm += 1;
}

console.log('guard-check: threshold ' + THRESHOLD + ', jitter ' + JITTER + 'x one-sided, ' + TRIALS + ' trials each');
console.log('  quadratic  missed by min-of-ratios: ' + oldMissed + '/' + TRIALS
	+ (oldMissed > TRIALS / 2 ? '   (this is the §13.55 bug — the estimator is blind)' : ''));
console.log('  quadratic  missed by min/min:        ' + newMissed + '/' + TRIALS);
console.log('  linear     false alarms (min/min):   ' + newFalseAlarm + '/' + TRIALS);

// The guard must (a) catch a real quadratic most of the time and (b) not cry wolf on
// linear code. Both bounds are loose because this measures wall time; the point is to
// fail loudly if the estimator regresses, not to certify a statistic.
//
// The decisive assertion is the COMPARISON, not either absolute number: if the current
// estimator misses at least as often as the one §13.55 replaced, the fix has been
// undone or neutralised and the guard is blind again. An absolute bound alone could
// not see that — replacing newEstimator with oldEstimator still scored 3/12 on one
// run, comfortably under a "> half" rule, because the two estimators draw different
// random jitter and the whole measurement is noisy.
if (newMissed >= oldMissed && oldMissed > 0) {
	console.error('guard-check: FAIL — the current estimator is no better than the pre-§13.55 one ('
		+ newMissed + '/' + TRIALS + ' vs ' + oldMissed + '/' + TRIALS + ' missed); the guard is blind again');
	process.exit(1);
}
if (newMissed > TRIALS / 2) {
	console.error('guard-check: FAIL — the current estimator misses a real O(n^2) more often than it catches it');
	process.exit(1);
}
if (newFalseAlarm > 2) {
	console.error('guard-check: FAIL — too many false alarms on linear code; the threshold or the estimator drifted');
	process.exit(1);
}
console.log('guard-check: OK — the estimator separates the two complexities');
console.log('  (the comparison against the old estimator is what would catch a regression; the');
console.log('   absolute numbers alone are too noisy to rely on)');
