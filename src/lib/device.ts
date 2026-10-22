// 이 기기에만 남기는 값(localStorage). 사생활 보호 모드처럼 저장이 막힌 브라우저에서도
// 화면이 깨지지 않게 모든 접근을 감싸고, 읽은 값은 모양을 다시 확인한다.

import { MAX_QTY, parseBudget, type ResultQuery } from './result-query.ts';

export function readJson(key: string): unknown {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 공간이 꽉 찼거나 막힌 브라우저: 기억하지 않고 넘어간다
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 무시
  }
}

const DAY = 24 * 3600 * 1000;
export const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// 키보드 단축키: 입력칸에서 글자를 칠 때는 가로채지 않는다
export const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// 만든 파일을 내려받게 한다 (CSV·인쇄 묶음·스티커 그림)
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 휴대폰·태블릿 브라우저 (모바일 쇼핑몰 주소, 공유 창, QR, 화면 배율에 쓴다)
export const isMobileUA = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// ---------- 지난 조건 (CR-01) ----------

const LAST_QUERY_KEY = 'ondap_last_query';
const LAST_QUERY_DAYS = 30;

export type LastQuery = Omit<ResultQuery, 'exclude'>;

export function rememberQuery(q: ResultQuery): void {
  writeJson(LAST_QUERY_KEY, { event: q.event, relation: q.relation, budget: q.budget, qty: q.qty, at: Date.now() });
}

export function loadLastQuery(now = Date.now()): LastQuery | null {
  const v = readJson(LAST_QUERY_KEY);
  if (!isObj(v) || typeof v.event !== 'string' || typeof v.relation !== 'string') return null;
  if (typeof v.at !== 'number' || now - v.at > LAST_QUERY_DAYS * DAY) return null;
  const qty = Number(v.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;
  return { event: v.event, relation: v.relation, budget: parseBudget(v.budget), qty };
}

export function forgetLastQuery(): void {
  removeKey(LAST_QUERY_KEY);
}

// ---------- 찜한 답례 (CR-12) ----------

const PICKS_KEY = 'ondap_saved_picks';
export const MAX_PICKS = 30;

export interface SavedPick {
  productNo: number;
  name: string;
  price: number;
  image: string | null;
  url: string;
  savedAt: number;
}

export function loadPicks(): SavedPick[] {
  const v = readJson(PICKS_KEY);
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is SavedPick =>
    isObj(p) && Number.isInteger(p.productNo) && typeof p.name === 'string' && typeof p.url === 'string' && /^https?:\/\//.test(p.url)
    && typeof p.price === 'number' && (p.image === null || typeof p.image === 'string') && typeof p.savedAt === 'number');
}

export function isPicked(productNo: number): boolean {
  return loadPicks().some((p) => p.productNo === productNo);
}

// 찜을 켜거나 끈다. 켜졌으면 true
export function togglePick(pick: Omit<SavedPick, 'savedAt'>): boolean {
  const all = loadPicks();
  if (all.some((p) => p.productNo === pick.productNo)) {
    writeJson(PICKS_KEY, all.filter((p) => p.productNo !== pick.productNo));
    return false;
  }
  writeJson(PICKS_KEY, [{ ...pick, savedAt: Date.now() }, ...all].slice(0, MAX_PICKS));
  return true;
}

export function removePick(productNo: number): void {
  writeJson(PICKS_KEY, loadPicks().filter((p) => p.productNo !== productNo));
}
