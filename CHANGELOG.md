# Changelog

## 0.10.0 — 2026-11-22

First npm release of **dsh-trajectory-traceview-plus**, derived from AFAP/dsh-trajectory-traceview v0.3.0 (MIT).

### Included

- Replayable horizontal timeline, minimap, turn navigation, loaded-window search, follow mode and history pagination.
- Stable event anchors and deep links; orphan tool-result stations; clock-axis display.
- Step/tool timing, token usage, prompt changes, raw-request inspection and Markdown export.
- Hardened request matching, streaming projection, malformed-input handling and unique UI identities.
- Accessible named panel region and responsive layouts checked at 390–1440px.
- Unified package/repository identity; corrected contributor build instructions.

### Compatibility and validation

- Requires **DSH 0.2.2-rc.2 exactly** and **Node.js >=24.9.0**; browser-only plugin.
- Build/provenance consistency, smoke regression tests and browser behavior checks were run before release.
- Review history: `docs/DESIGN.md` §§13.28–13.31; upstream attribution: `docs/PROVENANCE.md` and `LICENSE`.
- Manual screen-reader/touch testing and an exhaustive dark-theme contrast audit remain unverified. Automated clipboard checks verify the write path, not OS clipboard read-back.

### Recovery

- Disable/uninstall the Plus bundle if needed. It is a local read-only view and does not own session data.
- A faulty published version requires a new corrected version or npm deprecation; do not rely on npm unpublish as rollback.

Earlier development changes are recorded in `docs/DESIGN.md` and Git tags v0.9.1–v0.9.29.

### Notes on provenance

`docs/PROVENANCE.md` was regenerated after adding this file. The published bundle is byte-identical to the artifacts that passed the full gate run and browser behavior checks recorded in `docs/DESIGN.md` §13.31.
