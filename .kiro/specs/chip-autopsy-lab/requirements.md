# Requirements Document

## Introduction

Chip Autopsy Lab is a local-first, browser-based semiconductor failure analysis application that ingests Standard Test Data Format Version 4 (STDF V4) binary wafer sort logs and produces a verdict-first **Autopsy Report** backed by live, cross-linked die, bin, site, and parametric evidence. Designed for product, test, and yield engineers at small fabless semiconductor companies and OSATs—as well as electrical engineering students and Kiroween 2026 evaluators—it replaces ad-hoc per-wafer Python, Excel, and matplotlib scripts without requiring enterprise yield-management infrastructure or uploading proprietary silicon test data to a server.

The application runs all binary decompression, STDF V4 record decoding, retest resolution, statistical capability calculations, and 9-class WM-811K spatial failure-pattern classification inside the browser via a framework-free TypeScript core executed in a Web Worker. It leads with a one-sentence cause of death grounded strictly in deterministic engine facts, links every narrative claim directly to Die IDs and Bin Pareto bars on click, supports real-time cross-chart wafer brushing and `Cmd-K` / `Ctrl-K` natural-language filtering, and ships deterministic synthetic STDF V4 demo lots so any user can evaluate a complete diagnosis offline in under 3 seconds.

**Scope convention:** criteria marked **(Stretch)** are outside the 2-week MVP. Build them only after every non-Stretch criterion passes. Requirement 15 budgets are targets validated by benchmark runs on reference hardware, not CI gates, except 15.2 and 15.6.

## Glossary

- **System**: The Chip Autopsy Lab application, comprising the pure TypeScript analysis core (`src/core/`), the Web Worker execution bridge (`src/workers/`), the browser UI (`src/ui/`), and the optional Next.js server-side LLM route handler.
- **STDF V4**: Standard Test Data Format Version 4, a binary tag-length-value (`REC_LEN`, `REC_TYP`, `REC_SUB`) semiconductor ATE datalog specification published by Teradyne.
- **Lot**: A manufacturing batch of wafers sharing a common Master Information Record (`MIR`) tested under a test program.
- **Wafer**: A single semiconductor slice within a Lot, delimited by Wafer Information (`WIR`) and Wafer Results (`WRR`) records and optionally configured by a Wafer Configuration Record (`WCR`).
- **Test Site**: A physical parallel test channel identified by the `(HEAD_NUM, SITE_NUM)` tuple in STDF V4 records.
- **Die**: A physical integrated circuit at a unique `(Wafer, X_COORD, Y_COORD)` grid position (or sequential part index when coordinates equal the STDF missing sentinel `-32768`), resolved across one or more Part Results (`PRR`) executions.
- **Die ID**: A deterministic, canonical string identifier uniquely addressing a resolved Die within a loaded Lot (formatted as `<waferId>:<x>,<y>` for coordinate-bearing dies or `<waferId>:part-<seq>` when coordinates are missing).
- **HBIN**: Hardware Bin (`PRR.HARD_BIN`, metadata in `HBR`), representing the physical sorter bucket assigned by Automated Test Equipment.
- **SBIN**: Software Bin (`PRR.SOFT_BIN`, metadata in `SBR`), representing the logical pass or failure category assigned by the test program.
- **First-Pass Yield**: The ratio of Dies passing on their chronologically first `PRR` execution to total tested Dies in a scope, expressed in `[0, 1]` and displayed as a percentage to 1 decimal place.
- **Final Yield**: The ratio of Dies passing on their chronologically last `PRR` execution to total tested Dies in a scope, expressed in `[0, 1]` and displayed as a percentage to 1 decimal place.
- **Cp**: Process capability index measuring potential spread relative to two-sided specification limits, defined as `(HI_LIMIT - LO_LIMIT) / (6 * sigma)` when `sigma > 0` and both limits are valid.
- **Cpk**: Centered process capability index measuring off-center capability relative to valid specification limits, defined as `min((HI_LIMIT - mean) / (3 * sigma), (mean - LO_LIMIT) / (3 * sigma))` for two-sided limits or the corresponding single-sided ratio (`Cpu` or `Cpl`) when only one limit is valid.
- **WM-811K Classes**: The 9 canonical wafer-map spatial failure-pattern categories: `Center`, `Donut`, `Edge-Loc`, `Edge-Ring`, `Loc`, `Near-full`, `Random`, `Scratch`, and `None`.
- **Engine Fact**: A deterministic, structured analytical finding produced by the core engine with a unique `factId`, exact numeric metrics, optional Bin/Test/Site references, and a non-empty list of supporting Die IDs.
- **Autopsy Report**: The verdict-first diagnostic summary card opening with a single-sentence cause of death followed by evidence-linked claims grounded in Engine Facts.
- **Claim**: An individual diagnostic statement within the Autopsy Report bound to one or more Engine Facts and their resolved Die IDs, Bin codes, Parametric tests, or Test Sites.
- **Filter DSL**: The typed, deterministic abstract syntax tree representing spatial, bin, pass/fail, wafer, site, and parametric capability predicates applied to select Dies.
- **Selection Store**: The single client-side state source of truth uniting active spatial brush bounds, Filter DSL predicates, legend bin visibility toggles, and Claim-click highlights across all views.
- **Edge Ring Index**: For a coordinate-bearing Die, the minimum number of 4-neighbour die steps from that Die to a grid position outside the Wafer's set of tested coordinates; the outermost Dies have ring index `1`. The bare query term `edge` means ring index `<= 3`.
- **Bins-Only Mode**: A memory-bounded parsing mode offered for large uncompressed STDF streams (`> 200 MB`) that decodes wafer, part, and bin records while skipping parametric test records (`PTR`, `MPR`, `FTR`).

## Requirements

### Requirement 1: STDF V4 File Ingest and Off-Main-Thread Parsing

**User Story:** As a test or yield engineer, I want to drag and drop raw or gzip-compressed STDF V4 files directly into the browser and see parse progress without freezing the interface, so that I can inspect wafer sort results immediately without installing desktop software or Python toolchains.

#### Acceptance Criteria

