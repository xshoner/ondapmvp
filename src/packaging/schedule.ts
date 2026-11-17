// 답례큐 일정 관리 및 우선순위 계산 모듈
// 한국 표준시(KST: UTC+9) 기준으로 행사일·희망 수령일을 비교하여 관리자의 작업 우선순위를 산출한다.
// 주의: 도착 보장, 출고 확정일 등 약속형 표현을 절대 사용하지 않고 사실 기반(희망 수령일, 행사일, 확인 필요)으로만 표시한다.

import type { Design } from './types.ts';

export type UrgencyLevel = 'emergency' | 'imminent' | 'normal' | 'none';

export interface ScheduleInfo {
  // 기준일 (희망 수령일 우선, 없으면 행사일, 없으면 null)
  targetDate: string | null;
  targetType: 'desired' | 'event' | 'none';

  // D-day 숫자: 오늘 = 0, 내일 = 1, 모레 = 2, 어제 = -1 (targetDate - today)
  dDay: number | null;

  // 디자인 생성일 기준 경과일수 (today - createdAt)
  elapsedDays: number;

  // 긴급도 레벨 (적색: emergency, 주황: imminent, 회색: normal/none)
  urgency: UrgencyLevel;

  // 배지 텍스트 및 시각 톤
  badgeText: string;
  badgeTone: 'red' | 'amber' | 'gray' | 'green';

  // 날짜 역전·오류 입력 여부 (희망수령일 > 행사일 또는 희망수령일 < 디자인 생성일)
  hasConflict: boolean;
  conflictMessage?: string;

  // 화면 표시용 일자 요약 문자열 (예: '희망 수령 11/21 (행사 11/23)')
  displayDateText: string;

  // 정렬용 우선순위 가중치 (작을수록 상단에 노출)
  sortScore: number;
}

