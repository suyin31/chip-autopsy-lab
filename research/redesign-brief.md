# Redesign brief — "apple.com product page" quality (2026-11-18)

User verdict on Task 8 screenshots: not premium, not Apple-like; wants multi-language and fluid, Apple-smooth interaction.

## Diagnosis (what reads as "dev dashboard")
- Too many tiny monospace labels and pill chips (AUTOPSY REPORT, Template · Offline, High · 0.95, 2,552 dies, SBIN 7 …).
- Boxes inside boxes; hairline borders on everything; every claim in its own bordered card.
- Wall of text: claims are long sentences packed with numbers.
- Wafer map is one panel among many, not the hero. Neon mint outlines + orange look gamer, not Apple.
- Header is a toolbar (select + 2 buttons) instead of a calm nav.

## Direction
Think apple.com product page + Apple Pro app (Final Cut / Xcode Instruments) restraint.
1. **One hero per screen.** The wafer is a product shot: large (≥ 560 px), centered or left 7/12, soft radial vignette behind it, subtle top light, no surrounding box.
2. **Typography does the hierarchy.** Inter Display-like settings: verdict 48–56 px, weight 600, tracking -0.02em, line-height 1.08; one emphasized phrase in the accent, rest white 92%. Secondary text #86868B-like (white 56%), 17 px body. Monospace only for raw numeric data in tables, never for labels.
3. **Kill chrome.** No borders except where needed for affordance; separation by space and subtle fill steps (#000 → #0F0F10 → #1A1A1C), radius 20–28 px on large surfaces, 12 on controls. Max 1 pill per region.
4. **Calm palette.** Background pure #000. Failure colour a refined warm orange (#FF6B2C-ish) used only on dies and the one key number; highlight = soft white/ice glow (not neon mint outlines). Pass dies a quiet graphite. Keep WCAG ≥ 3:1 for dies, 4.5:1 text — update tokens + tests accordingly in design-language.md.
5. **Numbers as big stats.** "93.8% of fails on the edge" as a big-number stat row (number 40 px light, caption 13 px) instead of a sentence. Claims become 1-line headlines + a short muted sub-line; details expand on click.
6. **Nav.** Slim sticky top bar with backdrop blur: product name left, lot selector as a segmented control/menu center, language + "Open STDF" right.
7. **Empty state = landing hero.** Huge "Drop the body." headline, the three demo lots as large image cards with a wafer thumbnail each, one primary button.

## Interaction (must feel fluid)
- Spring physics (motion `type: "spring"`, stiffness ~300, damping ~30), all interruptible; no linear tweens. Respect prefers-reduced-motion.
- Load: probe-sweep reveal across the wafer (≤ 1.2 s), verdict text fades/rises in, stats count up.
- Wafer: canvas rendering, pinch/wheel zoom + drag pan with inertia, double-click to reset; hover magnifier/tooltip with die x,y, site, bin, test values; keyboard arrow-step kept.
- Click a finding → its dies glow in sequence (stagger ≤ 600 ms) and the camera eases to frame them; click again to clear.
- Drag-select a rectangle → live stats popover (dies, fails, yield, top bin).
- Wafer strip: horizontal scroll-snap with momentum, scrub with arrow keys; smooth crossfade between wafers.
- Every input acknowledged < 100 ms; heavy work stays in the Web Worker.
- Perf gate: Playwright test that zooms/pans/scrubs and asserts no long frames > 50 ms via PerformanceObserver('long-animation-frame' or 'longtask') and median rAF delta < 20 ms.

## i18n
- Locales: en (default), zh-CN, zh-TW, ja, ko. Auto-detect navigator.language, switcher in nav, persisted in localStorage.
- All UI strings + report templates through a typed dictionary (no extra heavy lib; simple typed `t(key, params)` + Intl.NumberFormat per locale). Bin names, test names, STDF fields stay untranslated.
- Test: every key present in every locale; report generation deterministic per locale.
