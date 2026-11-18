/**
 * Korean (`ko`) message table (`src/core/i18n/messages/ko.ts`).
 *
 * Preserves untranslated technical identifiers (§6.6), deadpan literal headline (§7),
 * and identical `.one`/`.other` plural strings (§6.3).
 */

import type { Dictionary } from '../dictionary';

export const ko = {
  // App + nav
  'app.title': 'Chip Autopsy Lab',
  'app.description':
    '웨이퍼 로트의 수율 저하 원인을 규명합니다. 브라우저에서 바로 실행되는 STDF V4 분석 도구입니다.',
  'nav.wordmark': 'Chip Autopsy Lab',
  'nav.wordmarkShort': 'Autopsy Lab',
  'nav.openFile': '파일 열기',
  'nav.openStdfAria': 'STDF 파일 열기',
  'nav.languageAria': '언어 변경',
  'nav.home': '처음으로 돌아가기',

  // Lot picker
  'lotPicker.triggerAria': '로트 선택, 현재 로트 {lotId}',
  'lotPicker.demoSection': '샘플 로트',
  'lotPicker.recentSection': '최근 파일',
  'lotPicker.openFile': '파일 열기…',
  'lotPicker.yield': '수율 {yield}, 웨이퍼 {wafers}장',
  'lotPicker.current': '현재 로트',

  // Appearance (premium §7.1)
  'theme.label': '모양',
  'theme.ariaLabel': '모양: {preference}',
  'theme.ariaSystemLight': '시스템, 현재 라이트',
  'theme.ariaSystemDark': '시스템, 현재 다크',
  'theme.system': '시스템 설정에 맞춤',
  'theme.light': '라이트',
  'theme.dark': '다크',
  'theme.systemNote': '시스템 설정에 맞춤은 기기 설정을 따릅니다.',

  // Glossary (premium §2.3)
  'glossary.lot': '함께 제조된 웨이퍼 묶음입니다. 한 로트의 문제는 원인이 같은 경우가 많습니다.',

  // Landing
  'landing.headline': '시신을 여기에.',
  'landing.subline': '웨이퍼 로트의 수율이 떨어진 이유를 찾습니다. STDF 테스트 로그를 놓으면 다이와 연결된 원인을 보여 줍니다.',
  'landing.primary': '샘플 로트 열기',
  'landing.secondary': '파일 열기',
  'landing.hint': '.stdf, .std 또는 gzip 파일을 아무 곳에나 놓아도 됩니다. 파일은 이 기기에만 남습니다.',
  'landing.hintShort': '파일은 이 기기에만 남습니다.',
  'landing.demoHeading': '샘플 로트',
  'landing.privacy': '모든 과정이 브라우저에서 실행됩니다.',
  'landing.downloadDemos': '샘플 파일 다운로드',
  'landing.cardMeta': '웨이퍼 {wafers}장, 다이 {dies}개',
  'report.footer': '모든 과정이 브라우저에서 실행됩니다. STDF 원본 데이터는 이 기기를 벗어나지 않습니다.',
  'demo.edgeRing.description': '식각 손상으로 웨이퍼 가장자리의 다이가 불량이 됩니다.',
  'demo.scratch.description': '로봇 암이 웨이퍼 18장에 선 모양의 긁힘을 냈습니다.',
  'demo.site2.description': '마모된 테스터 바늘 하나가 양품 다이를 불량으로 판정합니다.',
  'demo.openAria': '샘플 로트 {title} 열기',
  'demo.edgeRing.title': 'Edge-Ring 플라즈마 식각',
  'demo.scratch.title': '로봇 반송 스크래치',
  'demo.site2.title': '사이트 2 프로브 접촉',

  // Drag overlay
  'drop.headline': '시신을 여기에.',
  'drop.subline': '놓으면 열립니다. STDF, STD 또는 gzip 지원.',
  'drop.notFile': '여기서는 파일만 열 수 있습니다.',

  // Loading
  'loading.readingRecords': '레코드 읽는 중',
  'loading.readingWafer': '웨이퍼 {current} / {total} 읽는 중',
  'loading.bytes': '{done} / {total}',
  'loading.skipHint': '아무 키나 눌러 애니메이션을 건너뛰세요.',
  'loading.progressAria': '{percent} 파싱 중',

  // Verdict
  'verdict.prefix': '사인:',
  'verdict.pattern': '{pattern} 불량.',
  'verdict.site': '테스트 사이트 {site} 접촉 불량.',
  'verdict.random': '무작위 결함, 공간 패턴 없음.',
  'verdict.healthy': '사인 없음. 수율은 {yield}입니다.',
  'verdict.subline':
    '웨이퍼 {wafers}장 전체 수율 {yield}. 주요 손실 구간은 {bin}.',
  'verdict.causeAria': '이 판정의 근거 다이 표시',
  'verdict.confidence': '신뢰도 {value}',
  'verdict.methodTitle': '판정 생성 방식',
  'verdict.methodTemplate':
    '모든 수치는 기기 내 분석 엔진에서 계산되며 문장은 내장 템플릿으로 작성됩니다.',
  'verdict.methodLlm':
    '모든 수치는 기기 내 분석 엔진에서 계산됩니다. AI 모델이 표현만 다듬었으며 모든 문장은 엔진 사실을 인용합니다.',

  // Stats
  'stats.edgeShare': '외곽 {rings}개 링 불량 비중',
  'stats.scratchShare': '스크래치 경로 불량 비중',
  'stats.siteRate': '사이트 {site} 불량률, 타 사이트 {other}',
  'stats.finalYield': '최종 수율, 초도 {firstPass}',
  'stats.failingDies': '불량 다이 (측정 {tested}개)',
  'stats.inSelection': '선택 영역 내 {caption}',

  // Findings
  'findings.heading': '주요 분석 결과',
  'findings.dieCount.one': '{count}개 다이',
  'findings.dieCount.other': '{count}개 다이',
  'findings.inSelection': '선택 영역 내 {count} / {total}',
  'findings.clear': '해제',
  'findings.possibleCauses': '추정 원인',
  'findings.checkNext': '다음 확인 사항: {step}',
  'findings.edgeBand.headline': '전체 불량의 {share}가 에지 밴드에 집중',
  'findings.edgeBand.sub':
    '에지 불량률 {edgeRate} vs 내부 {interiorRate} ({total}장 중 {wafers}장)',
  'findings.scratch.headline': '{wafers}장의 웨이퍼를 가로지르는 스크래치',
  'findings.scratch.sub': '동일 경로의 다이 {dies}개, 전체 불량의 {share}',
  'findings.dominantBin.headline': '{bin}에서 최대 손실 발생',
  'findings.dominantBin.sub': '다이 {dies}개, 전체 불량의 {share}',
  'findings.secondaryBin.headline': '{bin}에서 전체 불량의 {share} 발생',
  'findings.secondaryBin.sub': '웨이퍼 {wafers}장에 걸쳐 다이 {dies}개',
  'findings.capability.headline': '테스트 {test}의 Cpk는 {cpk}',
  'findings.capability.sub': '평균 {mean}, 규격 한계 {lo} ~ {hi}',
  'findings.site.headline': '사이트 {site} 불량률이 {ratio}배 높음',
  'findings.site.sub':
    '사이트 {site} 불량률 {rate} vs 타 사이트 {other}, 재측정 {retests}건',
  'findings.excursion.headline': '웨이퍼 {wafer} 수율이 {yield}로 급락',
  'findings.excursion.sub': '로트 중앙값 대비 {delta} 낮음',
  'findings.lotYield.headline': '최종 수율 {yield}',
  'findings.lotYield.sub': '초도 수율 {firstPass}, 재측정 다이 {retests}개',
  'hypothesis.etchUniformity': '증착 또는 식각 균일도 편차',
  'hypothesis.etchUniformity.check':
    '에지 구역 챔버 로그를 비교하고 포커스 링 사용 시간을 점검하세요.',
  'hypothesis.mechanical': '기계적 반송 손상',
  'hypothesis.mechanical.check':
    '해당 슬롯의 이송 블레이드 정렬 상태를 점검하세요.',
  'hypothesis.probeCard': '공정이 아닌 프로브 카드 또는 테스터 사이트 문제',
  'hypothesis.probeCard.check':
    '사이트 {site} 프로브 침을 세정하거나 교체한 뒤 샘플을 재측정하세요.',
  'hypothesis.random': '무작위 파티클 결함',
  'hypothesis.random.check':
    '해당 로트의 파티클 수와 결함 검사 기록을 검토하세요.',

  // Wafer stage
  'stage.aria': '웨이퍼 {wafer}, 다이 {dies}개, 불량 {fails}개',
  'stage.roleDescription': '웨이퍼 맵',
  'stage.mode.hbin': 'HBIN',
  'stage.mode.sbin': 'SBIN',
  'stage.legend.toggleAria': '{bin} 표시 전환',
  'mode.passFail': '양품/불량',
  'mode.hardBins': '하드 빈',
  'mode.softBins': '소프트 빈',
  'legend.failed': '불량',
  'legend.passed': '양품',
  'legend.good': '정상',
  'legend.more': '+{count}개 더보기',
  'stage.title': '웨이퍼 {wafer}',
  'stage.caption': '다이 {total}개 중 {failed}개 불량',
  'stage.reading': '읽는 중…',
  'stage.selected.one': '{count}개 다이 선택됨',
  'stage.selected.other': '{count}개 다이 선택됨',
  'stage.selectArea': '영역 선택',
  'stage.selectAreaHint': '영역 선택 (S 또는 Shift 드래그)',
  'stage.resetView': '보기 초기화',
  // Bin Pareto
  'pareto.heading': '빈별 수율 손실',
  'pareto.modeAria': '빈 종류',
  'pareto.empty': '이 선택 영역에는 불량 다이가 없습니다.',
  'pareto.rowDetail': '테스트 대비 {share}, 누적 {cumulative}',
  'pareto.rowAria': '{bin}(으)로 필터, {dies}, 테스트 대비 {share}',
  'pareto.showAll': '빈 {count}개 모두 보기',
  'pareto.showFewer': '간단히 보기',
  // Yield summary
  'yield.heading': '수율',
  'yield.col.firstPass': '초도',
  'yield.col.final': '최종',
  'yield.col.retests': '재테스트',
  'yield.sites': '테스트 사이트',
  'yield.wafers': '웨이퍼',
  'yield.wafersLowest': '수율이 낮은 웨이퍼',
  'yield.siteLabel': '사이트 {site}',
  'yield.siteLow': '다른 사이트보다 낮음',
  'yield.siteRowAria': '사이트 {site}(으)로 범위 지정, 최종 수율 {final}, 초도 {firstPass}',
  'yield.waferRowAria': '웨이퍼 {wafer}(으)로 범위 지정, 최종 수율 {final}, 초도 {firstPass}',
  'yield.showAllWafers': '웨이퍼 {count}장 모두 보기',
  'yield.showFewer': '간단히 보기',
  'stage.evidenceCaption': '웨이퍼 {wafers}장 중 {dies}개 다이, 현재 웨이퍼 {here}개',

  // Magnifier
  'magnifier.coords': 'X, Y',
  'magnifier.site': '사이트',
  'magnifier.bin': '빈',
  'magnifier.hbin': 'HBIN',
  'magnifier.outOfLimits': '규격 이탈',
  'magnifier.retested': '재측정',
  'magnifier.retestedValue': '예, {count}회 측정',
  'magnifier.notch': '노치',
  'magnifier.notchValue': '{clock}시 방향',

  // Selection popover
  'selection.dies.one': '{count}개 다이',
  'selection.dies.other': '{count}개 다이',
  'selection.failing': '불량',
  'selection.yield': '수율',
  'selection.topBin': '최다 빈',
  'selection.none': '없음',
  'selection.clear': '해제',
  'selection.zoom': '선택 영역으로 확대',

  // Strip
  'strip.aria': '로트 {lotId}의 웨이퍼 목록',
  'strip.itemAria': '웨이퍼 {wafer}, 수율 {yield}',
  'strip.earlier': '이전 웨이퍼',
  'strip.later': '다음 웨이퍼',

  // Errors
  'error.notStdf.title': '이 파일은 STDF 로그가 아닙니다.',
  'error.notStdf.body':
    '첫 번째 레코드는 반드시 FAR (0, 10)이어야 합니다. 이 파일의 시작 바이트는 {hex}입니다.',
  'error.version.title': '지원하지 않는 STDF 버전입니다.',
  'error.version.body':
    'FAR에 기록된 STDF_VER는 {version}입니다. Chip Autopsy Lab은 STDF V4만 읽습니다.',
  'error.vax.title': 'DEC VAX 바이트 순서는 지원하지 않습니다.',
  'error.vax.body':
    'FAR.CPU_TYPE이 0입니다. CPU_TYPE 1 또는 2로 로그를 다시 내보내세요.',
  'error.truncated.title': '레코드 중간에서 파일이 끝났습니다.',
  'error.truncated.body':
    '바이트 {offset}의 레코드 {recType}에는 {need}바이트가 필요하지만 {have}바이트만 남아 있습니다. 이전 웨이퍼는 정상적으로 읽었습니다.',
  'error.gzip.title': 'gzip 스트림의 압축을 풀 수 없습니다.',
  'error.gzip.body':
    '파일이 gzip 바이트 1F 8B로 시작하지만 바이트 {offset}에서 스트림이 손상되었습니다.',
  'error.empty.title': '파일이 비어 있습니다.',
  'error.empty.body': 'STDF 레코드가 포함된 파일을 선택하세요.',
  'error.noParts.title': '측정된 다이를 찾을 수 없습니다.',
  'error.noParts.body': '로그에 PRR 레코드가 없어 맵을 표시할 수 없습니다.',
  'error.openAnother': '다른 파일 열기',
  'error.loadDemo': '데모 로트 불러오기',
  'error.showDetails': '세부 정보 보기',
  'error.detailsTitle': '세부 정보',

  // Bins-only
  'binsOnly.sheetTitle': '이 파일의 크기는 {size}입니다.',
  'binsOnly.sheetBody':
    '모든 파라메트릭 측정값을 파싱하는 데 약 {seconds} 걸릴 수 있습니다. 빈 전용 모드는 파라메트릭 결과를 건너뛰고 웨이퍼 맵, 빈, 수율만 유지합니다.',
  'binsOnly.useBinsOnly': '빈 전용 모드 사용',
  'binsOnly.parseAll': '모두 파싱',
  'binsOnly.notice': '빈 전용 모드입니다. 파라메트릭 분석 결과는 숨겨집니다.',

  // Toasts
  'toast.loaded': '{duration} 만에 웨이퍼 {wafers}장을 불러왔습니다.',
  'toast.skippedRecords': '인식할 수 없는 레코드 {count}개를 건너뛰었습니다.',
  'toast.downloaded': '{fileName} 파일을 다운로드했습니다.',
  'toast.binsOnly': '빈 전용 모드가 켜져 있습니다.',
  'toast.dismiss': '닫기',

  // Language
  'language.changed': '언어가 {language}(으)로 변경되었습니다.',
  'language.menuTitle': '언어',

  // Shortcuts / a11y
  'shortcut.open': '파일 열기',
  'a11y.skipToVerdict': '판정으로 건너뛰기',
  'a11y.failingDiesTable': '웨이퍼 {wafer}의 불량 다이 목록',
} as const satisfies Dictionary;
