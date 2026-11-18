/**
 * English source-of-truth message table (`src/core/i18n/messages/en.ts`).
 *
 * Follows `.kiro/specs/chip-autopsy-lab/redesign.md` §6.8 verbatim.
 */

export const en = {
  // App + nav
  'app.title': 'Chip Autopsy Lab',
  'app.description':
    'Find out why a wafer lot lost yield. STDF V4 analysis that runs in your browser.',
  'nav.wordmark': 'Chip Autopsy Lab',
  'nav.wordmarkShort': 'Autopsy Lab',
  'nav.openFile': 'Open file',
  'nav.openStdfAria': 'Open an STDF file',
  'nav.languageAria': 'Change language',
  'nav.home': 'Back to start',

  // Lot picker
  'lotPicker.triggerAria': 'Choose lot, current lot {lotId}',
  'lotPicker.demoSection': 'Sample lots',
  'lotPicker.recentSection': 'Recent files',
  'lotPicker.openFile': 'Open file…',
  'lotPicker.yield': 'Yield {yield}, {wafers} wafers',
  'lotPicker.current': 'Current lot',

  // Appearance (premium §7.1)
  'theme.label': 'Appearance',
  'theme.ariaLabel': 'Appearance: {preference}',
  'theme.ariaSystemLight': 'System, currently light',
  'theme.ariaSystemDark': 'System, currently dark',
  'theme.system': 'Match system',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.systemNote': 'Match system follows your device setting.',

  // Glossary (premium §2.3)
  'glossary.lot': 'A batch of wafers made together. Problems in one lot often share a cause.',

  // Landing
  'landing.headline': 'Drop the body.',
  'landing.headlineAccent': 'body',
  'landing.subline': 'Find out why a wafer lot lost yield. Drop an STDF test log and get the cause, linked to the dies.',
  'landing.primary': 'Open the sample lot',
  'landing.secondary': 'Open file',
  'landing.hint': 'Or drop a .stdf, .std, or gzip file anywhere. Files stay on this device.',
  'landing.hintShort': 'Files stay on this device.',
  'landing.demoHeading': 'Sample lots',
  'landing.privacy': 'Runs entirely in your browser.',
  'landing.downloadDemos': 'Download sample files',
  'landing.cardMeta': '{wafers} wafers, {dies} dies',
  'landing.example.eyebrow': 'Example result',
  'landing.example.fact': '{percent} of fails sit in the outer 3 rings.',
  'landing.example.action': 'See how it was found',
  'demo.edgeRing.chip': 'Edge ring',
  'demo.scratch.chip': 'Scratch',
  'demo.site2.chip': 'Probe site',
  'report.footer': 'Runs entirely in your browser. Raw STDF bytes never leave this device.',
  'demo.edgeRing.description': 'Etch damage kills dies around the wafer edge.',
  'demo.scratch.description': 'A robot arm scratched a line across 18 wafers.',
  'demo.site2.description': 'One worn tester needle fails good dies.',
  'demo.openAria': 'Open sample lot {title}',
  'demo.edgeRing.title': 'Edge-Ring Plasma Etch',
  'demo.scratch.title': 'Robotic Handling Scratch',
  'demo.site2.title': 'Site 2 Probe Contact',

  // Drag overlay
  'drop.headline': 'Drop the body.',
  'drop.subline': 'Release to open. STDF, STD, or gzip.',
  'drop.notFile': 'Only files can be opened here.',

  // Loading
  'loading.readingRecords': 'Reading records',
  'loading.readingWafer': 'Reading wafer {current} of {total}',
  'loading.bytes': '{done} of {total}',
  'loading.skipHint': 'Press any key to skip the animation.',
  'loading.progressAria': 'Parsing {percent}',

  // Verdict
  'verdict.prefix': 'Cause of death:',
  'verdict.pattern': '{pattern} failure.',
  'verdict.site': 'test site {site} contact failure.',
  'verdict.random': 'random defects, no spatial signature.',
  'verdict.healthy': 'No cause of death.',
  'verdict.showOnWafer': 'Show on wafer',
  'verdict.causeAria': 'Show the dies behind this verdict',
  'verdict.methodTitle': 'How this verdict was made',
  'verdict.methodTemplate':
    'Every number comes from the on-device analysis engine. The text is the built-in template.',
  'verdict.methodLlm':
    'Every number comes from the on-device analysis engine. An AI model rephrased the text and every sentence cites an engine fact.',

  // Takeaway and confidence (premium §7.3, §7.4, §9.3)
  'takeaway.edgeRing': 'Most failing dies sit in the outer {rings} rings of every wafer. Final yield is {yield}.',
  'takeaway.scratch': 'Failing dies line up along a scratch on {count} of {total} wafers. Final yield is {yield}.',
  'takeaway.center': 'Most failing dies sit in the centre of the wafer. Final yield is {yield}.',
  'takeaway.donut': 'Most failing dies sit in a ring around the centre of the wafer. Final yield is {yield}.',
  'takeaway.edgeLoc': 'Most failing dies sit in one area at the edge of the wafer. Final yield is {yield}.',
  'takeaway.loc': 'Most failing dies sit in one area of the wafer. Final yield is {yield}.',
  'takeaway.nearFull': 'Most failing dies sit across almost all of the wafer. Final yield is {yield}.',
  'takeaway.site': 'Test site {site} fails {rate} of its dies, the other sites fail {otherRate}. Final yield is {yield}.',
  'takeaway.random': 'Failures are scattered with no shape. Look at the tests before the process. Final yield is {yield}.',
  'takeaway.healthy': '{passed} of {total} dies passed every test.',
  'confidence.high': 'High confidence, {value}',
  'confidence.moderate': 'Moderate confidence, {value}',
  'confidence.low': 'Low confidence, {value}',
  'confidence.match': 'Match with {pattern}',
  'glossary.confidence': 'How strongly the wafer pattern matches the named class, from 0 to 1. Computed on this device.',

  // Stats
  'stats.edgeShare': 'of failing dies are in the outer {rings} rings',
  'stats.scratchShare': 'of failing dies are on the scratch line',
  'stats.siteRate': 'fail rate on site {site} vs {other} elsewhere',
  'stats.finalYield': 'final yield',
  'stats.firstPass': '{firstPass} on the first test',
  'stats.failingDies': 'dies failed, of {tested} tested',
  'stats.inSelection': '{caption} in selection',

  // Findings
  'findings.label': 'Findings',
  'findings.dieCount.one': '{count} die',
  'findings.dieCount.other': '{count} dies',
  'findings.inSelection': '{count} of {total} in selection',
  'findings.clear': 'Clear',
  'causes.label': 'Possible causes',
  'findings.checkNext': 'Check next',
  'findings.edgeBand.headline': 'Failures concentrate in the outer {rings} rings',
  'findings.edgeBand.sub':
    '{edgeRate} edge fail rate vs {interiorRate} interior, on {wafers} of {total} wafers',
  'findings.scratch.headline': 'Failures line up along a scratch on {wafers} wafers',
  'findings.scratch.sub': '{dies} dies on one path, {share} of fails',
  'findings.dominantBin.headline': 'One failure type causes {share} of the loss',
  'findings.dominantBin.sub': '{bin}, {dies} dies',
  'findings.secondaryBin.headline': '{bin} adds {share} of fails',
  'findings.secondaryBin.sub': '{dies} dies on {wafers} wafers',
  'findings.capability.headline': '{kind} {test} is far off target',
  'findings.capability.sub': 'Cpk {cpk}, mean {mean}, limits {lo} to {hi}',
  'findings.site.headline': 'Site {site} fails {ratio} times more often than the others',
  'findings.site.sub':
    '{rate} fail rate on site {site} vs {other} on the other sites, {retests} retests',
  'findings.excursion.headline': 'Wafer {wafer} dropped to {yield}',
  'findings.excursion.sub': '{delta} below the lot median',
  'findings.lotYield.headline': 'Final yield {yield}',
  'findings.lotYield.sub': '{firstPass} first pass, {retests} retested dies',
  'findings.more.one': 'Show {count} more finding',
  'findings.more.other': 'Show {count} more findings',
  'findings.meta': '{wafer} on this wafer, {lot} on all {wafers} wafers',
  'findings.metaOneWafer': '{lot} on this wafer',
  'findings.capability.close': '{kind} {test} is close to its limits',
  'findings.testKind.leakage': 'Leakage test',
  'findings.testKind.current': 'Current test',
  'findings.testKind.voltage': 'Voltage test',
  'findings.testKind.timing': 'Timing test',
  'findings.testKind.frequency': 'Frequency test',
  'findings.testKind.generic': 'Test',
  'findings.center.headline': 'Failures concentrate in the centre',
  'findings.donut.headline': 'Failures form a ring around the centre',
  'findings.edgeLoc.headline': 'Failures concentrate in one area at the edge',
  'findings.loc.headline': 'Failures concentrate in one area',
  'findings.nearFull.headline': 'Failures cover almost the whole wafer',
  'findings.pattern.sub': '{dies} dies, {share} of failing dies, on {wafers} of {total} wafers',
  'causes.note': 'These are likely explanations, not proof. Confirm them in the tool logs.',
  'causes.basedOn': 'Based on finding {n}',
  'hypothesis.etchUniformity': 'Deposition or etch uniformity',
  'hypothesis.etchUniformity.check':
    'Compare chamber logs for the edge zone and check focus-ring hours.',
  'hypothesis.mechanical': 'Mechanical handling',
  'hypothesis.mechanical.check':
    'Inspect transfer-blade alignment for the affected slots.',
  'hypothesis.probeCard': 'Probe card or tester site, not process',
  'hypothesis.probeCard.check':
    'Clean or replace the site {site} needles and re-probe a sample.',
  'hypothesis.random': 'Random particle defects',
  'hypothesis.random.check':
    'Review particle counts and defect inspection for the lot.',

  // Wafer stage
  'stage.aria': 'Wafer {wafer}, {dies} dies, {fails} failing',
  'stage.roleDescription': 'wafer map',
  'stage.mode.hbin': 'HBIN',
  'stage.mode.sbin': 'SBIN',
  'stage.legend.toggleAria': 'Show or hide {bin}',
  'mode.passFail': 'Pass/fail',
  'mode.hardBins': 'Hard bins',
  'mode.softBins': 'Soft bins',
  'legend.failed': 'Failed',
  'legend.passed': 'Passed',
  'legend.good': 'Good',
  'legend.more': '+{count} more',
  'stage.title': 'Wafer {wafer}',
  'stage.caption': '{failed} of {total} dies failed',
  'stage.reading': 'Reading…',
  'stage.selected.one': '{count} die selected',
  'stage.selected.other': '{count} dies selected',
  'stage.selectArea': 'Select an area',
  'stage.selectAreaHint': 'Select an area (S, or Shift-drag)',
  'stage.resetView': 'Reset view',
  // Bin Pareto
  'pareto.heading': 'Yield loss by bin',
  'pareto.modeAria': 'Bin type',
  'pareto.empty': 'No failing dies in this selection.',
  'pareto.rowDetail': '{share} of tested, {cumulative} cumulative',
  'pareto.rowAria': 'Filter to {bin}, {dies}, {share} of tested',
  'pareto.showAll': 'Show all {count} bins',
  'pareto.showFewer': 'Show fewer',
  // Yield summary
  'yield.heading': 'Yield',
  'yield.col.firstPass': 'First pass',
  'yield.col.final': 'Final',
  'yield.col.retests': 'Retests',
  'yield.sites': 'Test sites',
  'yield.wafers': 'Wafers',
  'yield.wafersLowest': 'Lowest yield wafers',
  'yield.siteLabel': 'Site {site}',
  'yield.siteLow': 'Lower than the other sites',
  'yield.siteRowAria': 'Scope to site {site}, final yield {final}, first pass {firstPass}',
  'yield.waferRowAria': 'Scope to wafer {wafer}, final yield {final}, first pass {firstPass}',
  'yield.showAllWafers': 'Show all {count} wafers',
  'yield.showFewer': 'Show fewer',
  'stage.evidenceCaption':
    '{dies} dies on {wafers} wafers, {here} on this wafer',

  // Magnifier
  'magnifier.coords': 'X, Y',
  'magnifier.site': 'Site',
  'magnifier.bin': 'Bin',
  'magnifier.hbin': 'HBIN',
  'magnifier.outOfLimits': 'out of limits',
  'magnifier.retested': 'Retested',
  'magnifier.retestedValue': 'Yes, {count} passes',
  'magnifier.notch': 'Notch',
  'magnifier.notchValue': "{clock} o'clock",

  // Selection popover
  'selection.dies.one': '{count} die',
  'selection.dies.other': '{count} dies',
  'selection.failing': 'Failing',
  'selection.yield': 'Yield',
  'selection.topBin': 'Top bin',
  'selection.none': 'None',
  'selection.clear': 'Clear',
  'selection.zoom': 'Zoom to selection',

  // Strip
  'strip.aria': 'Wafers in lot {lotId}',
  'strip.itemAria': 'Wafer {wafer}, yield {yield}',
  'strip.earlier': 'Earlier wafers',
  'strip.later': 'Later wafers',

  // Errors
  'error.notStdf.title': "This file isn't an STDF log.",
  'error.notStdf.body':
    'The first record must be FAR (0, 10). This file starts with bytes {hex}.',
  'error.version.title': "This STDF version isn't supported.",
  'error.version.body':
    'FAR reports STDF_VER {version}. Chip Autopsy Lab reads STDF V4.',
  'error.vax.title': "DEC VAX byte order isn't supported.",
  'error.vax.body':
    'FAR.CPU_TYPE is 0. Re-export the log with CPU_TYPE 1 or 2.',
  'error.truncated.title': 'The file ends in the middle of a record.',
  'error.truncated.body':
    'Record {recType} at byte {offset} needs {need} bytes, but only {have} remain. Wafers before it were read.',
  'error.gzip.title': "The gzip stream couldn't be decompressed.",
  'error.gzip.body':
    'The file starts with gzip bytes 1F 8B but the stream is corrupt at byte {offset}.',
  'error.empty.title': 'The file is empty.',
  'error.empty.body': 'Choose a file that contains STDF records.',
  'error.noParts.title': 'No tested dies found.',
  'error.noParts.body':
    'The log has no PRR records, so there is nothing to map.',
  'error.openAnother': 'Open another file',
  'error.loadDemo': 'Load demo lot',
  'error.showDetails': 'Show details',
  'error.detailsTitle': 'Details',

  // Bins-only
  'binsOnly.sheetTitle': 'This file is {size}.',
  'binsOnly.sheetBody':
    'Parsing every test result may take about {seconds}. Bins-only mode skips parametric results and keeps the wafer maps, bins, and yield.',
  'binsOnly.useBinsOnly': 'Use bins-only',
  'binsOnly.parseAll': 'Parse everything',
  'binsOnly.notice': 'Bins-only mode. Parametric findings are hidden.',

  // Toasts
  'toast.loaded': 'Loaded {wafers} wafers in {duration}.',
  'toast.skippedRecords': 'Skipped {count} unrecognized records.',
  'toast.downloaded': 'Downloaded {fileName}.',
  'toast.binsOnly': 'Bins-only mode is on.',
  'toast.dismiss': 'Dismiss',

  // Language
  'language.changed': 'Language changed to {language}.',
  'language.menuTitle': 'Language',

  // Shortcuts / a11y
  'shortcut.open': 'Open file',
  'a11y.skipToVerdict': 'Skip to verdict',
  'a11y.failingDiesTable': 'Failing dies on wafer {wafer}',
} as const;
