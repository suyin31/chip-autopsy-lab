#!/bin/bash
# usage: redesign_step.sh <repo> <R-number e.g. R1> [model]
cd "$1" || exit 1
R=$2; M=${3:-gemini-4-carbon-high}
P="You are implementing task $R of the Redesign section of .kiro/specs/chip-autopsy-lab/tasks.md. The full spec is .kiro/specs/chip-autopsy-lab/redesign.md — read it fully (especially the sections $R cites) and follow it exactly: tokens, sizes, copy, motion parameters. Before coding, read .agent/skills/apple-design/SKILL.md, .agent/skills/make-interfaces-feel-better/SKILL.md, .agent/skills/animation-performance/SKILL.md, .agent/skills/test-driven-development/SKILL.md and .agent/skills/verification-before-completion/SKILL.md, plus .kiro/steering/*.md. Implement only $R. Write production-quality original TypeScript; keep core free of React. Run pnpm typecheck, pnpm lint and pnpm test (vitest) and fix until green; update tests that lock old design values to the new spec values (never weaken accessibility checks). When done, tick '- [ ] $R.' to '- [x]' in tasks.md and append 3-5 lines to logs/progress.md (what was built, test counts, anything deferred). No web search. Stay within 15 minutes; if unfinished, leave the tree compiling and write exactly what remains in logs/progress.md."
timeout 1100 /workspace/work/bin/viavps.sh agy -p "$P" --model "$M" --dangerously-skip-permissions --add-dir "$PWD" > logs/redesign-$R.log 2>&1
echo EXIT $?
git add -A && git -c user.name="Lingfeng Zhang" -c user.email="syin6224@gmail.com" commit -qm "Redesign $R (Carbon)" && echo committed
tail -5 logs/progress.md
