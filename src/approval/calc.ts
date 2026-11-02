import { MAX_QTY, shippingFee, won } from '../lib/result-query.ts';
import type { ApprovalCandidate, ApprovalDocumentModel, ApprovalDraft, CandidateCalculatedRow } from './types.ts';

// 안전한 한국 날짜 포맷 (YYYY. MM. DD 또는 YYYY-MM-DD)
export function formatKSTDate(dateInput: Date | string | number): string {
  const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return '';
  // 한국 시간대로 날짜 포맷
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}.${m}.${day}`;
}

// YYYY-MM-DD 한국 날짜로부터 N일 전 계산
export function getDaysBeforeKST(dateString: string, days: number): { date: string; isPast: boolean; isImminent: boolean } {
  // YYYY-MM-DD 파싱
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString.trim());
  if (!m) return { date: '', isPast: false, isImminent: false };

  const targetYear = parseInt(m[1], 10);
  const targetMonth = parseInt(m[2], 10) - 1;
  const targetDay = parseInt(m[3], 10);

  // KST 정오 기준으로 Date 생성
  const targetDate = new Date(Date.UTC(targetYear, targetMonth, targetDay, 3, 0, 0)); // UTC 03:00 = KST 12:00
  const recommendedDate = new Date(targetDate.getTime() - days * 24 * 60 * 60 * 1000);

  // 오늘 날짜 (KST 기준)
  const now = new Date();
  const kstNowParts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const curY = parseInt(kstNowParts.find((p) => p.type === 'year')?.value ?? '0', 10);
  const curM = parseInt(kstNowParts.find((p) => p.type === 'month')?.value ?? '0', 10) - 1;
  const curD = parseInt(kstNowParts.find((p) => p.type === 'day')?.value ?? '0', 10);
  const curKSTMidday = new Date(Date.UTC(curY, curM, curD, 3, 0, 0));

  const diffDays = Math.round((targetDate.getTime() - curKSTMidday.getTime()) / (24 * 60 * 60 * 1000));
  const isPast = diffDays < 0;
  const isImminent = diffDays >= 0 && diffDays <= days;

  const recY = recommendedDate.getUTCFullYear();
  const recM = String(recommendedDate.getUTCMonth() + 1).padStart(2, '0');
  const recD = String(recommendedDate.getUTCDate()).padStart(2, '0');

  return {
    date: `${recY}.${recM}.${recD}`,
    isPast,
    isImminent,
  };
}

// 행사·관계 라벨 매핑 (엔진 설정이 없을 때 안전 폴백)
const EVENT_NAMES: Record<string, string> = {
  funeral: '장례(조문)',
  wedding: '결혼식',
  longevity: '회갑/칠순',
  birth: '돌/출산',
  promotion: '승진/이직',
  opening: '개업/신축',
  thanks: '감사선물',
  birthday: '생일',
};

const RELATION_NAMES: Record<string, string> = {
  senior: '상급자/어르신',
  business: '거래처/공식',
  peer: '동료/친구',
  family: '가족/친밀',
};

export function getEventName(id: string): string {
  return EVENT_NAMES[id] ?? id;
}

export function getRelationName(id: string): string {
  return RELATION_NAMES[id] ?? id;
}

// 기본 목적 문구 생성 (행사별 맞춤형 감사/기념 문장)
export function defaultPurposeText(event: string, relation: string): string {
  const eName = getEventName(event);
  const rName = getRelationName(relation);

  if (event === 'funeral') {
    return `장례에 조문과 따뜻한 위로를 보내주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`;
  }
  if (event === 'wedding') {
    return `${eName}에 참석 및 축하해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`;
  }
  if (event === 'longevity' || event === 'birth' || event === 'birthday') {
    return `${eName}을 축하하고 성원해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`;
  }
  if (event === 'promotion' || event === 'opening') {
    return `${eName}에 축하와 격려를 보내주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`;
  }
  if (event === 'thanks') {
    return `평소 온정과 성원을 베풀어 주신 ${rName}께 전할 정중하고 격식 있는 감사 답례품 선정 및 예산 집행 검토.`;
  }
  return `${eName}에 축하와 성원을 보내주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`;
}

// 해당 초안의 행사(event)와 대상(relation)에 대해 과거 시스템이 실제 생성했던 기본 문장 목록
export function getLegacyDefaultSentences(event: string, relation: string): string[] {
  const eName = getEventName(event);
  const rName = getRelationName(relation);
  const list = new Set<string>();

  // 1. 과거 시스템의 정규 기본 문장:
  list.add(`${eName}에 참석 및 축하·조문해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);

  // 장례의 경우 '장례' 및 '장례(조문)' 라벨 모두 고려
  if (event === 'funeral') {
    list.add(`장례에 참석 및 축하·조문해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);
    list.add(`장례(조문)에 참석 및 축하·조문해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);
  }

  // raw id로 생성되었던 경우 고려
  list.add(`${event}에 참석 및 축하·조문해 주신 ${relation}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);

  // 2. 직전 중간 수정 시 발생했던 '참석 및' 중복 오류 문장:
  list.add(`${eName}에 참석 및 참석 및 축하해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);
  if (event === 'funeral') {
    list.add(`장례에 참석 및 참석 및 축하해 주신 ${rName}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);
  }
  list.add(`${event}에 참석 및 참석 및 축하해 주신 ${relation}께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.`);

  return Array.from(list);
}

// 과거 시스템 기본값 여부 판별 (해당 초안의 행사·관계 기본 문장과 일치할 때만 true)
// 사용자가 행사명, 대상, 문장 일부를 수정한 경우에는 일절 매칭되지 않도록 엄격히 일치 검사
export function isLegacyDefaultPurpose(purpose: string, event: string, relation: string): boolean {
  const trimmed = purpose.trim();
  const legacyList = getLegacyDefaultSentences(event, relation);
  return legacyList.includes(trimmed);
}

// 기존 초안의 레거시 문구 자동 정제
// 사용자가 직접 작성한 문구는 일절 변경하지 않고, 이전 버전의 기본값과 정확히 일치하는 경우에만 신규 기본 문구로 교체
export function sanitizePurposeText(purpose: string | null | undefined, event: string, relation: string): string {
  if (!purpose || !purpose.trim()) {
    return defaultPurposeText(event, relation);
  }
  const trimmed = purpose.trim();
  if (isLegacyDefaultPurpose(trimmed, event, relation)) {
    return defaultPurposeText(event, relation);
  }
  return trimmed;
}

export type BudgetKind = 'total' | 'per_item' | 'none';

export interface SelectedReasonContext {
  budgetKind?: BudgetKind;
  isBudgetOver?: boolean;
  budgetOverAmount?: number;
}

// 자동 작성 선정 사유 (규칙 기반 문구 1~2문장)
export function buildSelectedReason(
  candidate: ApprovalCandidate,
  event: string,
  relation: string,
  context?: SelectedReasonContext,
): string {
  const eName = getEventName(event);
  const rName = getRelationName(relation);
  const scoreText = Math.round(candidate.matchScore);
  const rawReason = (candidate.reason || '자리에 알맞은 격식과 실용성을 갖춘 상품입니다').trim();
  const cleanReason = rawReason.endsWith('.') ? rawReason : `${rawReason}.`;

  const rankText = candidate.rank === 1 ? '1순위 안' : `${candidate.rank}안`;

  // 확인되지 않은 판단(상징성, 무조건적 예산 적합 등)은 배제하고, 실제 예산 데이터가 있을 때만 분기
  let conclusion: string;
  const budgetKind = context?.budgetKind ?? 'none';
  const isBudgetOver = Boolean(context?.isBudgetOver);

  if (budgetKind === 'total') {
    if (isBudgetOver) {
      conclusion = `전체 예산 초과(상품비 기준)에 대한 검토가 필요하나, 위 추천 사유를 종합하여 ${rankText}으로 선정합니다.`;
    } else {
      conclusion = `위 추천 사유 및 상품비 기준 예산 검토를 거쳐 ${rankText}으로 선정합니다.`;
    }
  } else if (budgetKind === 'per_item') {
    if (isBudgetOver) {
      conclusion = `1개당 예산 상한 초과에 대한 검토가 필요하나, 위 추천 사유를 종합하여 ${rankText}으로 선정합니다.`;
    } else {
      conclusion = `위 추천 사유 및 상품비 기준 예산 검토를 거쳐 ${rankText}으로 선정합니다.`;
    }
  } else {
    // 예산 미설정: 확인되지 않은 예산 적합성을 주장하지 않고 추천 사유로만 종결
    conclusion = `위와 같은 추천 사유를 종합적으로 검토하여 ${rankText}으로 선정합니다.`;
  }

  if (candidate.model === 'core-contract-v1') {
    const sScore = Math.round(candidate.recommendationScore ?? candidate.matchScore);
    const rScore = Math.round(candidate.rarityValue ?? 0);
    const scoreLabel = `추천점수(S) ${sScore}점 · 희소값(R) ${rScore}점`;
    const tierPart = candidate.tier ? `(${candidate.tier})` : '';
    return `${eName}(${rName}) 자리에 맞춘 ${scoreLabel}${tierPart ? ` ${tierPart}` : ''}의 추천 상품입니다. ${cleanReason} ${conclusion}`;
  }

  return `${eName}(${rName}) 자리에 맞춘 ${candidate.model === 'v2' ? '상품 희소값' : '격식지수'} ${scoreText}점(${candidate.tier})의 추천 상품입니다. ${cleanReason} ${conclusion}`;
}

// 안전한 수량 검증
export function validateQuantity(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) {
    throw new Error(`수량은 1 이상 ${MAX_QTY} 이하의 정수여야 합니다.`);
  }
  return n;
}

// 초안 데이터를 기반으로 완전한 계산 뷰 모델 생성
export function buildDocumentModel(draft: ApprovalDraft): ApprovalDocumentModel {
  const { source, editable } = draft;
  const quantity = editable.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    throw new Error(`수량이 올바르지 않습니다: ${quantity}`);
  }

  const candidates = source.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('문서에 추천 상품 후보가 없습니다.');
  }

  // 선택된 상품 찾기 (없으면 1순위 안)
  let selectedCandidate = candidates.find((c) => c.productNo === editable.selectedProductNo);
  if (!selectedCandidate) {
    selectedCandidate = candidates[0];
  }

  const selectedRank = selectedCandidate.rank;
  const selectedPlanLabel = selectedRank === 1 ? '1안(추천)' : `${selectedRank}안`;

  // 단가 및 합계 계산 (대안별 독립 계산)
  const unitPrice = selectedCandidate.price;
  const itemTotal = unitPrice * quantity;
  const shipFee = shippingFee(itemTotal);
  const shippingNote = `한 곳 배송 기준 예상 배송비 (${shipFee === 0 ? '무료' : won(shipFee)}, 추가 배송비 및 포장비 미확정)`;
  const extraCostNote = '배송·추가 비용 및 부가세 포함 여부 별도 확인';
  const vatStatus = '부가세 포함 여부 확인 필요 (상품 판매가 기준, 추가비 미확정)';

  // 예산 상태 판정
  let budgetStatus = '';
  let budgetCheckText = '';
  let budgetOverAmount: number | undefined;
  let isBudgetOver = false;

  const originalTotalBudget = source.originalTotalBudget ?? source.query.totalBudget ?? null;
  const budgetMode = source.budgetMode ?? source.query.budgetMode;
  const queryBudget = source.query.budget; // 1개당 예산 상한 (원)

  let budgetKind: BudgetKind = 'none';

  if (budgetMode === 'total' && originalTotalBudget != null && originalTotalBudget > 0) {
    budgetKind = 'total';
    const diff = originalTotalBudget - itemTotal;
    if (diff >= 0) {
      budgetStatus = `전체 예산 ${won(originalTotalBudget)} 대비 상품비 ${won(itemTotal)} (잔여 ${won(diff)}, 배송·추가비 확인 필요)`;
      budgetCheckText = `원래 입력한 전체 예산(${won(originalTotalBudget)}) 기준 상품비 잔여 ${won(diff)}. 확정 전 배송비 및 포장비 추가 검토 필요.`;
    } else {
      isBudgetOver = true;
      budgetOverAmount = Math.abs(diff);
      budgetStatus = `전체 예산 ${won(originalTotalBudget)} 대비 상품비 ${won(itemTotal)} (상품비만 ${won(budgetOverAmount)} 초과)`;
      budgetCheckText = `원래 입력한 전체 예산(${won(originalTotalBudget)}) 대비 상품비만 ${won(budgetOverAmount)} 초과. 예산 증액 또는 수량 검토 필요.`;
    }
  } else if (queryBudget != null && queryBudget > 0) {
    budgetKind = 'per_item';
    const perItemLimit = queryBudget;
    const refLimit = perItemLimit * quantity;
    const diff = refLimit - itemTotal;

    if (unitPrice > perItemLimit) {
      isBudgetOver = true;
      const unitOver = unitPrice - perItemLimit;
      const totalOver = unitOver * quantity;
      budgetOverAmount = totalOver;
      budgetStatus = `1개당 상한 ${won(perItemLimit)} 대비 단가 ${won(unitPrice)} (개당 ${won(unitOver)} 초과, 참고 한도 ${won(totalOver)} 초과)`;
      budgetCheckText = `1개당 상한(${won(perItemLimit)}) 기준 단가 초과 상품입니다(추천 시 예산 완화 적용). 참고 한도(${won(refLimit)}) 대비 상품비만 ${won(totalOver)} 초과.`;
    } else {
      budgetStatus = `1개당 상한 ${won(perItemLimit)} × ${quantity.toLocaleString('ko-KR')}개 = 참고 한도 ${won(refLimit)} (상품비 이내, 배송·추가비 확인 필요)`;
      budgetCheckText = `1개당 상한(${won(perItemLimit)}) 기준 참고 한도 ${won(refLimit)} 이내입니다(상품비 기준). 전체 예산형 입력이 아니므로 총예산 적합이 아닌 참고치입니다.`;
    }
  } else {
    budgetStatus = '예산 미설정 (상품비 기준 검토)';
    budgetCheckText = '사전 설정된 예산 한도가 없습니다. 상품 단가 및 총 소요 비용을 기준으로 내부 승인이 필요합니다.';
  }

  // 내부 1인당 가액 기준 비교 (입력된 경우에만 산술 비교 문구 생성)
  let perPersonLimitCheckText = '';
  const hasInternalLimit = Boolean(editable.internalPerPersonLimit != null && editable.internalPerPersonLimit > 0);
  if (hasInternalLimit && editable.internalPerPersonLimit != null) {
    const limit = editable.internalPerPersonLimit;
    const ruleMemo = editable.internalRuleMemo.trim() ? ` [메모: ${editable.internalRuleMemo.trim()}]` : '';
    if (unitPrice <= limit) {
      perPersonLimitCheckText = `입력 기준(${won(limit)}) 대비: 단가 ${won(unitPrice)} (1인당 1개 기준 산술 비교)${ruleMemo}`;
    } else {
      const over = unitPrice - limit;
      perPersonLimitCheckText = `입력 기준(${won(limit)}) 대비: 단가 ${won(unitPrice)}로 ${won(over)} 초과 (1인당 1개 기준 산술 비교)${ruleMemo}`;
    }
  }

  // 행사일 및 추진 일정 (사용자가 행사일을 입력한 경우에만 안전한 안내 문구 생성)
  let deliveryScheduleText = '';
  let eventDateText = '미입력';
  if (editable.eventDate) {
    eventDateText = formatKSTDate(editable.eventDate);
    deliveryScheduleText = `행사일정: 행사일(${eventDateText}) 기준 사전 출고 및 배송 일정 확인 필요 (제작·배송 기간 및 휴일 일정 별도 확인)`;
  }

  const hasScheduleOrNote = Boolean(editable.eventDate || (editable.additionalNote && editable.additionalNote.trim()));

  // 기안자 텍스트 (입력되지 않은 항목은 미입력)
  const authorParts = [editable.organization, editable.department, editable.author].filter((s) => Boolean(s && s.trim()));
  const authorText = authorParts.length > 0 ? authorParts.join(' / ') : '미입력';

  // 후보 비교표 행들 생성
  const candidateRows: CandidateCalculatedRow[] = candidates.map((c) => {
    const isSelected = c.productNo === selectedCandidate.productNo;
    const planLabel = c.rank === 1 ? (isSelected ? '1안(추천·선택)' : '1안(추천)') : isSelected ? `${c.rank}안(선택)` : `${c.rank}안`;
    const cItemTotal = c.price * quantity;
    const cShipFee = shippingFee(cItemTotal);

    let depopNote = '—';
    if (c.isDepopulationArea) {
      depopNote = '인구감소지역 상품 (지역 상생)';
    }

    let storyText = '상품 등록 정보 검토 필요';
    if (c.story && c.story.trim()) {
      storyText = `상품 등록 정보 기준: ${c.story.trim()}`;
    } else if (c.region && c.region !== '기타') {
      storyText = `상품 등록 정보 기준: ${c.region} 특산/연계 상품`;
    }

    return {
      candidate: c,
      isSelected,
      planLabel,
      quantity,
      unitPrice: c.price,
      itemTotal: cItemTotal,
      shippingFee: cShipFee,
      shippingNote: cShipFee === 0 ? '무료 배송' : won(cShipFee),
      tier: c.tier,
      matchScore: Math.round(c.recommendationScore ?? c.matchScore),
      recommendationScore: c.recommendationScore,
      rarityValue: c.rarityValue,
      reason: c.reason || '해당 자리 추천 상품',
      region: c.region || '기타',
      category: c.category || '일반',
      depopulationNote: depopNote,
      story: storyText,
    };
  });

  const hasShortage = candidates.length < 3;
  let shortageReason: string | undefined;
  if (hasShortage) {
    shortageReason = `추천 후보가 ${candidates.length}개로 한정되었습니다. (설정된 행사·관계·예산 조건에 부합하는 카탈로그 내 유효 상품 기준)`;
  }

  // 지역 의미 문구
  const regionMeaningText = `상품 등록 정보 기준: ${selectedCandidate.region || '기타'} ${selectedCandidate.story || ''}`.trim();
  const producerSettlementText = '정산 자료 미등록 (생산자 직접 정산액·마진율 데이터 미보유)';

  // 법규 및 검수 안내
  const complianceNotes = {
    antiGraftText: '확인 필요 (청탁금지법상 원활한 직무수행·사교·의례 목적 가액 범위 해당 여부 내부 확인 필요)',
    electionLawText: '확인 필요 (공직선거법 등 관련 법령상 기부행위 제한 대상 여부 내부 확인 필요)',
    contractText: '확인 필요 (기관 계약 규정 및 수의계약 한도·지출 증빙 요건 확인 필요)',
    foodInspectionText: '확인 필요 (식품 위생·원산지 표기 및 유통기한·보관 상태 출고 전 확인 필요)',
  };

  const selectedReason = buildSelectedReason(
    selectedCandidate,
    source.query.event,
    source.query.relation,
    {
      budgetKind,
      isBudgetOver,
      budgetOverAmount,
    },
  );

  const eventName = editable.eventName ? editable.eventName.trim() : '미입력';

  // 클립보드 복사용 요약문 (불필요한 법규·검수 자동 문구 제외, 핵심 품의 요약만 전달)
  const clipboardLines = [
    `[답례품 선정 품의 요약]`,
    `- 문서명: 답례품 선정 검토서 (${eventName !== '미입력' ? eventName : '답례품 선정'})`,
    `- 행사: ${getEventName(source.query.event)} / 대상: ${getRelationName(source.query.relation)} / 행사일: ${eventDateText}`,
    `- 선정안: ${selectedPlanLabel} (${selectedCandidate.productName})`,
    `- 소요예산: ${won(unitPrice)} × ${quantity.toLocaleString('ko-KR')}개 = 상품 합계 ${won(itemTotal)} (${extraCostNote})`,
    `- 예산상태: ${budgetStatus}`,
    `- 선정사유: ${selectedReason}`,
    perPersonLimitCheckText ? `- 내부가액: ${perPersonLimitCheckText}` : null,
    deliveryScheduleText ? `- 일정: ${deliveryScheduleText}` : null,
    editable.additionalNote && editable.additionalNote.trim() ? `- 비고: ${editable.additionalNote.trim()}` : null,
  ].filter(Boolean);
  const summaryClipboardText = clipboardLines.join('\n');

  return {
    draft,
    eventName,
    eventDateText,
    authorText,
    eventCategoryName: getEventName(source.query.event),
    relationCategoryName: getRelationName(source.query.relation),
    purposeText: sanitizePurposeText(editable.purpose, source.query.event, source.query.relation),

    selectedCandidate,
    selectedPlanLabel,
    quantity,
    unitPrice,
    itemTotal,
    shippingFee: shipFee,
    shippingNote,
    vatStatus,
    extraCostNote,
    budgetStatus,
    budgetOverAmount,
    isBudgetOver,
    selectedReason,
    additionalNote: editable.additionalNote,
    hasInternalLimit,
    hasScheduleOrNote,

    approverTitles: Array.isArray(editable.approverTitles) ? editable.approverTitles : ['담당', '팀장', '과장'],

    candidateRows,
    hasShortage,
    shortageReason,

    budgetCheckText,
    perPersonLimitCheckText,
    complianceNotes,
    regionMeaningText,
    producerSettlementText,
    deliveryScheduleText,

    createdDateText: formatKSTDate(draft.createdAt),
    catalogDateText: formatKSTDate(source.catalogSyncedAt || draft.createdAt),
    documentId: draft.id,
    revision: draft.revision,
    draftNotice: '본 문서는 시스템 추천 결과를 바탕으로 작성된 검토용 초안입니다. 실제 주문 및 결재 승인 효력을 갖지 않으며 판매가 기준 예상 금액입니다.',

    summaryClipboardText,
  };
}
