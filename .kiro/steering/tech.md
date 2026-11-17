---
inclusion: always
---

# Tech Stack and Constraints

Stack locked in phase 2 from the research in `docs/oss-references.md`. The spec `design.md` follows this table; change a row only with a recorded reason.

## Locked Stack

| Area | Decision | Reason |
|---|---|---|
| Language | TypeScript, `strict` | Compile-time checks on binary offsets, record schemas, and worker messages. |
| Framework | Next.js (App Router) + React; analysis views are client components | A route handler keeps the LLM key server-side and deploys to Vercel in one step; React has the strongest premium component ecosystem (shadcn/ui). |
| Styling | Tailwind CSS v4 with design tokens as CSS variables in `@theme` | The CSS-first theme maps `design-language.md` tokens straight to utilities at zero runtime cost. |
| Components | shadcn/ui on Radix primitives, copied into the repo | MIT code we own and restyle; Radix supplies keyboard, focus, and ARIA behavior. |
| Command palette | `cmdk` (through the shadcn `Command` component) | Linear/Raycast-style keyboard navigation with accessible listbox roles. |
| Motion | CSS transitions for standard UI; Motion (`motion/react`) for springs and layout animation | Panel springs, the wafer-gallery layout collapse, and `useReducedMotion` without hand-rolled physics. |
| Toasts | Sonner | Small, accessible toast queue for parse warnings and downloads, styled with our tokens. |
| Charts | visx (Pareto, histogram, axes, scales) | Low-level D3 primitives in React give full control over dark tokens, hairlines, and tabular numbers. |
| Wafer map | Own Canvas2D renderer with two stacked canvases: base layer (bins or heatmap) and overlay layer (brush, selection, evidence glow) | 10,000 dies draw in under 5 ms, and highlights redraw without repainting the base. Move the base layer to regl (MIT) only if pan/zoom drops below 50 fps at 100,000 dies. |
| STDF parser | Own TypeScript STDF V4 parser running in a Web Worker | No maintained, cleanly licensed JS parser exists, and `@wafertools/testdata-parser` is the competitor's core; owning it keeps the code original. |
| Worker bridge | Comlink (Apache-2.0) over a module Web Worker | Typed async calls into the worker, zero-copy file hand-off with `Comlink.transfer`, and progress callbacks with `Comlink.proxy`. |
| Gzip | Native `DecompressionStream('gzip')`, no fallback library | Every target browser and Node (for tests) ships it; zero bundle cost. |
| State | Zustand | One selection store with fine-grained selectors keeps cross-chart brushing re-renders minimal. |
| Pattern classifier | Deterministic feature-based TypeScript classifier; no ML model and no WM-811K data in the repo | Offline, deterministic, and weightless; using only the WM-811K class names avoids the dataset license question. |
| LLM (narrator and optional Cmd-K translation) | Next.js route handler holding the provider key in a server-side environment variable; the client keeps the deterministic template when no key is configured, the request fails, or citation validation fails | Secrets never reach the browser, and the app stays fully usable offline without a key. |
| Demo STDF | Own TypeScript synthetic STDF writer sharing record schemas with the parser; cross-checked locally with Semi-ATE-STDF (MIT, Python) as an independent reader, never as a dependency | Shared schemas power round-trip property tests, and no open-source synthetic STDF generator exists to reuse. |
| Fonts | `next/font` self-hosting Inter and Geist Mono (OFL-1.1) | Fonts ship with the build, so the page makes no third-party font requests at runtime. |
| Tests | Vitest + `fast-check` for unit and property tests; Playwright for e2e | Fast TypeScript runs, counterexample shrinking, and cross-browser checks. |
| Hosting | Vercel | Runs the Next.js route handler natively and gives judges a live URL with zero setup. |

