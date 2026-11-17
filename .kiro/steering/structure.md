---
inclusion: always
---

# Repository Structure

## Current Layout (Phase 1)
```text
.
├── .kiro/
│   ├── settings/
│   │   └── mcp.json                      # carbon MCP server config
│   ├── specs/
│   │   └── chip-autopsy-lab/
│   │       └── requirements.md           # Phase-1 product requirements (separate task)
│   └── steering/
│       ├── design-language.md            # Visual tokens, typography, motion, interaction rules
│       ├── product.md                    # Product scope, positioning, principles, judging
│       ├── structure.md                  # Current and planned repo layout and conventions
│       └── tech.md                       # Candidate stack, constraints, STDF V4 notes, budgets
├── docs/
│   ├── design-research.md                # Competitive, UX, and Kiroween research brief
│   └── oss-references.md                 # Open-source license and stack reference notes
├── logs/                                 # Prompts, logs, and phase summaries (tracked as Kiro evidence)
├── tools/
│   └── carbon-mcp/                       # MCP server delegating drafting to Gemini via agy CLI
├── .gitignore
├── LICENSE                               # MIT License
└── README.md                             # Phase-1 repository stub
```

## Planned Layout (Proposal, Confirm in Phase 2)
```text
├── src/
│   ├── core/
│   │   ├── stdf/                         # Record framing, field decoders, STDF writer, gzip
│   │   ├── model/                        # Lots, wafers, sites, dies, retest resolution
│   │   ├── analytics/                    # Yield, Pareto, stacking, parametric stats, site analysis, ring index
│   │   ├── patterns/                     # 9-class WM-811K spatial classifier and cause hypotheses
│   │   ├── report/                       # Engine facts, linked claims, template report, LLM adapter
│   │   ├── query/                        # Filter DSL, offline natural-language parser, selection predicates
│   │   └── demo/                         # Seeded deterministic synthetic lot generator
│   ├── workers/                          # Web Worker entrypoints and transferable-buffer bridge
│   └── ui/
│       ├── wafer-map/                    # Die canvas, stacked heatmap, brush, hover readout
│       ├── charts/                       # Bin Pareto, parametric histogram, stats table
│       ├── report/                       # Autopsy Report card and clickable claim highlights
│       ├── command-palette/              # Cmd-K / Ctrl-K filter and action palette
│       ├── layout/                       # App shell, full-window drop zone, empty states
│       └── tokens/                       # CSS variable design tokens
├── public/
│   └── demo/                             # Pre-generated synthetic demo STDF files (if not runtime-only)
├── tests/
│   └── fixtures/                         # Synthetic golden STDF files for parser/writer verification
└── e2e/                                  # Playwright end-to-end specs
```

## Architecture, Naming, and Test Rules
- **Core isolation**: `src/core/` never imports React, DOM APIs, or `src/ui/`.
- **One-way dependency**: `src/ui/` depends on `src/core/` (and `src/workers/`), never the reverse.
- **Single selection source of truth**: one central selection store drives wafer brushing, filter DSL queries, and claim-click highlights across all views.
- **Naming**: filenames and folders use `kebab-case`; React components use `PascalCase`; functions, methods, and variables use `camelCase`.
- **Colocated tests**: unit tests sit beside source files as `*.test.ts`; `fast-check` property-based tests sit beside source files as `*.prop.test.ts`.

## Kiro Conventions
- **Steering**: global project rules live in `.kiro/steering/*.md` with `inclusion: always` front matter.
- **Specs**: one directory per feature in `.kiro/specs/<feature>/` containing `requirements.md`, `design.md`, and `tasks.md`.
- **Hooks**: automated Kiro hooks live in `.kiro/hooks/` (introduced in phase 2+).
- **Phase summaries**: every workflow phase records `logs/phaseN-summary.md` and keeps `logs/` tracked in git.
