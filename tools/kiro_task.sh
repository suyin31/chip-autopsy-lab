#!/bin/bash
# usage: kiro_task.sh <repo> <task-number> [model]
cd "$1" || exit 1
N=$2; M=${3:-gemini-4-carbon-high}
P="You are implementing task $N of the Kiro spec .kiro/specs/chip-autopsy-lab/tasks.md (read requirements.md, design.md, and .kiro/steering/*.md first; follow them exactly). Implement task $N and all its sub-tasks, including the optional '*' property-based tests. Write production-quality, original TypeScript. Then run the project's typecheck, lint and tests (pnpm) and fix failures until green. When done, change '- [ ] $N.' and its finished sub-tasks to '- [x]' in tasks.md, and append 3-6 lines to logs/progress.md: task number, what was built, test results, anything deferred. Do not touch other tasks. Do not use web search. Stay within 15 minutes; if not finished, leave the tree compiling and note what remains in logs/progress.md."
timeout 1100 /workspace/work/bin/viavps.sh agy -p "$P" --model "$M" --dangerously-skip-permissions --add-dir "$PWD" > logs/task-$N.log 2>&1
echo EXIT $?
git add -A && git -c user.name="Lingfeng Zhang" -c user.email="syin6224@gmail.com" commit -qm "Task $N (Carbon)" && echo committed
tail -8 logs/progress.md 2>/dev/null
