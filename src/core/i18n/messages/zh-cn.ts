/**
 * Simplified Chinese (`zh-CN`) message table (`src/core/i18n/messages/zh-cn.ts`).
 *
 * Preserves untranslated technical identifiers (§6.6), deadpan literal headline (§7),
 * and identical `.one`/`.other` plural strings (§6.3).
 */

import type { Dictionary } from '../dictionary';

export const zhCN = {
  // App + nav
  'app.title': 'Chip Autopsy Lab',
  'app.description': '查明晶圆批次良率损失原因。在浏览器本地运行的 STDF V4 分析工具。',
  'nav.wordmark': 'Chip Autopsy Lab',
  'nav.wordmarkShort': 'Autopsy Lab',
  'nav.openStdf': '打开 STDF',
  'nav.openStdfAria': '打开 STDF 文件',
  'nav.languageAria': '切换语言',
  'nav.home': '返回起始页',

  // Lot picker
  'lotPicker.triggerAria': '选择批次，当前批次 {lotId}',
  'lotPicker.demoSection': '示例批次',
  'lotPicker.recentSection': '最近打开',
  'lotPicker.openFile': '打开 STDF 文件…',
  'lotPicker.yield': '良率 {yield}',
  'lotPicker.current': '当前批次',

  // Landing
  'landing.headline': '把遗体放这里。',
  'landing.subline':
    '将 STDF V4 晶圆测试日志拖放到页面任意位置。数据仅在本机解析，绝不上传。',
  'landing.primary': '打开 STDF 文件',
  'landing.formats': '.stdf、.std 或 gzip',
  'landing.demoHeading': '或打开示例批次',
  'landing.privacy': '全程在浏览器本地运行。原始 STDF 字节绝不离开此设备。',
  'landing.downloadDemos': '下载示例文件',
  'landing.demoMeta': '{wafers} 片晶圆，{dies} 颗晶粒',
  'demo.edgeRing.title': 'Edge-Ring 等离子体刻蚀异常',
  'demo.edgeRing.description': '聚焦环侵蚀导致外环 IDDQ 漏电',
  'demo.scratch.title': '机械手传输划伤',
  'demo.scratch.description': '传输叶片划痕横跨第 5 至第 22 片晶圆',
  'demo.site2.title': '第 2 工位探针接触不良',
  'demo.site2.description': '第 2 工位探针氧化引发开路与复测',
  'demo.openAria': '打开示例批次 {title}',

  // Drag overlay
  'drop.headline': '把遗体放这里。',
  'drop.subline': '松开即可打开。支持 STDF、STD 或 gzip。',
  'drop.notFile': '此处仅可打开文件。',

  // Loading
  'loading.readingRecords': '正在读取记录',
  'loading.readingWafer': '正在读取第 {current} / {total} 片晶圆',
  'loading.bytes': '{done} / {total}',
  'loading.skipHint': '按任意键跳过动画。',
  'loading.progressAria': '正在解析 {percent}',

  // Verdict
  'verdict.prefix': '死因：',
  'verdict.pattern': '{pattern} 失效。',
  'verdict.site': '测试工位 {site} 接触失效。',
  'verdict.random': '随机缺陷，无空间分布特征。',
  'verdict.healthy': '无致死异常。良率为 {yield}。',
  'verdict.subline': '共 {wafers} 片晶圆，良率 {yield}。主要损失位于 {bin}。',
  'verdict.causeAria': '显示此结论对应的晶粒',
  'verdict.confidence': '置信度 {value}',
  'verdict.methodTitle': '结论生成方式',
  'verdict.methodTemplate':
    '所有数值均由本机分析引擎计算，文本采用内置模板生成。',
  'verdict.methodLlm':
    '所有数值均由本机分析引擎计算。AI 模型仅对表述进行润色，且每句话均引用引擎事实。',

  // Stats
  'stats.edgeShare': '的失效位于外侧 {rings} 环',
  'stats.scratchShare': '的失效位于划痕路径上',
  'stats.siteRate': '工位 {site} 失效率（其余工位 {other}）',
  'stats.finalYield': '最终良率，初测 {firstPass}',
  'stats.failingDies': '颗失效晶粒（共测 {tested} 颗）',
  'stats.inSelection': '选区内{caption}',

  // Findings
  'findings.heading': '分析发现',
  'findings.dieCount.one': '{count} 颗晶粒',
  'findings.dieCount.other': '{count} 颗晶粒',
  'findings.inSelection': '选区内 {count} / {total}',
  'findings.clear': '清除',
  'findings.possibleCauses': '可能原因',
  'findings.checkNext': '下一步排查：{step}',
  'findings.edgeBand.headline': '{share} 的失效集中在边缘环带',
  'findings.edgeBand.sub':
    '边缘失效率 {edgeRate}，内部 {interiorRate}，涉及 {wafers} / {total} 片晶圆',
  'findings.scratch.headline': '划痕贯穿 {wafers} 片晶圆',
  'findings.scratch.sub': '同一路径上 {dies} 颗晶粒，占失效总数的 {share}',
  'findings.dominantBin.headline': '{bin} 造成主要良率损失',
  'findings.dominantBin.sub': '{dies} 颗晶粒，占失效总数的 {share}',
  'findings.secondaryBin.headline': '{bin} 占失效总数的 {share}',
  'findings.secondaryBin.sub': '分布在 {wafers} 片晶圆上的 {dies} 颗晶粒',
  'findings.capability.headline': '测试项 {test} 的 Cpk 为 {cpk}',
  'findings.capability.sub': '均值 {mean}，规格限 {lo} 至 {hi}',
  'findings.site.headline': '工位 {site} 失效率高出 {ratio} 倍',
  'findings.site.sub':
    '工位 {site} 失效率 {rate}，其余工位 {other}，复测 {retests} 次',
  'findings.excursion.headline': '晶圆 {wafer} 良率跌至 {yield}',
  'findings.excursion.sub': '低于批次中位数 {delta}',
  'findings.lotYield.headline': '最终良率 {yield}',
  'findings.lotYield.sub': '初测良率 {firstPass}，复测晶粒 {retests} 颗',
  'hypothesis.etchUniformity': '沉积或刻蚀均匀性异常',
  'hypothesis.etchUniformity.check':
    '比对边缘区域腔室日志并核查聚焦环累计使用时长。',
  'hypothesis.mechanical': '机械传输损伤',
  'hypothesis.mechanical.check': '检查受影响槽位的传输叶片对准状态。',
  'hypothesis.probeCard': '探针卡或测试机工位问题，非制程异常',
  'hypothesis.probeCard.check': '清洁或更换工位 {site} 探针并抽样复测。',
  'hypothesis.random': '随机颗粒缺陷',
  'hypothesis.random.check': '核查该批次的颗粒计数与缺陷检测记录。',

  // Wafer stage
  'stage.aria': '晶圆 {wafer}，共 {dies} 颗晶粒，{fails} 颗失效',
  'stage.roleDescription': '晶圆图',
  'stage.mode.passFail': '合格/失效',
  'stage.mode.hbin': 'HBIN',
  'stage.mode.sbin': 'SBIN',
  'stage.tool.pan': '平移',
  'stage.tool.select': '框选',
  'stage.legend.pass': '合格 {count}',
  'stage.legend.fail': '失效 {count}',
  'stage.legend.more': '另外 {count} 项',
  'stage.legend.toggleAria': '显示或隐藏 {bin}',
  'stage.zoomReset': '重置缩放',
  'stage.evidenceCaption': '共 {wafers} 片晶圆 {dies} 颗晶粒，本片 {here} 颗',

  // Magnifier
  'magnifier.coords': 'X, Y',
  'magnifier.site': '工位',
  'magnifier.bin': '分档',
  'magnifier.hbin': 'HBIN',
  'magnifier.outOfLimits': '超出规格限',
  'magnifier.retested': '已复测',
  'magnifier.retestedValue': '是，共 {count} 次测试',
  'magnifier.notch': '切口',
  'magnifier.notchValue': '{clock} 点钟方向',

  // Selection popover
  'selection.dies.one': '{count} 颗晶粒',
  'selection.dies.other': '{count} 颗晶粒',
  'selection.failing': '失效',
  'selection.yield': '良率',
  'selection.topBin': '主要分档',
  'selection.none': '无',
  'selection.clear': '清除',
  'selection.zoom': '缩放到选区',

  // Strip
  'strip.aria': '批次 {lotId} 中的晶圆',
  'strip.itemAria': '晶圆 {wafer}，良率 {yield}',

  // Errors
  'error.notStdf.title': '此文件不是 STDF 日志。',
  'error.notStdf.body':
    '首条记录必须为 FAR (0, 10)。此文件起始字节为 {hex}。',
  'error.version.title': '不支持此 STDF 版本。',
  'error.version.body':
    'FAR 报告 STDF_VER 为 {version}。Chip Autopsy Lab 仅读取 STDF V4。',
  'error.vax.title': '不支持 DEC VAX 字节序。',
  'error.vax.body':
    'FAR.CPU_TYPE 为 0。请使用 CPU_TYPE 1 或 2 重新导出日志。',
  'error.truncated.title': '文件在记录中间截断。',
  'error.truncated.body':
    '位于字节 {offset} 的记录 {recType} 需要 {need} 字节，但仅剩 {have} 字节。此前完成的晶圆已成功读取。',
  'error.gzip.title': '无法解压 gzip 数据流。',
  'error.gzip.body':
    '文件以 gzip 字节 1F 8B 开头，但数据流在字节 {offset} 处损坏。',
  'error.empty.title': '文件为空。',
  'error.empty.body': '请选择包含 STDF 记录的文件。',
  'error.noParts.title': '未找到已测晶粒。',
  'error.noParts.body': '日志中不包含 PRR 记录，无法生成晶圆图。',
  'error.openAnother': '打开其他文件',
  'error.loadDemo': '加载示例批次',
  'error.showDetails': '查看详情',
  'error.detailsTitle': '详情',

  // Bins-only
  'binsOnly.sheetTitle': '此文件大小为 {size}。',
  'binsOnly.sheetBody':
    '解析全部参数测试结果约需 {seconds}。仅分档模式会跳过参数结果，保留晶圆图、分档与良率。',
  'binsOnly.useBinsOnly': '使用仅分档模式',
  'binsOnly.parseAll': '解析全部内容',
  'binsOnly.notice': '仅分档模式。参数类发现已隐藏。',

  // Toasts
  'toast.loaded': '已在 {duration} 内加载 {wafers} 片晶圆。',
  'toast.skippedRecords': '已跳过 {count} 条未识别记录。',
  'toast.downloaded': '已下载 {fileName}。',
  'toast.binsOnly': '仅分档模式已开启。',
  'toast.dismiss': '关闭',

  // Language
  'language.changed': '语言已切换为 {language}。',
  'language.menuTitle': '语言',

  // Shortcuts / a11y
  'shortcut.open': '打开文件',
  'a11y.skipToVerdict': '跳至分析结论',
  'a11y.failingDiesTable': '晶圆 {wafer} 上的失效晶粒',
} as const satisfies Dictionary;
