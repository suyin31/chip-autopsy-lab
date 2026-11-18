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
  'nav.openStdf': 'STDF を開く',
  'nav.openStdfAria': 'STDF ファイルを開く',
  'nav.languageAria': '言語を変更',
  'nav.home': 'スタートに戻る',

  // Lot picker
  'lotPicker.triggerAria': 'ロットを選択、現在のロット {lotId}',
  'lotPicker.demoSection': 'デモロット',
  'lotPicker.recentSection': '最近開いたファイル',
  'lotPicker.openFile': 'STDF ファイルを開く…',
  'lotPicker.yield': '歩留まり {yield}',
  'lotPicker.current': '現在のロット',

  // Landing
  'landing.headline': '遺体をここに。',
  'landing.subline':
    'STDF V4 ウェハテストログをページ上の任意の場所にドロップしてください。この端末内で解析され、送信されません。',
  'landing.primary': 'STDF ファイルを開く',
  'landing.formats': '.stdf、.std、または gzip',
  'landing.demoHeading': 'またはデモロットを開く',
  'landing.privacy':
    'すべてブラウザ内で完結します。STDF の生データがこの端末から外部へ送信されることはありません。',
  'landing.downloadDemos': 'デモファイルをダウンロード',
  'landing.demoMeta': '{wafers} ウェハ、{dies} ダイ',
  'demo.edgeRing.title': 'Edge-Ring プラズマエッチング',
  'demo.edgeRing.description': 'フォーカスリング摩耗による外周 IDDQ リーク',
  'demo.scratch.title': 'ロボット搬送スクラッチ',
  'demo.scratch.description': 'ウェハ 5〜22 を横断する搬送ブレードのスクラッチ',
  'demo.site2.title': 'サイト 2 プローブ接触',
  'demo.site2.description': 'サイト 2 プローブ針の酸化によるオープン不良と再測定',
  'demo.openAria': 'デモロット {title} を開く',

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
  'verdict.healthy': '死因なし。歩留まりは {yield} です。',
  'verdict.subline':
    '全 {wafers} ウェハで歩留まり {yield}。主な損失は {bin}。',
  'verdict.causeAria': 'この判定の根拠となるダイを表示',
  'verdict.confidence': '信頼度 {value}',
  'verdict.methodTitle': 'この判定の生成方法',
  'verdict.methodTemplate':
    'すべての数値は端末内の解析エンジンで算出され、文章は内蔵テンプレートから生成されています。',
  'verdict.methodLlm':
    'すべての数値は端末内の解析エンジンで算出されています。AI モデルが表現を整え、すべての文がエンジンの事実を引用しています。',

  // Stats
  'stats.edgeShare': '外周 {rings} リング不良割合',
  'stats.scratchShare': 'スクラッチ経路不良割合',
  'stats.siteRate': 'サイト {site} 不良率、他サイト {other}',
  'stats.finalYield': '最終歩留まり、初回 {firstPass}',
  'stats.failingDies': '不良ダイ / 測定 {tested}',
  'stats.inSelection': '選択範囲内の{caption}',

  // Findings
  'findings.heading': '検出事項',
  'findings.dieCount.one': '{count} ダイ',
  'findings.dieCount.other': '{count} ダイ',
  'findings.inSelection': '選択範囲内 {count} / {total}',
  'findings.clear': 'クリア',
  'findings.possibleCauses': '考えられる原因',
  'findings.checkNext': '次の確認：{step}',
  'findings.edgeBand.headline': '不良の {share} が外周バンドに集中',
  'findings.edgeBand.sub':
    '外周不良率 {edgeRate} に対し内部 {interiorRate}（{wafers} / {total} ウェハ）',
  'findings.scratch.headline': 'スクラッチが {wafers} ウェハを横断',
  'findings.scratch.sub': '同一経路上に {dies} ダイ、全不良の {share}',
  'findings.dominantBin.headline': '{bin} が最大の損失要因',
  'findings.dominantBin.sub': '{dies} ダイ、全不良の {share}',
  'findings.secondaryBin.headline': '{bin} が全不良の {share} を占める',
  'findings.secondaryBin.sub': '{wafers} ウェハにわたり {dies} ダイ',
  'findings.capability.headline': 'テスト {test} の Cpk は {cpk}',
  'findings.capability.sub': '平均 {mean}（規格範囲 {lo} 〜 {hi}）',
  'findings.site.headline': 'サイト {site} の不良率が {ratio} 倍',
  'findings.site.sub':
    'サイト {site} 不良率 {rate} に対し他サイト {other}、再測定 {retests} 件',
  'findings.excursion.headline': 'ウェハ {wafer} の歩留まりが {yield} に低下',
  'findings.excursion.sub': 'ロット中央値より {delta} 低下',
  'findings.lotYield.headline': '最終歩留まり {yield}',
  'findings.lotYield.sub': '初回 {firstPass}、再測定ダイ {retests}',
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
  'stage.mode.passFail': '良/不良',
  'stage.mode.hbin': 'HBIN',
  'stage.mode.sbin': 'SBIN',
  'stage.tool.pan': 'パン',
  'stage.tool.select': '選択',
  'stage.legend.pass': '良 {count}',
  'stage.legend.fail': '不良 {count}',
  'stage.legend.more': '他 +{count}',
  'stage.legend.toggleAria': '{bin} の表示を切り替え',
  'stage.zoomReset': 'ズームをリセット',
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
