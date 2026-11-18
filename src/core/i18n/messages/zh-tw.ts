/**
 * Traditional Chinese (`zh-TW`) message table (`src/core/i18n/messages/zh-tw.ts`).
 *
 * Preserves untranslated technical identifiers (§6.6), deadpan literal headline (§7),
 * and identical `.one`/`.other` plural strings (§6.3).
 */

import type { Dictionary } from '../dictionary';

export const zhTW = {
  // App + nav
  'app.title': 'Chip Autopsy Lab',
  'app.description': '查明晶圓批次良率損失原因。在瀏覽器本機執行的 STDF V4 分析工具。',
  'nav.wordmark': 'Chip Autopsy Lab',
  'nav.wordmarkShort': 'Autopsy Lab',
  'nav.openStdf': '開啟 STDF',
  'nav.openStdfAria': '開啟 STDF 檔案',
  'nav.languageAria': '切換語言',
  'nav.home': '返回起始頁',

  // Lot picker
  'lotPicker.triggerAria': '選擇批次，目前批次 {lotId}',
  'lotPicker.demoSection': '範例批次',
  'lotPicker.recentSection': '最近開啟',
  'lotPicker.openFile': '開啟 STDF 檔案…',
  'lotPicker.yield': '良率 {yield}',
  'lotPicker.current': '目前批次',

  // Landing
  'landing.headline': '把遺體放這裡。',
  'landing.subline':
    '將 STDF V4 晶圓測試記錄拖放至此頁任意位置。檔案僅在本機解析，絕不外傳。',
  'landing.primary': '開啟 STDF 檔案',
  'landing.formats': '.stdf、.std 或 gzip',
  'landing.demoHeading': '或開啟範例批次',
  'landing.privacy': '全程在瀏覽器本機執行。原始 STDF 資料絕不離開此裝置。',
  'landing.downloadDemos': '下載範例檔案',
  'landing.demoMeta': '{wafers} 片晶圓，{dies} 顆晶粒',
  'demo.edgeRing.title': 'Edge-Ring 電漿蝕刻',
  'demo.edgeRing.description': '聚焦環耗損導致外環 IDDQ 漏電',
  'demo.scratch.title': '機械手臂傳送刮傷',
  'demo.scratch.description': '傳送葉片刮痕橫跨第 5 至第 22 片晶圓',
  'demo.site2.title': '站點 2 探針接觸',
  'demo.site2.description': '站點 2 探針氧化引發開路與重測',
  'demo.openAria': '開啟範例批次 {title}',

  // Drag overlay
  'drop.headline': '把遺體放這裡。',
  'drop.subline': '放開即可開啟。支援 STDF、STD 或 gzip。',
  'drop.notFile': '此處僅能開啟檔案。',

  // Loading
  'loading.readingRecords': '正在讀取記錄',
  'loading.readingWafer': '正在讀取第 {current} / {total} 片晶圓',
  'loading.bytes': '{done} / {total}',
  'loading.skipHint': '按任意鍵略過動畫。',
  'loading.progressAria': '正在解析 {percent}',

  // Verdict
  'verdict.prefix': '死因：',
  'verdict.pattern': '{pattern} 失效。',
  'verdict.site': '測試站點 {site} 接觸失效。',
  'verdict.random': '隨機缺陷，無空間分佈特徵。',
  'verdict.healthy': '無死因。良率為 {yield}。',
  'verdict.subline': '共 {wafers} 片晶圓，良率 {yield}。主要損失集中於 {bin}。',
  'verdict.causeAria': '顯示此結論對應的晶粒',
  'verdict.confidence': '信心度 {value}',
  'verdict.methodTitle': '結論產生方式',
  'verdict.methodTemplate':
    '所有數值皆由本機分析引擎計算，文字採用內建範本產生。',
  'verdict.methodLlm':
    '所有數值皆由本機分析引擎計算。AI 模型僅潤飾語句，每句話皆引用引擎事實。',

  // Stats
  'stats.edgeShare': '外側 {rings} 環失效佔比',
  'stats.scratchShare': '刮痕路徑失效佔比',
  'stats.siteRate': '站點 {site} 失效率（其餘站點 {other}）',
  'stats.finalYield': '最終良率，初測 {firstPass}',
  'stats.failingDies': '失效晶粒（共測 {tested} 顆）',
  'stats.inSelection': '選取範圍內{caption}',

  // Findings
  'findings.heading': '分析發現',
  'findings.dieCount.one': '{count} 顆晶粒',
  'findings.dieCount.other': '{count} 顆晶粒',
  'findings.inSelection': '選取範圍內 {count} / {total}',
  'findings.clear': '清除',
  'findings.possibleCauses': '可能原因',
  'findings.checkNext': '下一步檢查：{step}',
  'findings.edgeBand.headline': '{share} 的失效集中於邊緣環帶',
  'findings.edgeBand.sub':
    '邊緣失效率 {edgeRate}，內部 {interiorRate}，涵蓋 {wafers} / {total} 片晶圓',
  'findings.scratch.headline': '刮痕橫跨 {wafers} 片晶圓',
  'findings.scratch.sub': '同一路徑上 {dies} 顆晶粒，佔失效總數 {share}',
  'findings.dominantBin.headline': '{bin} 造成主要良率損失',
  'findings.dominantBin.sub': '{dies} 顆晶粒，佔失效總數 {share}',
  'findings.secondaryBin.headline': '{bin} 佔失效總數 {share}',
  'findings.secondaryBin.sub': '分佈於 {wafers} 片晶圓上的 {dies} 顆晶粒',
  'findings.capability.headline': '測試項 {test} 的 Cpk 為 {cpk}',
  'findings.capability.sub': '平均值 {mean}，規格限 {lo} 至 {hi}',
  'findings.site.headline': '站點 {site} 失效率為其他站點的 {ratio} 倍',
  'findings.site.sub':
    '站點 {site} 失效率 {rate}，其餘站點 {other}，重測 {retests} 次',
  'findings.excursion.headline': '晶圓 {wafer} 良率降至 {yield}',
  'findings.excursion.sub': '低於批次中位數 {delta}',
  'findings.lotYield.headline': '最終良率 {yield}',
  'findings.lotYield.sub': '初測良率 {firstPass}，重測晶粒 {retests} 顆',
  'hypothesis.etchUniformity': '沉積或蝕刻均勻度異常',
  'hypothesis.etchUniformity.check':
    '比對邊緣區域腔體記錄並檢查聚焦環累積使用時數。',
  'hypothesis.mechanical': '機械傳送刮損',
  'hypothesis.mechanical.check': '檢查受影響槽位的傳送葉片對位狀態。',
  'hypothesis.probeCard': '探針卡或測試機站點問題，非製程異常',
  'hypothesis.probeCard.check': '清潔或更換站點 {site} 探針並抽樣重測。',
  'hypothesis.random': '隨機微粒缺陷',
  'hypothesis.random.check': '檢視該批次的微粒計數與缺陷檢測記錄。',

  // Wafer stage
  'stage.aria': '晶圓 {wafer}，共 {dies} 顆晶粒，{fails} 顆失效',
  'stage.roleDescription': '晶圓圖',
  'stage.mode.passFail': '合格/失效',
  'stage.mode.hbin': 'HBIN',
  'stage.mode.sbin': 'SBIN',
  'stage.tool.pan': '平移',
  'stage.tool.select': '框選',
  'stage.legend.pass': '合格 {count}',
  'stage.legend.fail': '失效 {count}',
  'stage.legend.more': '另外 {count} 項',
  'stage.legend.toggleAria': '顯示或隱藏 {bin}',
  'stage.zoomReset': '重設縮放',
  // Bin Pareto
  'pareto.heading': '各 Bin 的良率損失',
  'pareto.modeAria': 'Bin 類型',
  'pareto.empty': '目前選取範圍內沒有失效晶粒。',
  'pareto.rowDetail': '佔測試總數 {share}，累計 {cumulative}',
  'pareto.rowAria': '篩選 {bin}，{dies}，佔測試總數 {share}',
  'pareto.showAll': '顯示全部 {count} 個 Bin',
  'pareto.showFewer': '收合',
  'stage.evidenceCaption': '共 {wafers} 片晶圓 {dies} 顆晶粒，本片 {here} 顆',

  // Magnifier
  'magnifier.coords': 'X, Y',
  'magnifier.site': '站點',
  'magnifier.bin': '分級',
  'magnifier.hbin': 'HBIN',
  'magnifier.outOfLimits': '超出規格限',
  'magnifier.retested': '已重測',
  'magnifier.retestedValue': '是，共測 {count} 次',
  'magnifier.notch': '缺口',
  'magnifier.notchValue': '{clock} 點鐘方向',

  // Selection popover
  'selection.dies.one': '{count} 顆晶粒',
  'selection.dies.other': '{count} 顆晶粒',
  'selection.failing': '失效',
  'selection.yield': '良率',
  'selection.topBin': '主要分級',
  'selection.none': '無',
  'selection.clear': '清除',
  'selection.zoom': '縮放至選取範圍',

  // Strip
  'strip.aria': '批次 {lotId} 中的晶圓',
  'strip.itemAria': '晶圓 {wafer}，良率 {yield}',

  // Errors
  'error.notStdf.title': '此檔案不是 STDF 記錄檔。',
  'error.notStdf.body':
    '第一筆記錄必須為 FAR (0, 10)。此檔案起始位元組為 {hex}。',
  'error.version.title': '不支援此 STDF 版本。',
  'error.version.body':
    'FAR 回報 STDF_VER 為 {version}。Chip Autopsy Lab 僅讀取 STDF V4。',
  'error.vax.title': '不支援 DEC VAX 位元組順序。',
  'error.vax.body':
    'FAR.CPU_TYPE 為 0。請改用 CPU_TYPE 1 或 2 重新匯出記錄檔。',
  'error.truncated.title': '檔案在記錄中途截斷。',
  'error.truncated.body':
    '位於位元組 {offset} 的記錄 {recType} 需要 {need} 位元組，但僅剩 {have} 位元組。先前完成的晶圓已成功讀取。',
  'error.gzip.title': '無法解壓縮 gzip 串流。',
  'error.gzip.body':
    '檔案以 gzip 位元組 1F 8B 開頭，但串流在位元組 {offset} 處損毀。',
  'error.empty.title': '檔案為空。',
  'error.empty.body': '請選擇包含 STDF 記錄的檔案。',
  'error.noParts.title': '找不到已測晶粒。',
  'error.noParts.body': '記錄檔中沒有 PRR 記錄，無法繪製晶圓圖。',
  'error.openAnother': '開啟其他檔案',
  'error.loadDemo': '載入範例批次',
  'error.showDetails': '顯示詳細資訊',
  'error.detailsTitle': '詳細資訊',

  // Bins-only
  'binsOnly.sheetTitle': '此檔案大小為 {size}。',
  'binsOnly.sheetBody':
    '解析所有參數測試結果約需 {seconds}。僅分級模式會略過參數結果，並保留晶圓圖、分級與良率。',
  'binsOnly.useBinsOnly': '使用僅分級模式',
  'binsOnly.parseAll': '解析全部內容',
  'binsOnly.notice': '僅分級模式。參數類發現已隱藏。',

  // Toasts
  'toast.loaded': '已於 {duration} 內載入 {wafers} 片晶圓。',
  'toast.skippedRecords': '已略過 {count} 筆未識別記錄。',
  'toast.downloaded': '已下載 {fileName}。',
  'toast.binsOnly': '僅分級模式已啟用。',
  'toast.dismiss': '關閉',

  // Language
  'language.changed': '語言已切換為 {language}。',
  'language.menuTitle': '語言',

  // Shortcuts / a11y
  'shortcut.open': '開啟檔案',
  'a11y.skipToVerdict': '跳至分析結論',
  'a11y.failingDiesTable': '晶圓 {wafer} 上的失效晶粒',
} as const satisfies Dictionary;