// UTC 시각 -> KST YYYY-MM-DD
export function toKstDateString(isoOrTimestamp: string | number): string {
  const ts = typeof isoOrTimestamp === 'number' ? isoOrTimestamp : Date.parse(isoOrTimestamp);
  return new Date(ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// YYYY-MM-DD -> MM/DD 포맷
export function formatMmDd(dateStr: string | null | undefined): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 두 YYYY-MM-DD 날짜 간의 일수 차이 (dateA - dateB)
export function diffDays(dateA: string, dateB: string): number {
  const tA = Date.parse(`${dateA}T00:00:00+09:00`);
  const tB = Date.parse(`${dateB}T00:00:00+09:00`);
  return Math.round((tA - tB) / 86400000);
}

export function calculateScheduleStatus(
  d: Pick<Design, 'createdAt' | 'status' | 'eventDate' | 'desiredDeliveryDate'>,
  now: number = Date.now(),
): ScheduleInfo {
  const todayKst = toKstDateString(now);
  const designDateKst = toKstDateString(d.createdAt);
  const elapsedDays = Math.max(0, diffDays(todayKst, designDateKst));

  const desired = d.desiredDeliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(d.desiredDeliveryDate) ? d.desiredDeliveryDate : null;
  const event = d.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(d.eventDate) ? d.eventDate : null;

  // 1. 날짜 역전·오류 검증
  let hasConflict = false;
  let conflictMessage: string | undefined;

  if (desired && event && desired > event) {
    hasConflict = true;
    conflictMessage = '희망 수령일이 행사일보다 늦습니다.';
  } else if (desired && desired < designDateKst) {
    hasConflict = true;
    conflictMessage = '희망 수령일이 디자인 생성일보다 과거입니다.';
  }

  // 2. 기준일 표시 우선순위 결정: 희망 수령일 우선, 없으면 행사일
  let targetDate: string | null = null;
  let targetType: 'desired' | 'event' | 'none' = 'none';

  if (desired) {
    targetDate = desired;
    targetType = 'desired';
  } else if (event) {
    targetDate = event;
    targetType = 'event';
  }

  // 화면 표시용 날짜 텍스트
  let displayDateText = '일정 미입력';
  if (desired && event) {
    displayDateText = `희망 수령 ${formatMmDd(desired)} (행사 ${formatMmDd(event)})`;
  } else if (desired) {
    displayDateText = `희망 수령 ${formatMmDd(desired)}`;
  } else if (event) {
    displayDateText = `행사일 ${formatMmDd(event)}`;
  }

  const isDone = d.status === 'completed' || d.status === 'no_packaging';
  const isCanceled = d.status === 'canceled';

  // 완료 및 취소 건 처리
  if (isDone) {
    return {
      targetDate,
      targetType,
      dDay: targetDate ? diffDays(targetDate, todayKst) : null,
      elapsedDays,
      urgency: 'none',
      badgeText: d.status === 'no_packaging' ? '포장 없음' : '포장 완료',
      badgeTone: 'green',
      hasConflict,
      conflictMessage,
      displayDateText,
      sortScore: 100000,
    };
  }

  if (isCanceled) {
    return {
      targetDate,
      targetType,
      dDay: targetDate ? diffDays(targetDate, todayKst) : null,
      elapsedDays,
      urgency: 'none',
      badgeText: '취소됨',
      badgeTone: 'gray',
      hasConflict: false,
      displayDateText,
      sortScore: 200000,
    };
  }

  // 미완료 주문의 일정 계산
  if (!targetDate) {
    return {
      targetDate: null,
      targetType: 'none',
      dDay: null,
      elapsedDays,
      urgency: 'none',
      badgeText: `일정 미입력 (+${elapsedDays}일)`,
      badgeTone: 'gray',
      hasConflict: false,
      displayDateText,
      sortScore: 50000 + elapsedDays, // 미입력 건은 오래된 순
    };
  }

  const dDay = diffDays(targetDate, todayKst);

  // 날짜 오류인 경우 오류 배지 우선 노출
  if (hasConflict) {
    return {
      targetDate,
      targetType,
      dDay,
      elapsedDays,
      urgency: 'emergency',
      badgeText: '일정 확인 필요',
      badgeTone: 'red',
      hasConflict: true,
      conflictMessage,
      displayDateText,
      sortScore: -5000, // 오류 건 최우선 점검
    };
  }

  // 기준일이 이미 지난 경우
  if (dDay < 0) {
    const overdue = Math.abs(dDay);
    return {
      targetDate,
      targetType,
      dDay,
      elapsedDays,
      urgency: 'emergency',
      badgeText: `기준일 경과 (+${overdue}일)`,
      badgeTone: 'red',
      hasConflict: false,
      displayDateText,
      sortScore: -2000 - overdue, // 지난 일수가 클수록 최상단
    };
  }

  // 오늘 또는 내일 (D-0, D-1) -> 적색 긴급
  if (dDay === 0 || dDay === 1) {
    return {
      targetDate,
      targetType,
      dDay,
      elapsedDays,
      urgency: 'emergency',
      badgeText: dDay === 0 ? 'D-Day (오늘)' : 'D-1 (내일)',
      badgeTone: 'red',
      hasConflict: false,
      displayDateText,
      sortScore: dDay,
    };
  }

  // 2~3일 남음 (D-2, D-3) -> 주황 임박
  if (dDay <= 3) {
    return {
      targetDate,
      targetType,
      dDay,
      elapsedDays,
      urgency: 'imminent',
      badgeText: `D-${dDay}`,
      badgeTone: 'amber',
      hasConflict: false,
      displayDateText,
      sortScore: dDay,
    };
  }

  // 4일 이상 남음 -> 일반 회색
  return {
    targetDate,
    targetType,
    dDay,
    elapsedDays,
    urgency: 'normal',
    badgeText: `D-${dDay}`,
    badgeTone: 'gray',
    hasConflict: false,
    displayDateText,
    sortScore: dDay,
  };
}
