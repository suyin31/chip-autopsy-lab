# Tasks Phase Log

**Date**: 2026-11-17
**Session**: spec owner (Kiro, claude-opus-5.5), no web fetch, no MCP

## Spec corrections
- Reverted reviewer fix #2 in `design.md`: `PTR` `RESULT`/`LO_LIMIT`/`HI_LIMIT` stay in base units; `RES_SCAL`/`LLM_SCAL`/`HLM_SCAL` are display exponents only (`0.0035` V with `RES_SCAL = 3` displays as `3.5 mV`). Removed the "Conversion Rule" blockquote and restored the base-unit field comments. Kept the OPT_FLAG bit 0/4/5 (inherit) vs 6/7 (no limit) correction from fix #1.
- Kept fixes #1 and #3-#10; also corrected a leftover "5-tier" comment in the design repo layout to "6-tier" (fix #8).
- Added an owner-correction note at the top of `logs/review-design-opus46.md`.
- Applied note D: `site2-probe-contact` added to `.kiro/steering/product.md` demo data, Requirement 3.1, and Property 9 (now also validates Req 7.4).

## tasks.md
- 22 top-level tasks. Vertical slice (demo lot -> worker parse -> Pass/Fail wafer map -> verdict card with die highlight) completes at task 7, with a Playwright checkpoint at task 8.
- Each of the 14 correctness properties is an optional `*` sub-task beside the code it tests (Property 13 URL part sits in stretch task 21).
- LLM narrator (task 16) and Cmd-K (task 17) follow the slice; motion, accessibility, performance/privacy gates, stretch features, and deploy/demo-video prep come last.