1. WHILE the application viewport is open, THE System SHALL accept dragged files anywhere across the full window and display a drag-over state featuring subtle border and grid illumination with the copy `"Drop the body."`.
2. THE System SHALL also provide a keyboard-focusable file-picker control accepting `.stdf`, `.std`, `.stdf.gz`, and `.gz` files.
3. WHEN a user supplies an input file whose first two bytes equal gzip magic bytes `0x1F 0x8B` regardless of filename extension, THE System SHALL decompress the byte stream locally in the browser using native `DecompressionStream('gzip')` prior to STDF record framing.
4. WHEN parsing begins, THE System SHALL transfer the file buffer to a dedicated Web Worker via zero-copy transferable `ArrayBuffer` hand-off (or streamed chunks) and decode records off the main UI thread.
5. WHEN reading the initial STDF record, THE System SHALL verify that the first record is `FAR` (`REC_TYP = 0`, `REC_SUB = 10`) with `STDF_VER = 4` and decode subsequent multi-byte numeric fields using big-endian byte order when `FAR.CPU_TYPE = 1` or little-endian byte order when `FAR.CPU_TYPE = 2`.
6. WHEN parsing an STDF V4 stream in full mode, THE System SHALL decode `FAR`, `MIR`, `MRR`, `PCR`, `HBR`, `SBR`, `SDR`, `WIR`, `WRR`, `WCR`, `PIR`, `PRR`, `PTR`, `MPR`, `FTR`, and `TSR` records and skip all other record types (including V4-2007 scan records `STR` and `PSR`) by advancing `REC_LEN` bytes.
7. IF an STDF V4 record terminates at `REC_LEN` before reaching optional trailing fields in the specification layout, THEN THE System SHALL decode the omitted trailing fields as missing rather than failing the record.
8. WHEN decoding `PTR` records, THE System SHALL inherit omitted or default-flagged fields following `OPT_FLAG` from the first `PTR` sharing the same `TEST_NUM`, store `RESULT`, `LO_LIMIT`, and `HI_LIMIT` in base units, treat `RES_SCAL`, `LLM_SCAL`, and `HLM_SCAL` strictly as power-of-10 display exponents, and honor `OPT_FLAG` bits 4, 5, 6, and 7 for invalid or absent low and high limits.
9. WHILE multiple Test Sites execute concurrently, THE System SHALL attach interleaved `PTR`, `MPR`, and `FTR` records to the currently open `PIR` keyed by `(HEAD_NUM, SITE_NUM)` until closed by the matching `PRR` for that `(HEAD_NUM, SITE_NUM)`.
10. WHILE the Web Worker parses a file, THE System SHALL emit incremental progress updates (bytes processed, records decoded, and Dies resolved) to the UI.
11. WHEN the first file of a session loads and reduced motion is not requested, THE System SHALL play a skippable probe-sweep reveal lasting at most `3 s` that lights Dies in `PRR` record order and turns failing Dies `#FF7A1A` at completion; the sweep runs concurrently with parsing and SHALL NOT push the Autopsy Report past the 15.6 budget.

### Requirement 2: Malformed-Record Handling, Untrusted Input Safety, and Large-File Mode

**User Story:** As a yield engineer working with incomplete tester dumps or multi-hundred-megabyte lot files, I want the parser to handle truncated or malformed records safely without crashing and offer a lightweight mode for huge logs, so that corrupted tail bytes or oversized files do not block failure triage.

#### Acceptance Criteria

1. WHEN decoding every STDF record header and variable-length field, THE System SHALL bounds-check `REC_LEN` and field byte offsets against the remaining buffer length before reading memory.
2. IF a file lacks a valid `FAR` header, specifies `STDF_VER` other than `4`, specifies unsupported DEC VAX byte order (`FAR.CPU_TYPE = 0`), fails gzip decompression, or yields zero valid `PRR` records, THEN THE System SHALL transition to the parse-failed empty state displaying the specific failure reason, the byte offset where one applies, and a one-click `"Load demo lot"` action.
3. IF a truncated tail record or malformed non-header record is encountered after at least one valid `PRR` Die has been decoded, THEN THE System SHALL preserve all previously decoded Wafers and Dies, stop parsing at a truncated tail record, skip a malformed record whose `REC_LEN` fits the buffer by advancing `REC_LEN` bytes, never crash the Web Worker, and surface a non-blocking warning toast citing the byte offset and `(REC_TYP, REC_SUB)`.
4. THE System SHALL treat all strings extracted from STDF records (`MIR`, `WIR`, `HBR`, `SBR`, `PTR`, `TSR`, and part text) as untrusted input and render them strictly as escaped plain text, never as raw HTML.
5. IF an input file's uncompressed byte size exceeds `200 MB` (known from `File.size` for uncompressed input, or detected when the decompressed byte count crosses `200 MB` for gzip input), THEN THE System SHALL pause and warn the user and offer **Bins-Only Mode** (skipping `PTR`, `MPR`, and `FTR` decoding while preserving full Wafer, Bin Pareto, Yield, Stacked Heatmap, Pattern Classification, and bin-level Autopsy Report capabilities).

### Requirement 3: Built-in Synthetic STDF Demo Lots

**User Story:** As a first-time visitor or hackathon judge evaluating Chip Autopsy Lab with no local STDF files on hand, I want to load realistic synthetic wafer lots in one click and optionally download the raw binary files, so that I can verify the diagnosis workflow and drag-and-drop parser in seconds.

#### Acceptance Criteria

1. THE System SHALL include at least two seeded, deterministic synthetic STDF V4 demo lots—an `Edge-Ring` failure lot and a `Scratch` failure lot—generated using the same STDF V4 binary record schemas used by the parser, each containing multiple Wafers (target `25`) so the Stacked Wafer Heatmap is exercised.
2. WHEN the application is in the first-run, no-results, or parse-failed empty state, THE System SHALL present a prominent `"Load demo lot"` control that loads and analyzes a built-in synthetic demo lot in one click without network credentials or an API key.
3. WHEN a user selects a built-in demo lot, THE System SHALL parse it through the standard STDF V4 Web Worker pipeline so that demo analysis exercises identical code paths to user-dropped files.
4. THE System SHALL provide a download action exporting the built-in synthetic demo lots as standard binary `.stdf` (or `.stdf.gz`) files that can be dragged back into the viewport; reading them with Semi-ATE-STDF is a local manual cross-check, not an automated test or dependency.

### Requirement 4: Interactive Wafer Map and Two-Layer Canvas Rendering

**User Story:** As a product or failure analysis engineer, I want an interactive wafer map supporting Pass/Fail, HBIN, SBIN, and parametric views with instant hover readouts, bin toggles, and smooth zoom/pan, so that I can visually inspect spatial defect distributions down to individual dies.

