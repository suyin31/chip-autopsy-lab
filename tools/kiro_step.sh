#!/bin/bash
# usage: kiro_step.sh <repo> <label> <prompt-file> [model]
cd "$1" || exit 1
L=$2; P="$(cat "$3")"; M=${4:-gemini-4-carbon-high}
timeout 1100 /workspace/work/bin/viavps.sh agy -p "$P" --model "$M" --dangerously-skip-permissions --add-dir "$PWD" > logs/$L.log 2>&1
echo EXIT $?
git add -A && git -c user.name="Lingfeng Zhang" -c user.email="syin6224@gmail.com" commit -qm "$L (Carbon)" && echo committed
tail -8 logs/progress.md
