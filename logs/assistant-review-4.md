# Assistant visual review, task 4 (2026-11-18 04:40 SGT, screenshots at 1440x900)
Works end to end: demo lot loads in 133 ms, 97k records, yield table renders.
Fix list:
1. Hyphens render with visible extra spacing ("Edge - Ring", "CAL - ER - 2401", "First - Pass"): check font-feature/letter-spacing or a font fallback for U+2010 vs '-'. Use plain ASCII hyphen-minus and normal tracking on headings.
2. Copy too wordy for Apple restraint. Empty state headline ok; cut the paragraph to one line. "Drop the body." is fine (single wink), keep it.
3. Preset label "Site 1:2 Probe Contact Lot" is confusing -> "Site 2 Probe Contact Lot".
4. Large empty band between header and card (~110 px) on the loaded view; vertically tighten.
5. Next.js dev indicator "N" bottom-left: disable devIndicators in next.config for demo recordings.
6. Status column all "Nominal" in edge-ring lot is right; verify site2 lot flags Site 2 as anomaly (orange).
