// 관리자 디자인 접수 목록의 거르기 조건 (화면과 CSV 내려받기가 같이 쓴다)
import { normalizeDesignCode } from './rules.ts';
import type { Design, DesignStatus } from './types.ts';

export const STATUS_LABEL: Record<DesignStatus, string> = {
  received: '접수',
  order_confirmed: '주문 확인',
  printed: '인쇄 완료',
  canceled: '취소',
};

export interface DesignFilter {
  code: string | null;
  status: DesignStatus | null;
  from: string | null; // YYYY-MM-DD (한국 날짜)
  to: string | null;
  late?: boolean; // 늦어지는 건만 (오늘 할 일에서 들어올 때)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDesignFilter(sp: Record<string, string | string[] | undefined>): DesignFilter & { codeInvalid: boolean; rawCode: string } {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const rawCode = one('code');
  const code = rawCode ? normalizeDesignCode(rawCode) : null;
  const status = one('status');
  return {
    rawCode,
    code,
    codeInvalid: Boolean(rawCode && !code),
    status: status in STATUS_LABEL ? (status as DesignStatus) : null,
    from: DATE.test(one('from')) ? one('from') : null,
    to: DATE.test(one('to')) ? one('to') : null,
    late: one('late') === '1',
  };
}

// 한국 날짜 범위를 UTC 시각으로: from 00:00 이상, to 다음 날 00:00 미만
export function kstRange(f: Pick<DesignFilter, 'from' | 'to'>): { gte: string | null; lt: string | null } {
  const toUtc = (d: string, addDays = 0) => new Date(Date.parse(`${d}T00:00:00+09:00`) + addDays * 86400000).toISOString();
  return { gte: f.from ? toUtc(f.from) : null, lt: f.to ? toUtc(f.to, 1) : null };
}

export function filterQuery(f: DesignFilter): string {
  const q = new URLSearchParams();
  if (f.code) q.set('code', f.code);
  if (f.status) q.set('status', f.status);
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.late) q.set('late', '1');
  return q.toString();
}

// 엑셀에서 한글이 깨지지 않게 BOM, 수식으로 읽히는 값(= + - @ 시작)은 앞에 '를 붙인다 (상품 지표 CSV도 쓴다)
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function designsCsv(designs: Design[], eventNames: Record<string, string>, kst: (iso: string) => string): string {
  const head = ['접수일시', '디자인 코드', '상태', '카페24 주문번호', '상품번호', '상품명', '수량', '행사', '포장지', '스티커', '인쇄 파일', '메모'];
  const rows = designs.map((d) => [
    kst(d.createdAt), d.code, STATUS_LABEL[d.status], d.orderNo ?? '', d.productNo, d.productName, d.quantity,
    d.event ? (eventNames[d.event] ?? d.event) : '', d.styleName,
    d.sticker ? `${d.sticker.shape === 'circle' ? '원형' : '사각'} ${d.sticker.sizeCm}cm` : '없음',
    d.hasPrintFile ? '있음' : '없음', d.memo,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// 늦어지는 건: 접수 후 3일 넘게 주문 확인이 안 됐거나, 주문 확인 후 2일 넘게 인쇄가 안 된 건 (관리자 목록 빨간 표시·오늘 할 일)
// ponytail: 주말·공휴일은 세지 않는다. 영업일 기준이 필요해지면 여기서 날짜 계산만 바꾼다
export const LATE_DAYS = { received: 3, order_confirmed: 2 } as const;

export function lateSince(now: number): { received: string; confirmed: string } {
  const before = (days: number) => new Date(now - days * 86400000).toISOString();
  return { received: before(LATE_DAYS.received), confirmed: before(LATE_DAYS.order_confirmed) };
}

export function isLate(d: Pick<Design, 'status' | 'createdAt' | 'statusChangedAt'>, now: number): boolean {
  const since = lateSince(now);
  if (d.status === 'received') return d.createdAt < since.received;
  if (d.status === 'order_confirmed') return d.statusChangedAt < since.confirmed;
  return false;
}
