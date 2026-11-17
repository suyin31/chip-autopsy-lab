#!/usr/bin/env python3
"""Minimal stdio MCP server that lets Kiro delegate work to Gemini 4 Carbon via the Antigravity CLI (agy).
Tools:
  carbon_task(prompt, cwd, model?) - Carbon works as a coding agent inside cwd (can read/edit files), returns its summary.
  carbon_ask(prompt, model?)       - plain question/answer, no file access.
All traffic goes out through the user's VPS (viavps.sh).
"""
import json, subprocess, sys, os

VIA = os.environ.get("AGY_WRAPPER", "/workspace/work/bin/viavps.sh")
DEFAULT_MODEL = "gemini-4-carbon-high"
TIMEOUT = 3600

TOOLS = [
    {
        "name": "carbon_task",
        "description": "Delegate a coding task to Gemini 4 Carbon (High). Carbon runs as an agent inside the given project directory, can read and edit files and run commands, then returns a summary of what it changed. Use for implementing spec tasks, writing design docs, hard debugging.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Full task instructions, including which spec task to implement and acceptance criteria."},
                "cwd": {"type": "string", "description": "Absolute path of the project directory Carbon works in."},
                "model": {"type": "string", "description": "Optional agy model id, default gemini-4-carbon-high."},
            },
            "required": ["prompt", "cwd"],
        },
    },
    {
        "name": "carbon_ask",
        "description": "Ask Gemini 4 Carbon (High) a question or have it draft text (spec sections, copy, reviews). No file access.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "model": {"type": "string"},
            },
            "required": ["prompt"],
        },
    },
]


def run_agy(prompt, cwd=None, model=None, agentic=False):
    cmd = [VIA, "agy", "-p", prompt, "--model", model or DEFAULT_MODEL]
    if agentic:
        cmd += ["--dangerously-skip-permissions", "--add-dir", cwd]
    try:
        r = subprocess.run(cmd, cwd=cwd or "/tmp", capture_output=True, text=True, timeout=TIMEOUT)
        out = (r.stdout or "").strip()
        if r.returncode != 0:
            out += "\n[agy exit %d] %s" % (r.returncode, (r.stderr or "")[-2000:])
        return out[-60000:] or "(no output)"
    except subprocess.TimeoutExpired:
        return "[carbon timed out after %ds]" % TIMEOUT


def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        mid = req.get("id")
        method = req.get("method")
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": req.get("params", {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "carbon", "version": "0.1.0"}}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            p = req.get("params", {})
            a = p.get("arguments", {}) or {}
            if p.get("name") == "carbon_task":
                cwd = a.get("cwd") or os.getcwd()
                text = run_agy(a["prompt"], cwd=cwd, model=a.get("model"), agentic=True)
            elif p.get("name") == "carbon_ask":
                text = run_agy(a["prompt"], model=a.get("model"))
            else:
                send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "unknown tool"}})
                continue
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}]}})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif mid is not None:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}})


if __name__ == "__main__":
    main()
