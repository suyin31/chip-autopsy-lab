#!/bin/bash
# usage: redesign_cont.sh <repo> <R-number>  — continue an interrupted redesign step
cd "$1" || exit 1
R=$2
TSC=$(npx tsc --noEmit 2>&1 | head -15)
cat > logs/prompt-$R-cont.txt <<EOP
Continue Redesign task $R in .kiro/specs/chip-autopsy-lab/tasks.md (spec: .kiro/specs/chip-autopsy-lab/redesign.md). A previous run was interrupted by timeout partway; its work is committed. First read .agent/skills/verification-before-completion/SKILL.md and .agent/skills/apple-design/SKILL.md. Audit the current code against every bullet and acceptance check of $R, finish what is missing, and fix any errors. Current typecheck output (may be empty):
$TSC
Run pnpm typecheck, pnpm lint, pnpm test until green. Then tick '- [ ] $R.' in tasks.md and append 2-4 lines to logs/progress.md. Do not start the next task. No web search. Finish within 13 minutes; if still unfinished, leave it compiling and write exactly what remains in logs/progress.md.
EOP
tools/kiro_step.sh "$PWD" redesign-$R-cont logs/prompt-$R-cont.txt ${3:-}
