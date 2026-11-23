# Requirements: Judging Polish (Kiroween 2026)

## Introduction

This round improves the submission against the Kiroween 2026 judging criteria (Potential Impact, Technological Implementation, Design, Innovation, Presentation) without changing product UI code. It covers the written submission, the Kiro artifacts in `.kiro/`, and the logs that back them. Source of the criteria: the owner's prompt for this round, `logs/prompt-judging-polish.txt`.

Out of scope: anything under `src/app/`, `src/ui/`, `public/`, deployment config, `package.json`, and the lockfile.

## Requirement 1: Judging self-review

**User Story:** As the project owner, I want a scored review against each judging criterion and judge quote, so that I know where the submission is weakest before the deadline.

#### Acceptance Criteria

1. THE review SHALL score each of the 5 criteria and each quoted judge remark from 1 to 5.
2. THE review SHALL cite at least one repo path, commit, or log file as evidence for every score.
3. THE review SHALL name one concrete gap per row.
4. THE review SHALL stay under 120 lines in `docs/judging-review.md`.

## Requirement 2: Accurate Kiro artifacts

**User Story:** As a judge checking Kiro usage, I want the hooks and steering to match the repo as it is today, so that the artifacts read as maintained rather than stale.

#### Acceptance Criteria

1. THE i18n parity hook SHALL cover every locale file present in `src/core/i18n/messages/` (`en`, `zh-cn`, `zh-tw`, `ja`, `ko`).
2. THE repo SHALL add at most two new hooks, each in the same JSON format as the existing `.kiro/hooks/*.kiro.hook` files.
3. WHEN `.kiro/specs/**/design.md` is edited, a hook SHALL run the `fast-check` property suites so a property change is checked against the code.
4. A user-triggered hook SHALL rebuild the "How Kiro was used" table from the contents of `.kiro/` and the test suite.
5. THE repo SHALL include `.kiro/steering/submission.md` with rules for submission copy: truthful, traceable to a file, the Vercel URL as the only live demo, and coverage of all 5 criteria.

## Requirement 3: Submission write-up

**User Story:** As a judge, I want to read how Kiro built the project, with one example I can trace in the repo, so that I can score Technological Implementation without guessing.

#### Acceptance Criteria

1. THE "How Kiro was used" section of `docs/devpost-submission.md` SHALL open with a short process story (spec, steering, hooks, agent tasks, verification) and one example naming a real requirement id, its task, its property test, and the hook that runs it.
2. THE Kiro table SHALL state test and property counts that match a `pnpm test` run from this round.
3. THE section SHALL include "Where Kiro surprised us" with 2 or 3 items, each quoting a file in `logs/` or a commit.
4. THE section SHALL state in one line that some UI exploration used other agents, while specs, steering, hooks, and verification ran in Kiro.
5. THE Impact copy SHALL name the user (ATE, test, and yield engineers), the pain (opening STDF binaries needs licensed desktop tools or custom scripts), and the result in one sentence.
6. IF a fact cannot be traced to a file, commit, or log, THEN the copy SHALL carry a line starting `TODO(owner):` instead of the claim.

## Requirement 4: README and log

**User Story:** As a judge landing on the repository, I want a short pointer to the Kiro artifacts, so that I find them in one click.

#### Acceptance Criteria

1. `README.md` SHALL have a short "Built with Kiro" section linking `.kiro/` and `docs/devpost-submission.md`.
2. THE README and submission SHALL contain no Netlify links.
3. `pnpm test` SHALL pass after the round, and `logs/progress.md` SHALL gain 3 to 6 lines describing it.
