# Judging self-review (Kiroween 2026)

Scored against the five criteria and the judge remarks in the "Meet the Kiroween judges" email (2026-11-23), as quoted in `logs/prompt-judging-polish.txt`. Scores are 1 (weak) to 5 (strong) and describe the repo before this polish round. Spec for the round: `.kiro/specs/judging-polish/`.

## Criteria

| Criterion | Score | Evidence in the repo | Gap |
|---|---|---|---|
| Potential Impact | 3 | `.kiro/steering/product.md` (target users, today's Python/Excel/matplotlib workflow, competitor table); Inspiration in `docs/devpost-submission.md` | No user evidence outside the author. "What's next" admits no real STDF logs from engineers yet. The Impact copy named the workflow but not the licensed-tool pain in one line. |
| Technological Implementation | 4 | 5 specs files in `.kiro/specs/chip-autopsy-lab/`; 4 steering files; 3 hooks; 14 skills; MCP in `.kiro/settings/mcp.json`; 16 `*.prop.test.ts` suites for 14 design properties; 58 commits tagged `(Kiro ...)` in `git log` | The write-up listed features in a table but told no process story and gave no traceable example. The i18n hook named 3 of 5 locales. No hook ran on spec edits. |
| Design | 4 | `.kiro/specs/chip-autopsy-lab/premium.md`; `logs/premium-acceptance.md` (A1-A40); screenshots in `logs/shots/p35/`; `e2e/acceptance-p35.spec.ts` | Perf gate is flaky on the sandbox (`logs/progress.md`, P34: "2 frames > 50 ms"). CJK glyphs were not checked with real fonts (P35 note). Both need a real-hardware check. |
| Innovation / Idea | 4 | Verdict-first report with claim-to-die links (Requirement 10, Property 10); WM-811K classifier at 97.8 % / macro-F1 0.885 on 51,886 held-out wafers (`logs/wm811k-benchmark.md`); fact-cited LLM narrator (Property 11) | The write-up does not say clearly enough what `tsmap`/`wafermap` lack, so the edge reads as polish rather than a new idea. |
| Presentation | 3 | Video link in `docs/devpost-submission.md`; live demo https://chip-autopsy-lab.vercel.app; five demo moments in `product.md` | Video check done: the Carbon v3 cut is 2:04, public, states the problem at 0:02-0:08 and runs end to end (scene sheet in `work/chip-autopsy-lab-carbon-v3-demo.md`, video https://youtu.be/ynIbq1NvfpU). |

## Judge remarks

| Remark | Score | Evidence | Gap |
|---|---|---|---|
| Geethanjali: "Show me how you used specs, steering and hooks to get there" | 3 | Specs, steering, hooks all present; `logs/progress.md` has 290+ lines of task records; `logs/prompt-*.txt` keeps every prompt | The submission showed the result, not the path. Needs one requirement traced to task, property test, and hook. |
| Geethanjali: "Bonus points if Kiro surprised you" | 1 | Candidate moments exist in `logs/kiro-review-req.log`, `logs/redesign-R8-kiro.log`, `logs/t22-hooks.log` | No "surprised us" section in the submission at all. |
| Sergio: simple, focused solution; clean, intuitive UX | 4 | One filled button per screen and verdict-first rules in `design-language.md`; demo lots load in one click; `e2e/vertical-slice.spec.ts` checks verdict within 3 s | The feature list in "What it does" has 9 bullets; a judge may read breadth, not focus. |
| Dustin: "breadth of knowledge across the Kiro surfaces" | 3 | Specs, steering (always-included), hooks (fileEdited), skills, MCP | Only one hook trigger type and one steering inclusion mode were used. No user-triggered hook, no conditional steering. |
| Dustin: video articulates the problem, shows a working solution | 3 | Same as Presentation | Checked against `product.md`: the cut opens on the problem, then shows drop, verdict, evidence, charts and the agent console on the live site. |
| Devpost tips: be open about how you built it; ambiguity is a red flag | 3 | `logs/progress.md` names Antigravity CLI (Gemini) for tasks 12 and 13; the old table said "Some tasks were drafted by Gemini" | The split between Kiro work and other agents was one vague clause. The FAQ says other harnesses do not count, so the split must be explicit. |
| Devpost tips: requirements first | 4 | Repo public, MIT `LICENSE`, live URL, video link, `.kiro/` committed | `.gitignore` already re-includes `.kiro/` (lines 1-3). Video is public: https://youtu.be/ynIbq1NvfpU. |

## Changes made this round

- Submission copy: Kiro drafted an Impact rewrite, a process story with a traced example (Requirement 1.5 -> task 2.2/2.4 -> Property 1 -> hook), "Where Kiro surprised us", and an attribution line. Not applied; kept as suggestions in `logs/copy-suggestions-judging-polish.md` for the copy owner.
- Kiro surfaces: i18n hook covers all 5 locales; new `fileEdited` hook on `design.md` runs the property suites; new `userTriggered` hook refreshes the Kiro table; new conditional (`fileMatch`) steering `submission.md`.
- README: suggested "Built with Kiro" section and hooks-table fix, also in `logs/copy-suggestions-judging-polish.md`.

## Remaining gaps for the owner

- Real-user evidence for Impact (one quote or test from an engineer), if one exists.
- Video check against the judges' remarks.
- Real-hardware perf gate and CJK font check.
