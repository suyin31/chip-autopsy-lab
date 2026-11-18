#!/bin/bash
# usage: kiro_cli_step.sh <repo> <label> <prompt-file> [model]  — run a step in Kiro CLI (uses Kiro credits)
cd "$1" || exit 1
L=$2; P="$(cat "$3")"; M=${4:-claude-sonnet-5}
timeout 1100 /workspace/work/bin/viavps.sh kiro-cli chat --no-interactive --trust-all-tools --model "$M" "$P" > logs/$L.log 2>&1
echo EXIT $?
git add -A && git -c user.name="Lingfeng Zhang" -c user.email="syin6224@gmail.com" commit -qm "$L (Kiro $M)" && echo committed
tail -4 logs/progress.md