## Decided Constraints (Stack-Independent)
- **Browser-only analysis**: raw STDF bytes never leave the browser and are never uploaded to any server.
- **Off-main-thread execution**: STDF parsing and heavy analytics run in a Web Worker; no main-thread task may exceed 50 ms during parsing.
- **Framework-free core**: all parsing, data modeling, analytics, pattern classification, query evaluation, and template report logic is deterministic TypeScript with zero React or DOM imports, runnable in Node tests.
- **Property-based testing**: every correctness property defined in the spec gets a `fast-check` property-based test.
- **Untrusted input safety**: STDF strings render strictly as plain text, never HTML; the parser bounds-checks every record and field length before reading.
- **Secret hygiene**: no API keys or secrets in the repository or client bundle; the LLM provider key exists only as a server-side environment variable read by the route handler and never uses a `NEXT_PUBLIC_` prefix.
- **Server surface**: the LLM route handler is the only server code. It accepts engine facts or palette query text only, never STDF bytes or per-die records, and returns text the client validates before display.
- **Browser support**: latest two desktop versions of Chrome, Edge, Firefox, and Safari.
- **Hackathon originality rule**: write new application code only; disclose any reused third-party code (such as `wafermap`, MIT) in `README.md`.

## STDF V4 Notes
- **Record framing**: 4-byte header with `REC_LEN` (`U*2`, data byte length excluding the 4-byte header), `REC_TYP` (`U*1`), and `REC_SUB` (`U*1`).
- **Header and byte order**: after optional gzip decompression (detected via magic bytes `1F 8B` at byte 0), the first record must be `FAR` (`0, 10`) with `STDF_VER = 4`. `FAR.CPU_TYPE`: `1` = big-endian, `2` = little-endian, `0` = DEC VAX (unsupported).
- **Records used**: `FAR`, `MIR`, `MRR`, `PCR`, `HBR`, `SBR`, `SDR`, `WIR`, `WRR`, `WCR`, `PIR`, `PRR`, `PTR`, `MPR`, `FTR`, `TSR`. Skip all other record types by advancing `REC_LEN` bytes.
- **Optional trailing fields**: records may end before the full specification layout; omitted trailing fields decode as missing.
- **`PTR` defaults and `OPT_FLAG`**: fields following `OPT_FLAG` default to values from the first `PTR` sharing the same `TEST_NUM`. `OPT_FLAG` bits 4/5 mark `LO_LIMIT`/`HI_LIMIT` invalid; bits 6/7 indicate no low/high limit.
- **Scaling**: `RESULT` and limits are stored in base units; `RES_SCAL`, `LLM_SCAL`, and `HLM_SCAL` are power-of-10 display exponents only.
- **Multi-site interleaving**: test records (`PTR`, `MPR`, `FTR`) attach to the currently open `PIR` part keyed by `(HEAD_NUM, SITE_NUM)` until closed by `PRR`.
- **`PRR` coordinates and flags**: `X_COORD` or `Y_COORD` of `-32768` means missing coordinate. `PART_FLG` bit 3 = failed, bit 4 = pass/fail flag invalid, bits 0/1 = retest indicator.
- **Retest rule**: when a die is tested more than once on a wafer, its first `PRR` counts toward first-pass yield and its last `PRR` defines final yield and active bin/test state.
- **`WCR` geometry**: provides wafer diameter, die width/height, center coordinates, flat orientation, and `POS_X`/`POS_Y` axis directions.

## Performance Budgets (Targets; Validate During Implementation)
- **Parse throughput**: >= 15 MB/s uncompressed on an Apple M1-class laptop in latest desktop Chrome.
- **File size ceiling**: support up to 200 MB uncompressed in full mode; above 200 MB warn and offer bins-only mode (skip `PTR` decoding).
- **Brush responsiveness**: wafer-map brushing updates all linked charts within 100 ms for 25 wafers x 10,000 dies.
- **Demo time-to-report**: built-in demo lot renders the first Autopsy Report within 3 s.

## Commands
Defined when the Next.js app is scaffolded; record the `dev`, `build`, `lint`, `typecheck`, `test`, and `test:e2e` scripts here.
