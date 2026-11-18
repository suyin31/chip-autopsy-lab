#!/bin/bash
# usage: premium_step.sh <N> [cont]  — run premium task PN with Opus 5.5
cd "$(dirname "$0")/.." || exit 1
N=$1; C=$2
if [ -n "$C" ]; then EXTRA="A previous session on P$N timed out partway; check git diff HEAD~1 and the code, then finish what is missing."; fi
cat > logs/prompt-p$N.txt <<EOT
Implement task P$N of the "## Premium pass" section in .kiro/specs/chip-autopsy-lab/tasks.md, exactly as specified in .kiro/specs/chip-autopsy-lab/premium.md (the sections and acceptance items the task cites; premium.md overrides redesign.md for visuals and interaction). $EXTRA
Read first: the task text, the cited premium.md sections, .kiro/skills/make-interfaces-feel-better/SKILL.md, and the code you will touch. Make no taste decisions of your own; if premium.md is silent, choose the most restrained option and note it in logs/progress.md.
Scope: only P$N. Keep existing behaviour and tests working; update or add tests where the task changes behaviour or DOM. Keep all 5 locales in parity.
Verify before finishing: pnpm typecheck, pnpm lint, pnpm test (all must pass). E2E is slow on this machine: run only the e2e spec files relevant to this task (pnpm e2e <file>), never the full suite; perf-gate and linked-interactions-r7 timing flakes are known, ignore them. If e2e visual snapshots change because of intended design changes, update them with --update-snapshots.
Then tick P$N in tasks.md and append 2-4 lines to logs/progress.md (what changed, test counts, any decision). Be efficient; do not refactor beyond the task. No web fetch.
EOT
../../repos/chip-autopsy-lab/tools/kiro_cli_step.sh "$PWD" p$N${C:+-cont} logs/prompt-p$N.txt claude-opus-5.5
grep -n "\] P$N\." .kiro/specs/chip-autopsy-lab/tasks.md
