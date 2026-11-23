# Design: Judging Polish

## Overview

Docs and `.kiro/` only. No product code changes, so the existing 14 correctness properties in `.kiro/specs/chip-autopsy-lab/design.md` stay the guard on behavior. This round adds checks on the written claims instead.

## Components

| Component | File | Change |
|---|---|---|
| Self-review | `docs/judging-review.md` | New. One table row per criterion and per judge remark: score, evidence path, gap. |
| i18n hook | `.kiro/hooks/i18n-key-parity-on-save.kiro.hook` | Prompt and description list all 5 locale files. |
| Property hook | `.kiro/hooks/spec-properties-on-design-edit.kiro.hook` | New `fileEdited` hook on `.kiro/specs/**/design.md`; runs every `*.prop.test.ts` with Vitest. |
| Kiro table hook | `.kiro/hooks/kiro-usage-table-refresh.kiro.hook` | New `userTriggered` hook; recounts `.kiro/` artifacts and tests and rewrites the table in `docs/devpost-submission.md` and `README.md`. |
| Submission steering | `.kiro/steering/submission.md` | New. Uses `inclusion: fileMatch` on `docs/**/*.md` and `README.md` instead of `always`, so it loads only when submission copy is edited. |
| Write-up | `docs/devpost-submission.md` | Impact paragraph tightened; "How Kiro was used" rewritten. |
| README | `README.md` | New "Built with Kiro" section; the hooks table gains the two new hooks and the corrected locale list. |

## Traceable example used in the write-up

Requirement 1.5 (`FAR` check and byte order from `FAR.CPU_TYPE`) -> task 2.2 (`stdf-parser.ts`) and sub-task 2.4 -> Property 1 in `src/core/stdf/stdf-roundtrip.prop.test.ts` -> `core-unit-tests-on-save.kiro.hook` runs it on every save under `src/core/`, and the new property hook runs it on every `design.md` edit. All four links are checked against `requirements.md`, `tasks.md`, `design.md` (Property 1 "Validates: Requirements 1.3, 1.5, ..."), and the hook file.

## Hook format

Same keys as the existing hooks: `enabled`, `name`, `description`, `version: "1"`, `when.type`, optional `when.patterns`, `then.type: "askAgent"`, `then.prompt`. Validate with `JSON.parse`.

## Correctness checks for copy

- C1: every count in the Kiro table equals the number from the round's `pnpm test` output or a `find` over the repo.
- C2: every "Where Kiro surprised us" item quotes text that exists verbatim in the cited log (`grep -F`).
- C3: `grep -ri netlify docs/devpost-submission.md README.md` returns nothing.

## Risks

- `pnpm test` may run long on the sandbox. If it does not finish, the counts keep the owner's figure and get a `TODO(owner):` line.