#### Acceptance Criteria

1. THE System SHALL render single-wafer maps supporting four selectable color modes: `Pass/Fail`, `HBIN`, `SBIN`, and `Parametric` heatmap.
2. WHEN `WCR` geometry and orientation fields (`POS_X`, `POS_Y`, `WF_FLAT`) are present, THE System SHALL orient the wafer coordinate axes and notch/flat indicator accordingly, and IF a `PRR` carries `X_COORD = -32768` or `Y_COORD = -32768`, THEN THE System SHALL exclude that Die from spatial grid rendering while retaining it in non-spatial Lot, Wafer, Site, and Bin totals.
3. THE System SHALL render the wafer map using two stacked, device-pixel-ratio-scaled HTML5 Canvas2D layers: a base layer drawing Die fills and wafer boundary geometry, and an overlay layer drawing active brush bounds, hovered Die reticles, and `#7CF2C1` selection or Claim-evidence outlines/glows without repainting the base layer.
4. WHILE rendering `Pass/Fail` mode, THE System SHALL color passing Dies with the pass colour (starting value `#3A4A43`, tuned in LCH until it reaches `>= 3:1` against the wafer background, since `#3A4A43` on `#0A0A0B` is about `2.1:1`; final value recorded in `design.md`) and failing Dies `#FF7A1A`; WHILE rendering `HBIN` or `SBIN` mode, THE System SHALL color passing bins with the same pass colour, assign `#FF7A1A` to the dominant yield-loss failing bin, and assign remaining failing bins an equal-lightness LCH categorical palette that excludes hues near `#7CF2C1`.
5. WHEN a user hovers or scrubs over the wafer map, THE System SHALL resolve the Die under the pointer and display a floating readout that never covers the hovered Die, showing Die ID, `(X, Y)` coordinates, Wafer ID, Test Site, HBIN, SBIN, Pass/Fail status, retest count, and (when in `Parametric` mode) the formatted test measurement.
6. THE System SHALL display an interactive legend listing each bin's numeric code, bin name, Die count, and share of tested Dies, and WHEN a user clicks a legend item, THE System SHALL toggle the visibility of that bin's Dies on the wafer map while pairing hidden/active states with explicit non-color badges.
7. WHEN a user zooms or pans the wafer map via pointer wheel, drag gesture, or zoom controls, THE System SHALL apply coordinate-space/canvas transforms within the frame-rate target of 15.4 and provide a one-click reset-view action.
8. **(Stretch)** WHERE the autopsy-lamp setting is enabled (off by default), WHILE a user holds the `Alt` (`Option` on macOS) key over the wafer map, THE System SHALL reveal a radial `"autopsy lamp"` spotlight mask centered on the pointer.

### Requirement 5: Stacked Multi-Wafer Failure Heatmap

**User Story:** As a yield engineer analyzing a multi-wafer lot, I want to stack all wafers onto a single `(X, Y)` failure-density heatmap, so that I can separate recurring lithography, probe-card, or chuck hot spots from single-wafer random excursions.

#### Acceptance Criteria

1. WHEN a loaded Lot contains two or more Wafers, THE System SHALL provide a Stacked Wafer Heatmap view alongside the per-wafer gallery and selector.
2. WHEN computing the Stacked Wafer Heatmap, THE System SHALL aggregate per-`(X, Y)` tested Wafer counts and final-state failing Die counts across all Wafers in the active Lot (or Wafer subset) and render failure density using the perceptually uniform `magma` color ramp paired with a visible numeric scale legend.
3. WHEN a user switches from the multi-wafer gallery into the Stacked Wafer Heatmap (and reduced motion is not active), THE System SHALL animate the gallery collapse into the stacked map in `<= 800 ms`.
4. WHEN a user hovers a coordinate cell `(X, Y)` on the Stacked Wafer Heatmap, THE System SHALL display `(X, Y)`, failing Wafer count over tested Wafer count, stacked failure rate (`1 decimal`), and the dominant failing SBIN/HBIN at that coordinate across the Lot.
5. WHEN a user clicks or brushes a region of `(X, Y)` coordinates on the Stacked Wafer Heatmap, THE System SHALL update the Selection Store to filter linked charts to all Dies located at those `(X, Y)` coordinates across the active Wafers.

### Requirement 6: Bin Pareto Analysis

**User Story:** As a yield engineer, I want a Bin Pareto chart ranking failing hardware and software bins with counts, percentages, and cumulative loss, so that I can immediately identify which failure modes account for the majority of yield loss.

#### Acceptance Criteria

1. THE System SHALL render a Bin Pareto chart supporting toggleable `SBIN` and `HBIN` aggregation over the active Die selection.
2. WHEN rendering the Bin Pareto chart, THE System SHALL sort failing bins in monotonically non-increasing order of final-state Die count, display cumulative failure share, and render for every row/bar the numeric bin code, `SBR`/`HBR` bin name, grouped integer Die count, and percentage of total tested Dies formatted to `1 decimal`.
3. THE System SHALL fill the top yield-loss failing bin bar `#FF7A1A` and the remaining bars with the same categorical bin colours used on the wafer map, and pair all bars with text labels and bin codes so bin identity is never communicated by color alone.
4. WHEN a user clicks a bar or row in the Bin Pareto chart, THE System SHALL toggle a bin selection filter in the Selection Store, highlighting the corresponding Dies on the wafer map overlay with `#7CF2C1` and updating linked parametric charts.
5. WHEN the active Selection Store changes via wafer brushing or `Cmd-K` / `Ctrl-K` filtering, THE System SHALL recompute Bin Pareto counts and percentages over the filtered Die subset while preserving stable bin metadata labels.

### Requirement 7: Yield Summary and Retest Resolution by Lot, Wafer, and Test Site

**User Story:** As a test engineer debugging multi-site ATE runs and retest flows, I want accurate first-pass yield, final yield, and retest counts broken down by lot, wafer, and test site, so that I can quantify retest recovery and spot a faulty probe site immediately.

#### Acceptance Criteria

