# Copy suggestions from Kiro (judging-polish), not applied. Pickle owns README/Devpost copy.

```diff
diff --git a/README.md b/README.md
index 245b197..2a3f0ce 100644
--- a/README.md
+++ b/README.md
@@ -122,6 +122,14 @@ Chip Autopsy Lab is local-first by design:
   - **Request-body scan** (`e2e/gates-t20.spec.ts` and `src/core/report/llm-payload-privacy.prop.test.ts`): asserts no outbound request body contains STDF `FAR` headers, gzip magic bytes, die IDs, or per-die coordinate/measurement fields.
   - **Bundle secret scan** (`pnpm scan:secrets` via `tools/scan-bundle-secrets.mjs`) and an ESLint rule (`eslint.config.mjs`) blocking any `NEXT_PUBLIC_LLM_*` reference.
 
+## Built with Kiro
+
+Kiro's agent wrote the steering (`logs/phase1.log`) and the task list (`logs/kiro-tasks.log`), reviewed the spec (`logs/kiro-review-req.log`), and ran tasks with the checks recorded in `logs/progress.md`. Some drafts and tasks went to other models; the submission spells out the split.
+
+- Kiro artifacts: [`.kiro/`](.kiro/) (specs, steering, hooks, skills, MCP settings)
+- Process story, a traced example, and "Where Kiro surprised us": [`docs/devpost-submission.md`](docs/devpost-submission.md#how-kiro-was-used)
+- Self-review against the judging criteria: [`docs/judging-review.md`](docs/judging-review.md)
+
 ## How Kiro was used
 
 | Kiro feature | Where in repo | How it shaped the project |
@@ -138,13 +146,15 @@ Development followed a strict spec -> tasks -> agent implementation -> verificat
 
 ### Hooks
 
-Agent hooks in `.kiro/hooks/` run on file save:
+Agent hooks in `.kiro/hooks/` run on file save, or on demand for the last one:
 
 | Hook file | Trigger | What the agent does |
 |---|---|---|
 | `lint-typecheck-on-save.kiro.hook` | `src/**/*.ts`, `src/**/*.tsx` | Runs ESLint on the saved file and `pnpm typecheck`, then fixes errors the change introduced. |
 | `core-unit-tests-on-save.kiro.hook` | `src/core/**/*.ts` | Runs the colocated `*.test.ts` and `*.prop.test.ts` suites and fixes the source or updates the tests. |
-| `i18n-key-parity-on-save.kiro.hook` | `src/core/i18n/**`, `src/ui/i18n/**` | Runs `src/core/i18n/i18n.test.ts` and checks that `en`, `zh-CN`, and `zh-TW` have matching keys and placeholders. |
+| `i18n-key-parity-on-save.kiro.hook` | `src/core/i18n/**`, `src/ui/i18n/**` | Runs `src/core/i18n/i18n.test.ts` and checks that `en`, `zh-CN`, `zh-TW`, `ja`, and `ko` have matching keys and placeholders. |
+| `spec-properties-on-design-edit.kiro.hook` | `.kiro/specs/**/design.md` | Runs all 16 `*.prop.test.ts` suites and reports any design property without a matching test. |
+| `kiro-usage-table-refresh.kiro.hook` | Manual (user-triggered) | Recounts `.kiro/` artifacts and tests and rewrites the Kiro usage tables in this README and the submission. |
 
 ## Real-data accuracy (WM-811K)
 
diff --git a/docs/devpost-submission.md b/docs/devpost-submission.md
index 58fda90..77b44d2 100644
--- a/docs/devpost-submission.md
+++ b/docs/devpost-submission.md
@@ -23,7 +23,7 @@ Test-floor data, academic research, generative AI, and the web rarely meet. Stit
 
 ## Inspiration
 
-I'm an IC design undergraduate training as an ATE test engineer. When a wafer lot comes back with bad yield, a small team's workflow is a Python script, an Excel export, and matplotlib, repeated for every wafer. Enterprise yield tools cost too much for small fabless teams and students. The free browser viewers draw wafer maps and Pareto charts, but they leave the diagnosis to you. I wanted a tool that reads the raw STDF log and tells you what killed the wafer, with proof one click away.
+I'm an IC design undergraduate training as an ATE test engineer. The users are ATE, test, and yield engineers at small fabless teams and OSATs, plus students learning wafer sort. When a lot comes back with bad yield, opening its STDF binary means a licensed enterprise yield tool or a custom Python script, then Excel and matplotlib for every wafer. The free browser viewers draw wafer maps and Pareto charts but leave the diagnosis to you. Chip Autopsy Lab reads the raw STDF log in the browser and opens with the cause of death, with the dies that prove it one click away.
 
 ## What it does
 
@@ -54,7 +54,7 @@ I wrote the spec first in Kiro: EARS requirements, a design with 14 correctness
 ## Accomplishments that we're proud of
 
 - 97.8% accuracy and macro-F1 0.885 on 51,886 held-out real WM-811K wafers.
-- 474 unit and property tests in 82 files, including 16 `fast-check` suites that cover all 14 spec properties, plus 54 Playwright spec files.
+- 542 unit and property tests in 90 files, including 16 `fast-check` suites that cover all 14 spec properties, plus 54 Playwright spec files.
 - Automated gates for privacy (no third-party requests, no STDF bytes in any request body) and for secrets in the client bundle.
 - A judge can open the live demo and reach a linked verdict with no install and no API key.
 
@@ -80,16 +80,49 @@ typescript, next.js, react, tailwindcss, canvas, web-workers, comlink, zustand,
 
 ## How Kiro was used
 
+### From spec to verified code
+
+Kiro's agent ran the build loop from the IDE. Every step left a file in this repo.
+
+1. **Spec.** The spec has 17 EARS requirements, a design with 14 correctness properties, and a task list where every task cites its requirement ids. Kiro sent the first requirements and design drafts to Gemini through the Carbon MCP tool (`logs/phase2.log`, commits `af42af8`, `9076b54`), then reviewed them itself: one pass made 48 edits to `requirements.md` (`logs/kiro-review-req.log`), and another wrote `tasks.md` (`logs/kiro-tasks.log`, commit `e8af9c1`).
+2. **Steering.** Four always-included files hold the product scope, the locked stack and STDF V4 decoding rules, the repo layout, and the design tokens. A fifth, `submission.md`, loads only when submission copy is edited.
+3. **Hooks.** Saving a file under `src/` runs lint and typecheck. Saving under `src/core/` runs that file's unit and property tests. Saving an i18n file checks key parity across all 5 locales. Editing a spec `design.md` reruns every property suite. One manual hook rebuilds the table below from `.kiro/`.
+4. **Agent tasks.** Tasks ran one at a time. Each prompt is in `logs/prompt-*.txt`, each run log is in `logs/`, and each result is in `logs/progress.md`. In `git log`, 58 commit messages are tagged `(Kiro <model>)` and 51 are tagged `(Carbon)`, meaning Kiro handed the task to Gemini through the Carbon MCP tool and then checked the result.
+5. **Verification.** A task is ticked only after lint, typecheck, `pnpm test`, and its Playwright spec pass.
+
+One trace you can follow:
+
+- **Requirement 1.5** (`requirements.md`): check that the first record is `FAR` with `STDF_VER = 4`, then read numbers big-endian when `FAR.CPU_TYPE = 1` and little-endian when it is `2`.
+- **Task 2.2** (`tasks.md`) builds `src/core/stdf/stdf-parser.ts` and cites Requirement 1.5. Sub-task 2.4 adds the property test.
+- **Property 1** (`design.md`, "Validates: Requirements 1.3, 1.5, ...") says any generated lot, written in either byte order, parses back to an equal lot model. `src/core/stdf/stdf-roundtrip.prop.test.ts` checks it with `fast-check`.
+- **Hooks.** `core-unit-tests-on-save.kiro.hook` runs that suite whenever a file in `src/core/stdf/` is saved, and it is told never to weaken a design property to make a test pass. `spec-properties-on-design-edit.kiro.hook` runs it again whenever `design.md` changes.
+
+### Kiro features in this repo
+
 | Kiro feature | How it was used here | Artifact |
 |---|---|---|
-| Specs | Requirements, design with 14 correctness properties, and a task list. Every task cites its requirements and must pass lint, typecheck, and tests before it's ticked. Two follow-up specs set the visual and interaction rules. | `.kiro/specs/chip-autopsy-lab/requirements.md`, `design.md`, `tasks.md`, `redesign.md`, `premium.md` |
-| Steering | Always-included rules for product scope, the locked stack and STDF V4 decoding notes, repo layout and core isolation, and design tokens and copy. | `.kiro/steering/product.md`, `tech.md`, `structure.md`, `design-language.md` |
-| Hooks | On save of a `src/**/*.ts(x)` file: ESLint plus typecheck, then fix what the change broke. | `.kiro/hooks/lint-typecheck-on-save.kiro.hook` |
-| Hooks | On save of a `src/core/**/*.ts` file: run its colocated unit and property tests, and never weaken a design property to pass. | `.kiro/hooks/core-unit-tests-on-save.kiro.hook` |
-| Hooks | On save of an i18n file: check key and placeholder parity between `en`, `zh-CN`, and `zh-TW`. | `.kiro/hooks/i18n-key-parity-on-save.kiro.hook` |
-| Agent coding | Spec-driven tasks, then agent implementation, then verification, with every prompt and run log kept. Some tasks were drafted by Gemini through the MCP server below, then verified in Kiro. | `logs/progress.md`, `logs/prompt-*.txt`, `logs/*.log` |
-| Agent skills | Reusable skills for accessibility, animation performance, test-driven development, debugging, verification, and Playwright testing. | `.kiro/skills/` |
-| Property-based tests | Each of the 14 spec properties has a `fast-check` suite beside its source, from STDF round-trip to LLM payload privacy. | `src/core/**/*.prop.test.ts`, `src/ui/**/*.prop.test.ts` |
-| MCP | A local stdio server exposing `carbon_task` and `carbon_ask`, which let Kiro hand drafting and review turns to another model. | `.kiro/settings/mcp.json`, `tools/carbon-mcp/carbon_mcp.py` |
-
-TODO: total build hours and video length, if Devpost asks. Neither is recorded in the repo.
+| Specs | Main spec: requirements, design with 14 correctness properties, a task list, and two follow-up specs for visual and interaction rules. A small spec for this submission polish round. | `.kiro/specs/chip-autopsy-lab/` (`requirements.md`, `design.md`, `tasks.md`, `redesign.md`, `premium.md`), `.kiro/specs/judging-polish/` |
+| Steering, always included | Product scope, the locked stack and STDF V4 notes, repo layout and core isolation, design tokens and copy rules. | `.kiro/steering/product.md`, `tech.md`, `structure.md`, `design-language.md` |
+| Steering, file match | Rules for submission copy: traceable facts, Vercel as the only demo link, all 5 judging criteria. Loads for `docs/**/*.md` and `README.md`. | `.kiro/steering/submission.md` |
+| Hook, on save | `src/**/*.ts(x)`: ESLint plus typecheck, then fix what the change broke. | `.kiro/hooks/lint-typecheck-on-save.kiro.hook` |
+| Hook, on save | `src/core/**/*.ts`: run the colocated unit and property tests; never weaken a design property. | `.kiro/hooks/core-unit-tests-on-save.kiro.hook` |
+| Hook, on save | i18n files: key and placeholder parity across `en`, `zh-CN`, `zh-TW`, `ja`, and `ko`. | `.kiro/hooks/i18n-key-parity-on-save.kiro.hook` |
+| Hook, on save | `.kiro/specs/**/design.md`: run all 16 property suites and report any property without a matching test. | `.kiro/hooks/spec-properties-on-design-edit.kiro.hook` |
+| Hook, manual | Recount specs, steering, hooks, skills, and tests, and rewrite this table. | `.kiro/hooks/kiro-usage-table-refresh.kiro.hook` |
+| Agent tasks | One prompt and one run log per task, results and test totals per task in the progress log. | `logs/prompt-*.txt`, `logs/*.log`, `logs/progress.md` |
+| Agent skills | 14 skills, including accessibility, animation performance, test-driven development, systematic debugging, verification before completion, and Playwright testing. | `.kiro/skills/` |
+| Property-based tests | 16 `fast-check` suites: 14 cover the 14 design properties, from STDF round-trip to LLM payload privacy, and 2 cover UI palette and sheen math. | `src/core/**/*.prop.test.ts`, `src/ui/**/*.prop.test.ts` |
+| Test totals | `pnpm test`: 542 tests in 90 files (run of 2026-11-23 recorded in `logs/progress.md`). 54 Playwright spec files in `e2e/`. | `logs/progress.md` |
+| MCP | A local stdio server with `carbon_task` and `carbon_ask`, so Kiro could hand a drafting or review turn to another model and read the result back. | `.kiro/settings/mcp.json`, `tools/carbon-mcp/carbon_mcp.py` |
+
+### Where Kiro surprised us
+
+- **It found that our spec broke its own rules.** Reviewing `requirements.md`, Kiro reported: "the spec said it must be a single sentence, but its own example is two sentences." In the same pass it caught a privacy leak in the design: "the URL stored the Wafer ID, a string from the STDF file, which the privacy rule forbids. It now stores a wafer index." (`logs/kiro-review-req.log`)
+- **It explained why our fixes seemed to change nothing.** During redesign task R8, Kiro found: "Playwright serves the existing production build from `.next` and rebuilds only if that build is missing. Until you run `pnpm build`, `pnpm e2e` tests old code." It then traced the remaining slow frame to the wafer-strip ArrowRight handler: "It spends 31 ms in script and 8 ms forcing a layout". (`logs/redesign-R8-kiro.log`)
+- **It told us what it had not checked.** After writing the first three hooks, Kiro said: "I haven't watched them fire in Kiro, and I wrote the hook format from memory without checking it against the Kiro docs." It also noted that the parity test covered `ja` and `ko` while the hook named only the two Chinese tables. This round fixed that hook. (`logs/t22-hooks.log`)
+
+### Other agents
+
+Some UI exploration and some tasks used other agents: Gemini through the Carbon MCP tool (51 `(Carbon)` commits), Antigravity CLI for tasks 12 and 13 (`logs/progress.md`), and a second design review by Opus 4.6 (commit `a96ab93`). The steering, the hooks, the spec reviews, the task list, and the verification of every task ran in Kiro.
+
+TODO(owner): total build hours and video length, if Devpost asks. Neither is recorded in the repo.
```
