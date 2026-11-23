# Implementation Plan: Judging Polish

No product code. Each task lists the requirements it covers.

- [x] 1. Write the judging self-review
  - Audit `.kiro/`, `README.md`, `docs/devpost-submission.md`, `logs/progress.md`, and `git log`; score each criterion and judge remark; write `docs/judging-review.md` under 120 lines.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Fix the i18n parity hook
  - Name all 5 locale tables (`en`, `zh-cn`, `zh-tw`, `ja`, `ko`) in `.kiro/hooks/i18n-key-parity-on-save.kiro.hook`.
  - _Requirements: 2.1_

- [x] 3. Add two hooks in the existing JSON format
  - `spec-properties-on-design-edit.kiro.hook` (`fileEdited` on `.kiro/specs/**/design.md`) and `kiro-usage-table-refresh.kiro.hook` (`userTriggered`); check each with `JSON.parse`.
  - _Requirements: 2.2, 2.3, 2.4_

- [x] 4. Add submission steering
  - `.kiro/steering/submission.md` with `fileMatch` on `docs/**/*.md` and `README.md`.
  - _Requirements: 2.5_

- [x] 5. Rewrite the submission's Impact and "How Kiro was used"
  - Process story with the Requirement 1.5 trace, updated table, "Where Kiro surprised us" with quotes checked by `grep -F`, attribution line, `TODO(owner):` for untraceable facts.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Add "Built with Kiro" to the README
  - Link `.kiro/` and `docs/devpost-submission.md`; correct the hooks table; check for Netlify links.
  - _Requirements: 4.1, 4.2_

- [x] 7. Verify and log
  - Run `pnpm test` and `pnpm lint`; append the round to `logs/progress.md`.
  - _Requirements: 3.2, 4.3_