1. WHEN a Die at a given `(Wafer, X_COORD, Y_COORD)` has multiple `PRR` records, THE System SHALL use its chronologically first `PRR` (`PART_FLG` bits 3 and 4) to compute First-Pass Yield, use its chronologically last `PRR` to define Final Yield and active HBIN, SBIN, and parametric values, and count `totalPRRs - 1` as retest executions.
2. IF `PRR.PART_FLG` bit 4 (`0x10`, pass/fail flag invalid) is clear, THEN THE System SHALL classify that `PRR` execution as failing when bit 3 (`0x08`) is set and passing otherwise; IF bit 4 is set, THEN THE System SHALL take pass/fail from the `HBR.HBIN_PF` of its `HARD_BIN`, and count it as failing with a parse warning when that flag is missing.
3. THE System SHALL compute and display tested Die count, passing Die count, failing Die count, retest count, First-Pass Yield (`1 decimal`), and Final Yield (`1 decimal`) aggregated at three levels: overall Lot, per Wafer, and per Test Site `(HEAD_NUM, SITE_NUM)`.
4. IF the Lot has two or more Test Sites with `>= 30` tested Dies each, and one Test Site's Final Yield is more than `5.0` percentage points below the pooled Final Yield of the other Test Sites with a two-proportion `z >= 3.0`, THEN THE System SHALL flag that Test Site as a site-concentration anomaly and surface a corresponding Engine Fact.
5. WHEN a user clicks a Wafer or Test Site entry in the yield summary, THE System SHALL scope or highlight the Dies tested on that Wafer or Test Site across the wafer map, Bin Pareto, and parametric views.

### Requirement 8: Parametric Distribution Histograms and Capability Metrics (`Cp` / `Cpk`)

**User Story:** As a product engineer characterizing silicon margins, I want parametric histograms with specification limits, `Cp`/`Cpk` capability tables, and synchronized parametric wafer heatmaps, so that I can identify marginal or drifting electrical tests even before hard bin failures spike.

#### Acceptance Criteria

1. WHEN parametric `PTR` records are present, THE System SHALL display a sortable test catalog listing `TEST_NUM`, test name, units, sample size `n`, fail count, mean, standard deviation (`sigma`), `Cp`, and `Cpk` formatted to `2 decimals`.
2. WHEN a user selects a parametric test, THE System SHALL render a histogram of finite measurement values over the active Die selection with overlaid vertical markers for valid `LO_LIMIT` and `HI_LIMIT` values, formatted with SI unit prefixes (`nA`, `uA`, `mV`, `GHz`, etc.) derived from `RES_SCAL`, `LLM_SCAL`, and `HLM_SCAL`.
3. WHEN both `LO_LIMIT` and `HI_LIMIT` are valid (`LO_LIMIT < HI_LIMIT`), `n >= 2`, and `sigma > 0`, THE System SHALL compute `Cp = (HI_LIMIT - LO_LIMIT) / (6 * sigma)` and `Cpk = min((HI_LIMIT - mean) / (3 * sigma), (mean - LO_LIMIT) / (3 * sigma))`.
4. IF only one specification limit (`LO_LIMIT` or `HI_LIMIT`) is valid with `n >= 2` and `sigma > 0`, THEN THE System SHALL display `Cp` as `N/A` and compute single-sided `Cpk` (`Cpl` or `Cpu`); IF `n < 2`, `sigma = 0`, or neither limit is valid, THEN THE System SHALL display both `Cp` and `Cpk` as `N/A`.
5. WHEN a user hovers or drags across a parametric histogram, THE System SHALL display a vertical scrub rule and floating bin range/count readout placed in the margin above the plot area so it never covers plotted histogram bars.
6. WHEN a user activates the wafer map's `Parametric` color mode for a selected test, THE System SHALL color each Die on the wafer map using the `magma` ramp mapped across the measurement distribution with a numeric color-bar legend.
7. **(Stretch)** THE System SHALL extend the test catalog, histograms, and capability metrics to `MPR` results, treating each `(TEST_NUM, pin index)` as a separate test; in the MVP, `MPR` records are decoded but excluded from parametric analysis.

### Requirement 9: WM-811K Spatial Failure-Pattern Classification and Root-Cause Hypotheses

**User Story:** As a failure analysis engineer, I want each wafer's spatial defect signature automatically classified into the 9 WM-811K failure pattern classes with confidence scores and plausible fab/test root causes, so that I have an immediate physical hypothesis to guide investigation.

#### Acceptance Criteria

