---
inclusion: always
---

# Product: Chip Autopsy Lab

## Pitch and Frankenstein Fit
Chip Autopsy Lab is a browser-based semiconductor failure analysis tool that ingests STDF V4 wafer test logs and outputs a one-sentence cause of death backed by linked die, bin, and parametric evidence. Built for Kiroween 2026 (Frankenstein category), it stitches together a 1990s binary test format (STDF V4), the WM-811K spatial defect taxonomy, an optional LLM narrator, and a WebGL/Canvas keynote interface into one body.

## Target Users
- Product, test, and yield engineers at small fabless companies and OSATs.
- Electrical engineering students studying wafer sort and yield analysis.
- Hackathon judges evaluating the demo in under 3 minutes with zero setup.

## Problem and Positioning
- **Today's small-team workflow**: run a custom Python script, export to Excel, plot in matplotlib, and repeat manually per wafer.
- **Enterprise platforms** (PDF Solutions Exensio, yieldWerx, Galaxy Examinator, Synopsys SiliconDash): full-featured but cost-prohibitive for small teams.
- **Direct competitor** (`tsmap` / `wafermap`): free, open-source, local browser STDF viewer with wafer maps and Pareto charts, but dumps unlinked charts without a diagnosis.
- **Our edge**: verdict-first Autopsy Report, live linked evidence chain across charts, and keynote-grade narrative and visual finish.

## Table-Stakes Features
1. **Zero-install drag-and-drop parsing**: accepts `.stdf`, `.std`, and gzip-compressed variants (gzip detected by magic bytes `1F 8B`, not filename extension) locally in the browser.
2. **Bin wafer map**: Pass/Fail, HBIN, and SBIN modes; die hover shows X/Y coordinates, bin, and test values; clicking legend items hides bins; pan and zoom.
3. **Stacked multi-wafer fail heatmap**: overlays failures across wafers in a lot to reveal persistent spatial hot spots.
4. **Bin Pareto and yield summary**: first-pass yield, final yield, and retest counts by lot, wafer, and test site.
5. **Parametric analysis**: histograms with low/high test limits, summary stats table (`n`, mean, sigma, `Cp`, `Cpk`), and parametric wafer heat map.

## Differentiators
1. **Verdict-first Autopsy Report**: opens with a one-sentence cause of death (example: `"Cause of death: Edge-Ring failure (confidence 0.91). Yield 82.4%, most loss in SBIN 7."`). All facts and numbers come from the deterministic analysis engine. An offline template report is the default; an optional LLM may only rephrase engine facts and must cite fact IDs on every claim.
2. **Evidence-linked claims**: every report claim binds to dies, bins, tests, or sites. Clicking a claim highlights its dies on the wafer map and its bars in the Pareto chart (unlike Exensio ASD, which gates signature analysis behind an enterprise license without inline claim-to-die linking).
3. **WM-811K spatial pattern classification**: classifies wafers into the 9 WM-811K classes (`Center`, `Donut`, `Edge-Loc`, `Edge-Ring`, `Loc`, `Near-full`, `Random`, `Scratch`, `None`) with confidence scores and hedged cause hypotheses (e.g., `Scratch`: mechanical handling; `Center` or `Edge-Ring`: deposition or etch uniformity; single-site concentration: probe card or tester site rather than process).
4. **Live linked brushing**: brushing a region on the wafer map filters the Pareto, parametric histograms, and summary stats immediately (replacing `wafermap`'s right-click drilldown with real-time cross-filtering).
5. **Cmd-K / Ctrl-K natural-language filter palette**: handles queries like `"only bin 7"`, `"tests with Cpk < 1.33"`, `"edge 3 rings"`, and `"show edge failures with Cpk < 1.33"`. Uses a deterministic offline grammar first, with optional LLM translation into the same validated filter DSL.

## Product Principles
- **Verdict first, evidence one click away**: lead with the primary diagnosis; keep supporting distributions immediately reachable.
- **Every claim traceable to dies**: never display an ungrounded statement or unlinked summary number.
- **Local-first privacy**: parsing and analytics run in the browser; raw STDF bytes never leave the device; the optional LLM receives aggregate facts only.
- **Progressive disclosure**: step cleanly from macro (lot yield, cause of death) to meso (bins, wafer regions, sites) to micro (single die).
- **One Halloween note only**: clinical autopsy framing plus pumpkin orange (`#FF7A1A`) strictly for failures and cause of death.

## Built-in Demo Data
- Ships seeded, deterministic synthetic STDF V4 demo lots (`Edge-Ring` lot and `Scratch` lot).
- Loadable in one click from the empty state, and downloadable as raw files so judges can drag them back into the app.

## Five Demo-Video Moments
1. **Probe-sweep load (~3 s, once per session)**: dropped file lights up dies in probe stepping order while parsing; failing dies turn orange at completion.
2. **Cause-of-death card**: verdict types on (`"Cause of death: Edge-Ring failure (confidence 0.91)"`); clicking it illuminates the outer 3 edge rings and highlights the matching Pareto bar.
3. **25-wafer stack collapse**: wafer gallery collapses into one stacked fail heatmap, surfacing recurring spatial hot spots.
4. **Cmd-K one-liner**: typing `"show edge failures with Cpk < 1.33"` updates wafer map, Pareto, and histogram together.
5. **Workflow split**: 2 hours in Python, Excel, and matplotlib on the left vs 10 seconds to a linked report on the right, ending on one summary line.
- **Optional easter egg (off by default)**: holding `Option` (`Alt`) reveals a radial "autopsy lamp" spotlight mask over the wafer map.

## Hackathon Context and 2025 Lessons
- **Kiroween 2026 (Frankenstein)**: deadline `2026-12-04 14:00 PST`. Judging: 5 x 20% across Impact, Kiro usage, Design, Innovation, and Demo video (< 3 min), plus Best Demo and Best Student Project bonus tracks.
- **Kiroween 2025 lessons**: InteractionKit (1st) solved a concrete pain point and mapped Kiro features in a clear table; UnitSet (2nd) documented deep Kiro usage across specs, steering, hooks, and MCP; SpookBnB (3rd) committed to one sharp dark-mode concept with disciplined motion; Faxi (Best Resurrection) gave judges instant hands-on testing. We apply all four: built-in demo STDF, explicit Kiro usage table, and problem stated in the video's first 15 seconds.

## Non-Goals
- User accounts, cloud sync, or server-side STDF storage.
- Editing STDF records, ATDF text format, or STDF V4-2007 scan record (`STR`, `PSR`) analysis.
- Mobile layouts or replacing an enterprise yield management system.

## Success Criteria
- A judge goes from landing page to reading the cause of death and clicking linked die evidence in under 10 seconds using a built-in demo lot, offline and without an API key.
