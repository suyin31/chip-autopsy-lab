#!/bin/bash
# usage: agy_step.sh <label> <prompt-file> [model]  — run a coding step in Antigravity CLI (agy), default Gemini 4 Neon High
cd "$(dirname "$0")/.." || exit 1
L=$1; P="$(cat "$2")"; M=${3:-gemini-4-neon-high}
timeout 1150 /workspace/work/bin/viavps.sh agy -p "$P" --model "$M" --dangerously-skip-permissions --add-dir "$PWD" > logs/$L.log 2>&1
echo EXIT $?
git add -A && git -c user.name="Lingfeng Zhang" -c user.email="syin6224@gmail.com" commit -qm "$L (agy $M)" && echo committed
tail -4 logs/progress.md
