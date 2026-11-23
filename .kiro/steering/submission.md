---
inclusion: fileMatch
fileMatchPattern: ["docs/**/*.md", "README.md"]
---

# Submission Copy Rules

Applies to `docs/devpost-submission.md`, `docs/judging-review.md`, `README.md`, and any other text a Kiroween judge reads.

## Truth and traceability
- Every fact, number, date, and anecdote must trace to a file, a commit, or a `logs/*.log` file in this repo. Name the source next to the claim when a judge would want to check it.
- Counts (tests, test files, property suites, e2e specs, hooks, skills) come from a run or a `find` made in the same session. Do not copy an old count forward.
- If a fact cannot be traced, write a line starting `TODO(owner):` instead of the claim.
- Quotes in "Where Kiro surprised us" must exist verbatim in the cited log.

## Attribution
- Kiroween rule: work done through another harness does not count as using Kiro. Lead with what Kiro's own agent did: specs, steering, hooks, task runs, reviews, verification.
- Name other agents where `logs/progress.md` or commit messages name them (for example, tasks 12 and 13 credit Antigravity CLI). Do not claim their work as Kiro's, and do not inflate their role either.

## Links
- The only live demo is https://chip-autopsy-lab.vercel.app. Netlify is retired; never add a Netlify link or badge.
- Repository: https://github.com/suyin31/chip-autopsy-lab. Video: the link already in `docs/devpost-submission.md`.

## Coverage of the judging criteria
- Cover all five criteria with balanced weight: Potential Impact, Technological Implementation (Kiro usage), Design, Innovation, Presentation. Over-indexing on one criterion hurts.
- Impact names the user (ATE, test, and yield engineers at small fabless teams and OSATs), the pain, and the result in one sentence each.
- Technological Implementation shows the process (spec, steering, hooks, agent tasks, verification) with at least one example a judge can trace from requirement id to task to property test to hook.

## Style
- Plain English, short declarative sentences, sentence case. No hype words (revolutionary, seamless, cutting-edge, game-changing, robust, leverage, delve).
- Keep the Halloween framing to the existing autopsy phrases.
