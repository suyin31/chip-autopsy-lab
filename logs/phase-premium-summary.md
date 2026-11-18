# Phase summary: Premium pass (P1–P35)

## What changed
- Tokens and theme (P1–P4): light is the designed default and dark is available. The theme follows Match system and is set before first paint. Inter is the only UI face, with tabular numerals. §12 adds warm paper (`#F6F3EE`), one Instrument Serif accent word, and mono for instrument notes.
- Wafer (P5–P10, P23, P29–P30, P32): the disc is drawn as polished silicon with a bevel, a notch, and a contact shadow or halo. Fail dies are ember and pass tiles are texture only. Evidence lights up in pattern order and the camera flies to it. The magnifier, spring zoom and pan, inertia, and the pointer sheen are in place.
- Layout and clarity (P11–P14, P17–P22, P24–P26b): the landing has a hero wafer and sample tiles. The loaded view puts the verdict first, with plain-language findings, "Where the yield went", and "Yield by test site and wafer". Every screen has one primary button, jargon is defined on hover, Start here hints appear once, and all 5 locales are in parity.
- Motion and audits (P27–P34): the probe sweep runs once per session, the verdict rises in, disclosures never overlap text, the theme cross-fades, the accent and hover audit passes, reduced motion is covered, and the perf gate now includes the theme switch and the sheen sweep.
- Documents (P35): requirements.md 14.2 and 14.3 now name the premium focus ring and evidence rim instead of mint `#7CF2C1`. product.md drops "mobile layouts" from the non-goals (the web app supports 390 px and up).

## Acceptance
- A1–A40 are all marked pass in `logs/premium-acceptance.md` § P35. `e2e/acceptance-p35.spec.ts` (32 tests) captures the 4-viewport x 2-theme matrix and the per-item screenshots in `logs/shots/p35/`.
- Two open caveats, both from this sandbox: A39 (long frames on the software rasteriser; median and p95 pass) and A40 glyph rendering (no CJK system fonts). Re-check both on real hardware before recording the demo video.

## Verification at close
- `pnpm typecheck` and `pnpm lint` are clean. `pnpm test` passes 370/370 (59 files).
- E2E: `acceptance-p35` 32/32, and `landing-p11`, `landing-p26a`, and `loaded-responsive-p13` pass. `perf-gate` fails only its known long-frame step.