1. THE System SHALL classify each Wafer (and the Lot's Stacked Wafer Heatmap when multi-wafer) into one of the 9 WM-811K spatial classes—`Center`, `Donut`, `Edge-Loc`, `Edge-Ring`, `Loc`, `Near-full`, `Random`, `Scratch`, or `None`—using a deterministic, feature-based TypeScript algorithm with zero ML model weights and zero bundled WM-811K dataset files.
2. WHEN producing a pattern classification, THE System SHALL output the predicted WM-811K class name, a deterministic heuristic confidence score in `[0, 1]` formatted to `2 decimals` (e.g., `0.91`; a feature-score, not a calibrated probability, because no labelled dataset ships with the repository), quantitative spatial feature summaries (such as radial outer-ring density, connected-component aspect linearity, angular concentration, or global failure fraction), and the exact set of failing Die IDs forming the detected signature.
3. WHEN a non-`None` spatial failure pattern or Test Site concentration anomaly is detected, THE System SHALL attach hedged engineering root-cause hypotheses phrased as candidate mechanisms rather than certainty (mapping `Edge-Ring`, `Center`, and `Donut` to radial deposition, spin-coat, CMP, or plasma etch non-uniformity; `Scratch` to mechanical wafer handling, robotic end-effector contact, or probe scrub; `Edge-Loc` and `Loc` to localized particle contamination, lithography defocus, or thermal hot spots; `Near-full` to catastrophic excursion, mis-chucking, or unpowered test setup; `Random` to baseline point-defect density; and single-site concentration to probe-card needle wear or tester channel hardware rather than wafer fabrication).
4. IF a Wafer's failure fraction is below the classifier's minimum-failure threshold, or no class score reaches its acceptance threshold (both named constants documented in `design.md`), THEN THE System SHALL classify the Wafer as `None`.

### Requirement 10: Verdict-First Autopsy Report, Claim-to-Die Linking, and LLM Citation Validation

**User Story:** As an engineer or evaluator opening a test log, I want the top of the screen to state a one-sentence cause of death where clicking any diagnostic claim lights up the exact supporting dies and Pareto bars—with optional LLM narration strictly verified against deterministic engine facts—so that I get an instant, trustworthy diagnosis with zero hallucinated numbers.

#### Acceptance Criteria

1. WHEN a Lot finishes parsing, THE System SHALL render the **Autopsy Report** at the top of the workspace whose very first line is the cause-of-death line following the template `Cause of death: <verdict> (confidence <0.00>). Yield <0.0>%, most loss in <SBIN|HBIN> <code>.` (e.g., `"Cause of death: Edge-Ring failure (confidence 0.91). Yield 82.4%, most loss in SBIN 7."`). The verdict comes from the Stacked Wafer Heatmap classification for multi-wafer Lots (the single Wafer otherwise) or a site-concentration anomaly, chosen by a deterministic precedence rule documented in `design.md`. WHEN the Lot has no failing Dies, THE System SHALL omit the bin clause and state that no failure pattern was found.
2. THE System SHALL derive all classifications, counts, yields, capability metrics, and Die sets in the Autopsy Report exclusively from deterministic Engine Facts produced by `src/core/`.
3. THE System SHALL bind every Claim in the Autopsy Report (including the cause-of-death headline) to one or more Engine Fact IDs resolving to a non-empty list of valid Die IDs (plus any cited HBIN/SBIN codes, `TEST_NUM`s, or Test Sites), and SHALL never display an ungrounded statement or unlinked summary statistic.
4. WHEN a user clicks any Claim or the cause-of-death headline in the Autopsy Report, THE System SHALL highlight all cited Die IDs on the wafer map overlay with `#7CF2C1` outlines/glows (staggered within `<= 600 ms` when motion is enabled, `0 ms` under reduced motion), simultaneously highlight the bars of any cited bins in the Bin Pareto chart, and (when the Claim cites a parametric test) select that test in the parametric panel.
5. THE System SHALL generate and render the complete Autopsy Report immediately using a deterministic offline template engine as the baseline default, including WHILE offline or when no server-side LLM API key is configured.
6. **(Stretch)** WHERE a server-side LLM provider API key is configured on the Next.js route handler, THE System SHALL optionally send only structured aggregate Engine Facts to the server route to rephrase the Autopsy Report into concise clinical prose requiring explicit `factId` citations on every Claim.
7. **(Stretch)** WHEN the client receives an LLM-narrated report response, THE System SHALL validate before rendering that every Claim cites at least one valid `factId`, every resolved Die ID exists in the loaded Lot, and every numeric value in the prose matches its cited Engine Fact within display rounding tolerance; IF the server request fails, times out, or fails any citation or numeric validation check, THEN THE System SHALL discard the LLM response and display the deterministic template Autopsy Report without blocking the user.

### Requirement 11: Real-Time Cross-Chart Brushing

**User Story:** As a yield engineer investigating a suspicious cluster on a wafer, I want to drag a selection brush directly on the wafer map and see the Bin Pareto, yield metrics, and parametric histograms update immediately to reflect only those brushed dies, so that I can isolate regional failure mechanisms in real time.

#### Acceptance Criteria

1. WHEN a user drags a rectangular spatial brush on the single-wafer map or Stacked Wafer Heatmap, THE System SHALL update the central Selection Store with the brushed `(X, Y)` coordinate bounds and matching Die IDs in real time.
2. WHILE a spatial brush is active, THE System SHALL immediately recompute and render the Bin Pareto chart, Yield summary metrics, Parametric Histogram, and `Cp`/`Cpk` statistics table over the brushed Die subset, and outline brushed Dies on the wafer map overlay in `#7CF2C1`.
3. WHILE a spatial brush is active, THE System SHALL display a removable filter chip indicating the brushed coordinate range and selected Die count.
4. WHEN both a spatial brush and attribute filters (Bin selection, Test Site selection, or Filter DSL query) are active simultaneously, THE System SHALL evaluate the active selection as the deterministic set intersection of their predicates in the Selection Store.
5. WHEN a user clicks the brush chip's clear button, clicks an empty region outside the wafer boundary without dragging, or presses `Escape` (when no modal/palette is open), THE System SHALL clear the spatial brush and restore full-scope chart aggregations.

### Requirement 12: Cmd-K / Ctrl-K Natural-Language Filter and Command Palette

**User Story:** As a keyboard-driven test engineer, I want to press `Cmd-K` or `Ctrl-K` and type natural-language queries like `"only bin 7"`, `"edge 3 rings"`, or `"show edge failures with Cpk < 1.33"` to filter all charts simultaneously, so that I can slice test data in seconds instead of writing custom filter scripts.

#### Acceptance Criteria

1. WHEN a user presses `Cmd-K` (macOS) or `Ctrl-K` (Windows/Linux), THE System SHALL open the command palette immediately with `0 ms` open animation, listing recent queries first, contextual view/export actions, and right-aligned keyboard shortcut hints, where pressing `Enter` executes the highlighted action or query.
2. WHEN a user submits a filter query in the command palette, THE System SHALL first parse the query locally using a deterministic offline grammar into a validated **Filter DSL** AST supporting bin filters (`"only bin 7"`, `"sbin 7"`, `"hbin 4"`), spatial ring filters (`"edge 3 rings"`, `"center"`), pass/fail status (`"failures"`, `"passing"`), wafer/site scoping (`"wafer 3"`, `"site 2"`), parametric capability filters (`"tests with Cpk < 1.33"`), and compound conjunctions (`"show edge failures with Cpk < 1.33"`). Die predicates (bin, ring, pass/fail, wafer, site) filter Dies; capability predicates filter the test catalog, with `Cp`/`Cpk` computed over the Dies selected by the Die predicates.
3. **(Stretch)** WHERE the offline grammar cannot parse a free-form natural-language query AND the server-side LLM route handler is configured, THE System SHALL send only the query text and catalog metadata (bin codes/names, test numbers/names/units, wafer count, site IDs) to the server route to translate into a candidate Filter DSL JSON object, and SHALL schema-validate all AST operators and referenced bin/test identifiers before execution.
4. IF neither the offline grammar nor validated LLM translation produces a valid Filter DSL AST, THEN THE System SHALL keep the current selection unchanged and display inline syntax guidance with clickable example queries inside the palette.
5. WHEN a valid Filter DSL query executes, THE System SHALL update the Selection Store (and, when capability predicates are present, select the matching test with the lowest `Cpk` in the parametric panel), update the wafer map, Bin Pareto, and parametric histogram simultaneously, and render human-readable removable filter chips representing each active DSL clause.
6. IF an active Filter DSL query or brush matches zero Dies, THEN THE System SHALL display the dedicated no-results empty state in affected panels showing the active filter criteria alongside one-click `"Clear filters"` and `"Load demo lot"` actions.

### Requirement 13: Shareable URL View and Filter State (Stretch)

**User Story:** As an engineer collaborating on an investigation or presenting a demo, I want active view modes, selected wafers/tests, and filter predicates reflected in the browser URL, so that bookmarking, reloading, or sharing a link reproduces the exact analytical view.

This whole requirement is **(Stretch)**; steering does not list it as table stakes.

#### Acceptance Criteria

1. WHEN view or selection state changes (built-in demo lot slug, active Wafer index, wafer map color mode, Stacked Wafer Heatmap toggle, selected parametric `TEST_NUM`, hidden bin codes, serialized Filter DSL predicates, brush coordinate bounds, and highlighted Claim ID), THE System SHALL synchronize those parameters into the URL query string without triggering a full page navigation.
2. WHEN a user opens a URL containing serialized state parameters referencing a built-in synthetic demo lot, THE System SHALL automatically load that demo lot and restore the Wafer view, color mode, parametric test, Filter DSL predicates, brush bounds, and Claim highlight.
3. WHEN a user opens a URL containing view and filter parameters without a built-in demo lot slug, THE System SHALL preserve those URL parameters across the file-drop prompt and apply them automatically once a matching local STDF file is loaded (ignoring only identifiers absent from the newly loaded file).
4. THE System SHALL never serialize raw STDF binary data, per-die measurement arrays, or proprietary string payloads from local files into the URL.

### Requirement 14: Accessibility, Keyboard Operability, and Reduced Motion

**User Story:** As a user navigating via keyboard, relying on assistive technologies, or sensitive to visual motion or color-vision deficiency, I want accessible contrast, non-color visual cues, full keyboard controls, and reduced-motion support across every panel and chart.

#### Acceptance Criteria

1. THE System SHALL maintain WCAG 2.2 Level AA contrast ratios across the interface: `>= 4.5:1` for all informative text (including `text-tertiary` `rgba(255, 255, 255, 0.48)` against `#0A0A0B`) and `>= 3:1` for interactive controls, focus indicators, and chart marks.
2. THE System SHALL never rely on color as the sole visual cue: every Pass/Fail state, HBIN/SBIN category, Pareto bar, specification limit marker, and Claim highlight SHALL pair color with explicit text labels, numeric bin codes, outlines (`#7CF2C1`), badges, or line geometry. On the wafer map, per-Die text is not required: pass and fail fills SHALL differ by `>= 3:1` luminance contrast, and bin identity SHALL be available through the labelled legend (including click-to-hide) and the hover readout.
3. THE System SHALL make all interactive controls keyboard-operable with visible `#7CF2C1` focus rings, including keyboard file upload, ARIA-compliant `dialog` and `listbox` roles in the `Cmd-K` / `Ctrl-K` command palette, keyboard Claim activation in the Autopsy Report, keyboard bar selection in the Bin Pareto chart, keyboard Wafer/Test selection, and keyboard zoom, pan, and arrow-key Die stepping on the wafer map.
4. THE System SHALL expose accessible tabular summaries or screen-reader descriptions for canvas/SVG visualizations and announce parse completion, primary cause-of-death verdicts, and active filter count changes through polite ARIA live regions (`aria-live="polite"`).
5. WHILE the user's operating system or browser reports `prefers-reduced-motion: reduce`, THE System SHALL disable all non-essential animations, spring overshoots, probe-sweep file load reveals, wafer-gallery layout collapses, headline type-on animations, and staggered Die light-up delays.

### Requirement 15: Performance Budgets and Responsiveness

**User Story:** As an engineer analyzing multi-wafer production lots containing hundreds of thousands of dies and millions of parametric records, I want fast worker ingestion, smooth 50+ fps wafer navigation, and sub-100 ms cross-chart brushing, so that interactive exploration feels instantaneous.

#### Acceptance Criteria

1. WHEN parsing uncompressed STDF V4 data inside the Web Worker on reference desktop hardware (Apple M1-class laptop running latest desktop Chrome), THE System SHALL target a sustained parse throughput of `>= 15 MB/s`, measured by a recorded benchmark run.
2. WHILE the Web Worker parses an STDF file and computes analytical aggregations, THE System SHALL keep every main-thread task duration `<= 50 ms` so UI controls remain responsive.
3. THE System SHALL support full parametric ingestion up to `200 MB` uncompressed in desktop Chrome, Edge, Firefox, and Safari (latest two versions), and offer **Bins-Only Mode** above `200 MB`.
4. WHEN drawing the base wafer map Canvas2D layer for `10,000` Dies, THE System SHALL complete the base pass in `< 5 ms`, redraw selection/hover highlights solely on the overlay canvas without repainting the base canvas, and target `>= 50 fps` during zoom and pan up to `100,000` Dies (a miss triggers the regl base-layer decision in `tech.md`).
5. WHEN a user drags a spatial brush across the wafer map on a Lot of `25` Wafers x `10,000` Dies (`250,000` total Dies), THE System SHALL update all linked views (Bin Pareto, Yield summary, Parametric Histogram, and capability statistics) within `<= 100 ms`.
6. WHEN a user triggers a built-in synthetic demo lot from the empty state offline, THE System SHALL show the start of the cause-of-death line within `<= 3 s` of the click, including any probe-sweep reveal, measured in a Playwright run.

### Requirement 16: Local-First Privacy, Offline Operation, and Secret Hygiene

**User Story:** As a semiconductor engineer bound by foundry and customer NDAs, I want strict guarantees that raw STDF bytes and per-die data never leave my browser and that full analysis works completely offline, so that sensitive wafer yield and parametric IP remain confidential.

#### Acceptance Criteria

1. THE System SHALL execute all decompression, STDF V4 binary parsing, Die modeling, spatial classification, statistical capability computation, and template report generation exclusively within browser memory and SHALL never upload, transmit, or log raw STDF bytes or per-die coordinate/measurement records to any server.
2. WHILE the browser has no network connectivity (`navigator.onLine === false`) after the application has loaded, THE System SHALL remain fully operational for local STDF file ingest, built-in demo lots, wafer maps, Stacked Wafer Heatmaps, Bin Pareto, Yield summaries, Parametric Histograms, WM-811K classification, deterministic Autopsy Reports, and offline `Cmd-K` / `Ctrl-K` filtering, issuing zero runtime requests to third-party font or asset CDNs (self-hosting `Inter` and `Geist Mono`). Loading the application itself while offline (service worker) is **(Stretch)**.
3. **(Stretch, with 10.6)** THE System SHALL restrict its server-side surface to a single Next.js LLM route handler whose outbound and inbound schema validation accepts only aggregate Engine Facts (for report narration) or palette query strings plus catalog metadata (for optional `Cmd-K` translation), rejecting any request body containing binary buffers or per-die arrays with HTTP `400`.
4. THE System SHALL never include LLM API keys or secrets in the repository or client bundle, reading any provider key exclusively from a server-only environment variable without a `NEXT_PUBLIC_` prefix.

### Requirement 17: Design Language, Clinical Copy, and Core Architectural Constraints

**User Story:** As a product designer and software architect maintaining Chip Autopsy Lab, I want strict enforcement of dark clinical visual tokens, restrained motion, disciplined copy, and a framework-free TypeScript core, so that the application delivers keynote-grade polish and every analytical invariant can be property-tested in Node.

#### Acceptance Criteria

1. THE System SHALL apply the locked dark color tokens (`color-scheme: dark`): `#0A0A0B` application background (`bg`), `#111113` cards and panels (`panel`), `rgba(255, 255, 255, 0.08)` 1 px hairline borders (`hairline`), `rgba(255, 255, 255, 0.04)` hover/inset surface (`raised`), `rgba(255, 255, 255, 0.08)` with `20-32 px` backdrop blur for floating overlays (`overlay`), `#7CF2C1` formalin green as the sole accent token (`accent` for selection, focus rings, AI/engine conclusions, and Claim markers only), and `#FF7A1A` pumpkin orange (`failure`) strictly for failing Dies/bars and cause of death.
2. THE System SHALL achieve surface elevation exclusively through background brightness steps and `1 px` `hairline` borders, and SHALL NOT apply drop shadows to panels, cards, or tooltips, nor render skulls, cobwebs, bats, pumpkin icons, Halloween illustrations, spooky/novelty fonts, gradient-filled or 3D charts, a second accent color, or bold font weights (`>= 700`).
3. THE System SHALL set UI copy in `Inter` (`400`, `500`), headings in `Inter Display` (Inter's display optical size, falling back to system `SF Pro Display`; `letter-spacing: -0.02em`, weights `510-590` only), and all numeric columns, coordinates, chart axes, and scrub readouts in self-hosted `Geist Mono` with `font-variant-numeric: tabular-nums` enabled everywhere.
4. THE System SHALL format yield percentages to `1 decimal` (`82.4%`), `Cp`, `Cpk`, and pattern confidence scores to `2 decimals` (`1.33`, `0.91`), integer Die/record counts with digit grouping (`12,480`), and parametric measurements/limits with SI unit prefixes (`nA`, `uA`, `mV`, `GHz`), restricting autopsy metaphor copy strictly to `"Drop the body."`, `"Autopsy Report"`, and `"Cause of death"` while using standard semiconductor test terminology everywhere else.
5. THE System SHALL restrict standard UI transitions to `150-200 ms` ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`) animating `transform` and `opacity` only, cap panel/overlay springs at `<= 400 ms`, apply `0 ms` transitions to keyboard-triggered high-frequency actions, and permit durations above `400 ms` only on the four named reveal moments: probe-sweep load (`~3 s`, once per session, skippable), wafer-gallery stack collapse (`<= 800 ms`), cause-of-death type-on (`<= 1.5 s`), and Claim Die stagger (`<= 600 ms`).
6. THE System SHALL implement distinct empty states by cause—first-run, no-results (active filter empty), and parse-failed—each presenting a clear diagnostic explanation, one primary next action, and a `"Load demo lot"` button.
7. THE System SHALL isolate all STDF V4 parsing/writing, Lot/Wafer/Die modeling, yield/Pareto/stacking/parametric analytics, WM-811K classification, Engine Fact and template report generation, and Filter DSL parsing/evaluation inside `src/core/` as pure deterministic TypeScript with zero React, Next.js, or DOM imports so every correctness property executes directly in Vitest + `fast-check`.

## Correctness Properties

Each property below specifies a universal invariant over `src/core/` modules to be verified via automated property-based testing with `fast-check`.

1. **STDF V4 Write-to-Parse Round-Trip Equivalence** *(Validates: Requirements 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 3.1)*
   For all valid generated Lot models (varying endianness `FAR.CPU_TYPE` in `{1, 2}`, multi-wafer layouts, multi-site interleaved `PIR`/`PTR`/`PRR` streams, `PTR` default inheritance, omitted optional trailing fields, and optional gzip compression), serializing the Lot with the STDF V4 writer and parsing the resulting bytes with the STDF V4 parser produces a normalized Lot model deeply equal in metadata, Wafer geometry, resolved Die coordinates, HBIN/SBIN assignments, Pass/Fail states, retest counts, and base-unit parametric results and limits.

2. **Parser Bounds Safety and Truncated-Stream Recovery** *(Validates: Requirements 2.1, 2.2, 2.3)*
   For all arbitrary `Uint8Array` byte sequences (including random fuzz bytes, corrupted `REC_LEN` headers, and valid STDF streams truncated at any arbitrary byte offset $k$), the STDF V4 parser terminates in finite time without throwing uncaught exceptions or reading out of bounds; furthermore, for any valid STDF byte stream truncated mid-record after $m \ge 1$ complete `PRR` records, the parser recovers all $m$ preceding `PRR` records identically to the untruncated prefix and emits a structured truncation warning.

3. **Retest Resolution Determinism (First-Pass vs. Final State)** *(Validates: Requirements 7.1, 7.2)*
   For all sequences of `PRR` records within a Wafer containing one or more repeated `(X_COORD, Y_COORD)` coordinates (excluding sentinel `-32768`), each distinct coordinate resolves to exactly one canonical Die whose first-pass status matches its chronologically first `PRR`, whose final Pass/Fail status, HBIN, SBIN, and active parametric measurements match its chronologically last `PRR`, and whose retest count equals `count(PRRs at coordinate) - 1`.

4. **Yield Bounds and Partition Additivity** *(Validates: Requirements 7.1, 7.2, 7.3)*
   For all non-empty Die collections $D$, both First-Pass Yield and Final Yield equal $\text{passingDies} / \text{testedDies} \in [0, 1]$, $\text{passingDies} + \text{failingDies} = \text{testedDies}$, and for any disjoint partition of $D$ by Wafer or by final Test Site, the sum of partition `testedDies` equals $|D|$ and the weighted average of partition yields weighted by `testedDies` equals the overall yield of $D$ (while an empty Die set returns `null` rather than `NaN` or $\pm\infty$).

5. **Bin Pareto Count Conservation and Monotonic Ordering** *(Validates: Requirements 6.1, 6.2, 6.5)*
   For all Die selections $D$ in either `HBIN` or `SBIN` mode, summing Die counts across all passing bins and all failing Bin Pareto entries equals $|D|$, failing Pareto entries have strictly positive counts ordered monotonically non-increasing ($c_1 \ge c_2 \ge \dots \ge c_k > 0$), and when failing Dies exist, cumulative failure shares increase monotonically to `1.0` (`100.0%`).

6. **Stacked Multi-Wafer Heatmap Failure Conservation** *(Validates: Requirements 5.2, 5.4)*
   For all multi-wafer Lots of $W$ Wafers and every grid coordinate $(x, y)$, the stacked failure count `failCount(x, y)` satisfies $0 \le \text{failCount}(x, y) \le \text{testedWaferCount}(x, y) \le W$, equals the exact count of Wafers whose resolved final Die at $(x, y)$ failed, and summing `failCount(x, y)` over all valid coordinates equals the total final failing coordinate-bearing Dies across all $W$ Wafers.

7. **Parametric Capability (`Cp` / `Cpk`) Invariants and Affine Scale Equivariance** *(Validates: Requirements 8.3, 8.4)*
   For all finite numeric measurement arrays of length $n \ge 2$ with sample standard deviation $\sigma > 0$ and valid two-sided limits $\text{LO\_LIMIT} < \text{HI\_LIMIT}$, $Cp > 0$ and $Cpk \le Cp$ (with $|Cpk - Cp| < 10^{-9}$ when $\mu = (\text{LO\_LIMIT} + \text{HI\_LIMIT}) / 2$), and applying any positive affine transformation $x' = a \cdot x + b$ ($a > 0$) to all measurements and both limits leaves $Cp$ and $Cpk$ unchanged within floating-point tolerance ($< 10^{-9}$).

8. **WM-811K Classifier Determinism and 90-Degree Rotation / Mirror Robustness** *(Validates: Requirements 9.1, 9.2, 9.4)*
   For all Wafer Die grids, repeated invocations of the WM-811K classifier return identical class labels from the 9-class set, identical confidence scores in $[0, 1]$, and identical supporting Die ID sets; moreover, rotating any Wafer Die grid with an integer or half-integer grid center by $90^\circ$, $180^\circ$, or $270^\circ$ around the wafer center (or reflecting across X/Y axes) preserves the predicted top class and confidence within $\pm 0.05$ for radially symmetric classes (`Edge-Ring`, `Center`, `Donut`, `Random`, `Near-full`, `None`).

9. **Synthetic Demo Lot Determinism and Ground-Truth Pattern Recovery** *(Validates: Requirements 3.1, 3.3, 9.1)*
   For all integer PRNG seeds and each built-in synthetic preset (`Edge-Ring` and `Scratch`), invoking the synthetic demo generator twice with the same seed yields byte-for-byte identical STDF V4 output, and parsing plus classifying the generated stream recovers the preset's target WM-811K failure class as the top-ranked Wafer pattern; for the shipped demo seeds that class also has confidence $\ge 0.75$.

10. **Autopsy Report Verdict Structure and Claim-to-Die Referential Integrity** *(Validates: Requirements 10.1, 10.2, 10.3, 10.5)*
    For all parsed Lots containing at least one tested Die, the generated Autopsy Report's first line matches the 10.1 cause-of-death template, every Claim references at least one valid `factId` and resolves to a non-empty set of Die IDs, every cited Die ID exists in the loaded Lot's resolved Die set ($\text{citedDieIds} \subseteq \text{allDieIds}$), and every cited Bin code, `TEST_NUM`, Test Site, and formatted metric matches its underlying Engine Fact.

11. **(Stretch) LLM Citation Validator Soundness and Deterministic Fallback** *(Validates: Requirements 10.6, 10.7)*
    For all Engine Fact sets and all adversarial or mutated candidate LLM report payloads containing an unknown `factId`, an empty citation array, an out-of-Lot Die ID, or a numeric string diverging from its cited Engine Fact beyond display rounding tolerance, the citation validator rejects the candidate payload and returns the deterministic template Autopsy Report unchanged.

12. **Brush and Selection Filter Idempotence, Containment, and Commutativity** *(Validates: Requirements 11.1, 11.2, 11.4, 12.2, 12.5)*
    For all Die collections $D$, all spatial brush rectangles $B$, and all valid Filter DSL Die predicates $P$ (capability predicates filter tests, not Dies): applying a filter is idempotent ($\text{select}(B, \text{select}(B, D)) = \text{select}(B, D)$ and $\text{select}(P, \text{select}(P, D)) = \text{select}(P, D)$), produces a strict or non-strict subset ($\text{select}(P, D) \subseteq D$), and commutes under conjunction ($\text{select}(B, \text{select}(P, D)) = \text{select}(P, \text{select}(B, D)) = \text{select}(B \land P, D)$).

13. **Filter DSL and URL Query State Round-Trip Serialization** (URL part **Stretch**; Filter DSL serialization round-trip is MVP) *(Validates: Requirements 12.2, 13.1, 13.2, 13.4)*
    For all valid Filter DSL ASTs and serializable workspace view states (demo lot slug, selected Wafer index, wafer map color mode, stacked mode flag, selected `TEST_NUM`, hidden bin set, brush rectangle, and active Claim ID), encoding to URL search parameters and decoding back yields a view state and Filter DSL AST structurally equal to the input, evaluates to the identical Die ID subset on any Lot, and contains zero raw STDF byte sequences.

14. **(Stretch) Outbound LLM Payload Privacy Invariant** *(Validates: Requirements 16.1, 16.3)*
    For all loaded Lots and all outbound request bodies constructed by the client LLM adapter (for Autopsy Report narration or `Cmd-K` query translation), the request serializer strips and rejects any raw STDF byte buffers and per-die coordinate or measurement records, passing the route-handler schema validator if and only if the payload contains exclusively aggregate Engine Facts or query text plus catalog schema metadata.
