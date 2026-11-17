# Chip Autopsy Lab

Browser-based semiconductor failure analysis tool for Kiroween 2026 (Frankenstein category): drop in an STDF V4 wafer test log to get a one-sentence cause of death with every claim linked to dies, bins, and parametric charts.

**Status**: Phase 1: product steering and requirements only. No application code yet.

## Planned Capabilities
- Parse STDF V4 binary logs (`.stdf`, `.std`, and gzip variants detected by `1F 8B` magic bytes) in a browser Web Worker.
- Render Pass/Fail, HBIN, and SBIN wafer maps, stacked multi-wafer fail heatmaps, bin Pareto charts, and lot/wafer/site yield summaries (first-pass, final, and retest counts).
- Plot parametric histograms with limits, capability statistics (`n`, mean, sigma, `Cp`, `Cpk`), and parametric wafer heatmaps.
- Classify spatial failure signatures into the 9 WM-811K classes with confidence scores and hedged cause hypotheses.
- Produce a verdict-first Autopsy Report (deterministic offline template by default; optional LLM rephrasing citing engine fact IDs) where clicking any claim highlights its dies and Pareto bars.
- Filter all views via live wafer-map brushing or the `Cmd-K` / `Ctrl-K` natural-language command palette, and ship seeded synthetic demo lots (`Edge-Ring` and `Scratch`) one click from the empty state.

## Privacy (Local-First)
Parsing and analysis run entirely in the browser. Raw STDF files never leave the device; the optional LLM narrator receives aggregate engine facts only.

## Built with Kiro

| Kiro feature | How this repo uses it |
|---|---|
| Steering files (`.kiro/steering/*.md`) | Always-included rules for product scope, tech constraints and STDF V4 rules, UI design tokens, and repo layout |
| Spec (`.kiro/specs/chip-autopsy-lab/`) | Spec-driven development: `requirements.md` in phase 1; `design.md` and `tasks.md` in phase 2 |
| Carbon MCP server (`.kiro/settings/mcp.json`, `tools/carbon-mcp/`) | Local MCP server delegating drafting and review tasks to Gemini via the `agy` CLI, with phase logs recorded in `logs/` |

## Repository Layout
See [`.kiro/steering/structure.md`](.kiro/steering/structure.md) for the current phase-1 file tree and proposed `src/` module architecture.

## Third-Party Code and Data
No third-party application code or external dataset is used yet. Any permissively licensed code or dataset reused in later phases will be disclosed here.

## License
MIT. See [`LICENSE`](LICENSE).
