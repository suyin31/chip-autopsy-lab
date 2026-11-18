/**
 * Japanese (`ja`) message table (`src/core/i18n/messages/ja.ts`).
 *
 * Preserves untranslated technical identifiers (§6.6), deadpan literal headline (§7),
 * and identical `.one`/`.other` plural strings (§6.3).
 */

import type { Dictionary } from '../dictionary';

export const ja = {
  // App + nav
  'app.title': 'Chip Autopsy Lab',
  'app.description':
    'ウェハロットの歩留まり低下原因を特定。ブラウザ内で完結する STDF V4 解析ツール。',
  'nav.wordmark': 'Chip Autopsy Lab',
  'nav.wordmarkShort': 'Autopsy Lab',
  'nav.openFile': 'ファイルを開く',
  'nav.openStdfAria': 'STDF ファイルを開く',
  'nav.languageAria': '言語を変更',
  'nav.home': 'スタートに戻る',

  // Lot picker
  'lotPicker.triggerAria': 'ロットを選択、現在のロット {lotId}',
  'lotPicker.demoSection': 'サンプルロット',
  'lotPicker.recentSection': '最近のファイル',
  'lotPicker.openFile': 'ファイルを開く…',
  'lotPicker.yield': '歩留まり {yield}、{wafers} ウェハ',
  'lotPicker.current': '現在のロット',

  // Appearance (premium §7.1)
  'theme.label': '外観',
  'theme.ariaLabel': '外観: {preference}',
  'theme.ariaSystemLight': 'システム、現在はライト',
  'theme.ariaSystemDark': 'システム、現在はダーク',
  'theme.system': 'システムに合わせる',
  'theme.light': 'ライト',
  'theme.dark': 'ダーク',
  'theme.systemNote': '「システムに合わせる」はデバイスの設定に従います。',

  // Glossary (premium §2.3)
  'glossary.lot': '一緒に製造されたウェハのまとまり。同じロットの問題は原因が共通することが多い。',

  // Landing
  'landing.headline': '遺体をここに。',
  'landing.subline': 'ウェハロットの歩留まりが落ちた理由を調べます。STDF テストログをドロップすると、ダイに結び付いた原因がわかります。',
  'landing.primary': 'サンプルロットを開く',
  'landing.secondary': 'ファイルを開く',
  'landing.hint': '.stdf、.std、gzip ファイルをどこにでもドロップできます。ファイルはこの端末から出ません。',
  'landing.hintShort': 'ファイルはこの端末から出ません。',
  'landing.demoHeading': 'サンプルロット',
  'landing.privacy': 'すべてブラウザ内で動作します。',
  'landing.downloadDemos': 'サンプルファイルをダウンロード',
  'landing.cardMeta': '{wafers} ウェハ、{dies} ダイ',
  'report.footer': 'すべてブラウザ内で動作します。STDF の生データがこのデバイスの外に出ることはありません。',
  'demo.edgeRing.description': 'エッチング損傷でウェハ外周のダイが不良になります。',
  'demo.scratch.description': 'ロボットアームが 18 枚のウェハに線状の傷を付けました。',
  'demo.site2.description': '摩耗した 1 本のテスタ針が良品ダイを不良にします。',
  'demo.openAria': 'サンプルロット {title} を開く',
  'demo.edgeRing.title': 'Edge-Ring プラズマエッチング',
  'demo.scratch.title': 'ロボット搬送スクラッチ',
  'demo.site2.title': 'サイト 2 プローブ接触',

  // Drag overlay
  'drop.headline': '遺体をここに。',
  'drop.subline': '離して開く。STDF、STD、または gzip に対応。',
  'drop.notFile': 'ここで開けるのはファイルのみです。',

  // Loading
  'loading.readingRecords': 'レコードを読み込み中',
  'loading.readingWafer': 'ウェハ {current} / {total} を読み込み中',
  'loading.bytes': '{done} / {total}',
  'loading.skipHint': '任意のキーでアニメーションをスキップ。',
  'loading.progressAria': '解析中 {percent}',

  // Verdict
  'verdict.prefix': '死因：',
  'verdict.pattern': '{pattern} 不良。',
  'verdict.site': 'テストサイト {site} 接触不良。',
  'verdict.random': 'ランダム欠陥、空間パターンなし。',
  'verdict.healthy': '死因なし。',
  'verdict.showOnWafer': 'ウェハ上に表示',
  'verdict.causeAria': 'この判定の根拠となるダイを表示',
  'verdict.methodTitle': 'この判定の生成方法',
  'verdict.methodTemplate':
    'すべての数値は端末内の解析エンジンで算出され、文章は内蔵テンプレートから生成されています。',
  'verdict.methodLlm':
    'すべての数値は端末内の解析エンジンで算出されています。AI モデルが表現を整え、すべての文がエンジンの事実を引用しています。',

  // Takeaway and confidence (premium §7.3, §7.4, §9.3)
  'takeaway.edgeRing': '不良ダイの大半は各ウェハの外周 {rings} 周にあります。最終歩留まりは {yield} です。',
  'takeaway.scratch': '{total} 枚中 {count} 枚のウェハで、不良ダイが傷に沿って並んでいます。最終歩留まりは {yield} です。',
  'takeaway.center': '不良ダイの大半はウェハの中央にあります。最終歩留まりは {yield} です。',
  'takeaway.donut': '不良ダイの大半はウェハ中央を囲むリング状の領域にあります。最終歩留まりは {yield} です。',
  'takeaway.edgeLoc': '不良ダイの大半はウェハ外周の一部の領域にあります。最終歩留まりは {yield} です。',
  'takeaway.loc': '不良ダイの大半はウェハの一部の領域にあります。最終歩留まりは {yield} です。',
  'takeaway.nearFull': '不良ダイはウェハのほぼ全面に広がっています。最終歩留まりは {yield} です。',
  'takeaway.site': 'テストサイト {site} はダイの {rate} が不良で、他のサイトは {otherRate} です。最終歩留まりは {yield} です。',
  'takeaway.random': '不良は形を持たずに散らばっています。工程より先にテストを確認します。最終歩留まりは {yield} です。',
  'takeaway.healthy': '{total} 個中 {passed} 個のダイがすべてのテストに合格しました。',
  'confidence.high': '高い信頼度、{value}',
  'confidence.moderate': '中程度の信頼度、{value}',
  'confidence.low': '低い信頼度、{value}',
  'confidence.match': '{pattern} との一致度',
  'glossary.confidence': 'ウェハのパターンが指定のクラスにどれだけ一致するかを 0 から 1 で示します。この端末で計算します。',

  // Stats
  'stats.edgeShare': '外周 {rings} リング不良割合',
  'stats.scratchShare': 'スクラッチ経路不良割合',
  'stats.siteRate': 'サイト {site} 不良率、他サイト {other}',
  'stats.finalYield': '最終歩留まり',
  'stats.firstPass': '初回テストでは {firstPass}',
  'stats.failingDies': '不良ダイ、測定 {tested} 個中',
  'stats.inSelection': '選択範囲内の{caption}',

  // Findings
  'findings.label': '検出事項',
  'findings.dieCount.one': '{count} ダイ',
  'findings.dieCount.other': '{count} ダイ',
  'findings.inSelection': '選択範囲内 {count} / {total}',
  'findings.clear': 'クリア',
  'causes.label': '考えられる原因',
  'findings.checkNext': '次の確認',
  'findings.edgeBand.headline': '不良が最外周 {rings} 列に集中',
  'findings.edgeBand.sub':
    '外周不良率 {edgeRate} に対し内部 {interiorRate}（{wafers} / {total} ウェハ）',
  'findings.scratch.headline': '不良がスクラッチに沿って並ぶ（{wafers} ウェハ）',
  'findings.scratch.sub': '同一経路上に {dies} ダイ、全不良の {share}',
  'findings.dominantBin.headline': '1 つの不良タイプが損失の {share} を占める',
  'findings.dominantBin.sub': '{bin}、{dies} ダイ',
  'findings.secondaryBin.headline': '{bin} が全不良の {share} を占める',
  'findings.secondaryBin.sub': '{wafers} ウェハにわたり {dies} ダイ',
  'findings.capability.headline': '{kind} {test} が目標から大きく外れている',
  'findings.capability.sub': 'Cpk {cpk}、平均 {mean}、規格範囲 {lo} 〜 {hi}',
  'findings.site.headline': 'サイト {site} の不良は他サイトの {ratio} 倍',
  'findings.site.sub':
    'サイト {site} 不良率 {rate} に対し他サイト {other}、再測定 {retests} 件',
  'findings.excursion.headline': 'ウェハ {wafer} の歩留まりが {yield} に低下',
  'findings.excursion.sub': 'ロット中央値より {delta} 低下',
  'findings.lotYield.headline': '最終歩留まり {yield}',
  'findings.lotYield.sub': '初回 {firstPass}、再測定ダイ {retests}',
  'findings.more.one': '残り {count} 件の検出事項を表示',
  'findings.more.other': '残り {count} 件の検出事項を表示',
  'findings.meta': 'このウェハで {wafer}、全 {wafers} ウェハで {lot}',
  'findings.metaOneWafer': 'このウェハで {lot}',
  'findings.capability.close': '{kind} {test} が規格限界に近い',
  'findings.testKind.leakage': 'リーク電流テスト',
  'findings.testKind.current': '電流テスト',
  'findings.testKind.voltage': '電圧テスト',
  'findings.testKind.timing': 'タイミングテスト',
  'findings.testKind.frequency': '周波数テスト',
  'findings.testKind.generic': 'テスト',
  'findings.center.headline': '不良が中心に集中',
  'findings.donut.headline': '不良が中心の周りにリング状に分布',
  'findings.edgeLoc.headline': '不良が外周の一部に集中',
  'findings.loc.headline': '不良が一部の領域に集中',
  'findings.nearFull.headline': '不良がウェハのほぼ全面に分布',
  'findings.pattern.sub': '{dies} ダイ、不良ダイの {share}（{wafers} / {total} ウェハ）',
  'causes.note': 'これらは可能性の高い説明であり、証拠ではありません。装置ログで確認してください。',
  'causes.basedOn': '検出事項 {n} に基づく',
  'hypothesis.etchUniformity': '成膜またはエッチング均一性の偏り',
  'hypothesis.etchUniformity.check':
    '外周ゾーンのチャンバーログを比較し、フォーカスリングの使用時間を確認してください。',
  'hypothesis.mechanical': '機械搬送時のハンドリング接触',
  'hypothesis.mechanical.check':
    '該当スロットの搬送ブレード位置合わせを点検してください。',
  'hypothesis.probeCard': 'プロセスではなくプローブカードまたはテスタサイト起因',
  'hypothesis.probeCard.check':
    'サイト {site} のプローブ針を清掃または交換し、サンプルを再測定してください。',
  'hypothesis.random': 'ランダムなパーティクル欠陥',
  'hypothesis.random.check':
    '対象ロットのパーティクル数と欠陥検査記録を確認してください。',

  // Wafer stage
  'stage.aria': 'ウェハ {wafer}、{dies} ダイ、不良 {fails}',
  'stage.roleDescription': 'ウェハマップ',
  'stage.mode.hbin': 'HBIN',
  'stage.mode.sbin': 'SBIN',
  'stage.legend.toggleAria': '{bin} の表示を切り替え',
  'mode.passFail': '良/不良',
  'mode.hardBins': 'ハードビン',
  'mode.softBins': 'ソフトビン',
  'legend.failed': '不良',
  'legend.passed': '良',
  'legend.good': '良品',
  'legend.more': '他 +{count}',
  'stage.title': 'ウェハ {wafer}',
  'stage.caption': '{total} ダイ中 {failed} ダイが不良',
  'stage.reading': '読み込み中…',
  'stage.selected.one': '{count} ダイを選択',
  'stage.selected.other': '{count} ダイを選択',
  'stage.selectArea': '範囲を選択',
  'stage.selectAreaHint': '範囲を選択（S または Shift + ドラッグ）',
  'stage.resetView': '表示をリセット',
  // Bin Pareto
  'pareto.heading': 'ビン別の歩留まり損失',
  'pareto.modeAria': 'ビンの種類',
  'pareto.empty': 'この選択範囲に不良ダイはありません。',
  'pareto.rowDetail': 'テスト済みの {share}、累積 {cumulative}',
  'pareto.rowAria': '{bin} に絞り込み、{dies}、テスト済みの {share}',
  'pareto.showAll': 'すべての {count} ビンを表示',
  'pareto.showFewer': '表示を減らす',
  // Yield summary
  'yield.heading': '歩留まり',
  'yield.col.firstPass': '初回',
  'yield.col.final': '最終',
  'yield.col.retests': '再テスト',
  'yield.sites': 'テストサイト',
  'yield.wafers': 'ウェハ',
  'yield.wafersLowest': '歩留まりの低いウェハ',
  'yield.siteLabel': 'サイト {site}',
  'yield.siteLow': '他のサイトより低い',
  'yield.siteRowAria': 'サイト {site} に絞り込み、最終歩留まり {final}、初回 {firstPass}',
  'yield.waferRowAria': 'ウェハ {wafer} に絞り込み、最終歩留まり {final}、初回 {firstPass}',
  'yield.showAllWafers': 'すべての {count} 枚のウェハを表示',
  'yield.showFewer': '表示を減らす',
  'stage.evidenceCaption': '全 {wafers} ウェハ中 {dies} ダイ、このウェハに {here}',

  // Magnifier
  'magnifier.coords': 'X, Y',
  'magnifier.site': 'サイト',
  'magnifier.bin': 'ビン',
  'magnifier.hbin': 'HBIN',
  'magnifier.outOfLimits': '規格外',
  'magnifier.retested': '再測定',
  'magnifier.retestedValue': 'あり（{count} 回測定）',
  'magnifier.notch': 'ノッチ',
  'magnifier.notchValue': '{clock} 時方向',

  // Selection popover
  'selection.dies.one': '{count} ダイ',
  'selection.dies.other': '{count} ダイ',
  'selection.failing': '不良',
  'selection.yield': '歩留まり',
  'selection.topBin': '最頻ビン',
  'selection.none': 'なし',
  'selection.clear': 'クリア',
  'selection.zoom': '選択範囲にズーム',

  // Strip
  'strip.aria': 'ロット {lotId} のウェハ一覧',
  'strip.itemAria': 'ウェハ {wafer}、歩留まり {yield}',
  'strip.earlier': '前のウェハ',
  'strip.later': '後のウェハ',

  // Errors
  'error.notStdf.title': 'このファイルは STDF ログではありません。',
  'error.notStdf.body':
    '先頭レコードは FAR (0, 10) である必要があります。このファイルの先頭バイトは {hex} です。',
  'error.version.title': 'この STDF バージョンには対応していません。',
  'error.version.body':
    'FAR の STDF_VER は {version} です。Chip Autopsy Lab は STDF V4 を読み込みます。',
  'error.vax.title': 'DEC VAX バイト順には対応していません。',
  'error.vax.body':
    'FAR.CPU_TYPE が 0 です。CPU_TYPE 1 または 2 でログを再出力してください。',
  'error.truncated.title': 'レコードの途中でファイルが終了しています。',
  'error.truncated.body':
    'バイト {offset} のレコード {recType} には {need} バイト必要ですが、残り {have} バイトしかありません。手前のウェハは読み込まれました。',
  'error.gzip.title': 'gzip ストリームを展開できませんでした。',
  'error.gzip.body':
    '先頭は gzip バイト 1F 8B ですが、バイト {offset} でストリームが破損しています。',
  'error.empty.title': 'ファイルが空です。',
  'error.empty.body': 'STDF レコードを含むファイルを選択してください。',
  'error.noParts.title': '測定済みダイが見つかりません。',
  'error.noParts.body': 'ログに PRR レコードがないため、マップを描画できません。',
  'error.openAnother': '別のファイルを開く',
  'error.loadDemo': 'デモロットを読み込む',
  'error.showDetails': '詳細を表示',
  'error.detailsTitle': '詳細',

  // Bins-only
  'binsOnly.sheetTitle': 'このファイルは {size} あります。',
  'binsOnly.sheetBody':
    '全パラメトリック測定値の解析には約 {seconds} かかります。ビンのみモードではパラメトリック結果を省略し、ウェハマップ・ビン・歩留まりを保持します。',
  'binsOnly.useBinsOnly': 'ビンのみモードを使う',
  'binsOnly.parseAll': 'すべて解析する',
  'binsOnly.notice': 'ビンのみモード。パラメトリック検出事項は非表示です。',

  // Toasts
  'toast.loaded': '{wafers} ウェハを {duration} で読み込みました。',
  'toast.skippedRecords': '未認識レコード {count} 件をスキップしました。',
  'toast.downloaded': '{fileName} をダウンロードしました。',
  'toast.binsOnly': 'ビンのみモードが有効です。',
  'toast.dismiss': '閉じる',

  // Language
  'language.changed': '言語を {language} に変更しました。',
  'language.menuTitle': '言語',

  // Shortcuts / a11y
  'shortcut.open': 'ファイルを開く',
  'a11y.skipToVerdict': '判定へスキップ',
  'a11y.failingDiesTable': 'ウェハ {wafer} の不良ダイ一覧',
} as const satisfies Dictionary;
