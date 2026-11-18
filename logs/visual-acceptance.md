## R4 landing (desktop 1440, checked 13:25)
- Good: big hero, black bg, calm palette, demo cards readable.
- Fix: nav "Open STDF" label is larger (~18px) than the wordmark (15px) and hero button — nav pill text should match §4.11 small size.
- Fix: nav Open STDF duplicates the hero button on landing; consider hiding nav button on empty state (spec check).
- Fix: wafer thumbnails only ~165px in 220px tall media; grow to ~190px and soften the dark card-in-card inset (card inside card border looks boxed).

## R6 loaded stage (2026-11-18 14:58 SGT, edge-ring-etch, 1440x900 & 390x844 @2x)
Overall: pass — wafer is the hero, verdict reads in 1s, colours match spec.
Fix in R8 pass:
(d) Mobile: Pass/Fail/HBIN/SBIN segmented control overlaps top of wafer disc (SBIN label sits on dies). Needs >=12px gap above disc.
(e) Mobile strip shows only "W01" label; other thumbnails unlabeled — show labels for all or none.
(f) Desktop strip: last thumbnail clipped hard at column edge; add fade mask on right edge.
(g) Stat numerals look widely tracked ("2,721"); tighten tracking (-0.02em) on display digits while keeping tabular-nums.
(h) Still open from R4: nav "Open STDF" label larger than wordmark.

## R8 status (verified by e2e/perf-gate.spec.ts visual-acceptance test)
- Fixed: R4 items (nav Open STDF 14px and hidden on landing, 190px thumbnails), (d) mobile HUD moved to top 8px so gap above disc >= 12px, (e) all 25 strip labels, (f) strip right-edge fade mask, (g) stat tracking < 0 with tabular-nums, (h) nav label <= wordmark.

## R8 pass (assistant, 2026-11-18 17:50) — shots logs/shots/r8-*.png, video r8-demo.mp4
- Overall pass. Mobile HUD gap fixed (d), strip right fade present (f), finding click lights cited dies + expands row.
- New minor: selected thumbnail ring (W01) clipped at top on desktop strip; selection label "W01" overlaps ring bottom. Fix in Task 19 polish.
- Stat numerals (light weight) still look slightly loose; recheck tracking -0.02em in Task 19.
