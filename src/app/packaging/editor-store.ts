// 포장 편집기가 이 기기에만 남기는 값: 꾸미던 디자인 자동 보관, 올린 사진 원본(IndexedDB),
// 자주 쓰는 이름, 실제 크기 보기 화면 배율. 저장이 막힌 브라우저에서도 편집은 그대로 되도록 실패는 조용히 넘긴다.

import { clampQty } from '@/lib/result-query.ts';
import { isMobileUA, isObj, readJson, removeKey, writeJson } from '@/lib/device.ts';
import { loadSavedDesigns } from '@/packaging/client.ts';
import { sanitizeDraft, sanitizeSticker } from '@/packaging/rules.ts';
import type { DesignDraft } from '@/packaging/types.ts';
import type { EditorLayer, EditorSnapshot } from './editor-types.ts';

// ---------- 올린 사진 원본 (IndexedDB: localStorage에는 사진이 들어가지 않는다) ----------

function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ondap', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => {
      const tx = req.result.transaction('photos', mode);
      tx.oncomplete = tx.onabort = () => req.result.close();
      resolve(tx.objectStore('photos'));
    };
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return store(mode)
    .then((s) => new Promise<T>((resolve, reject) => {
      const req = fn(s);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }))
    .catch(() => undefined);
}

export const putPhoto = (id: string, blob: Blob) => run('readwrite', (s) => s.put(blob, id));
const getPhoto = (id: string) => run<Blob>('readonly', (s) => s.get(id));

// 저장한 디자인·자동 보관 어디에도 없는 사진은 지운다 (편집기를 열 때 한 번).
// ponytail: 같은 기기에서 편집기 창 두 개를 동시에 쓰면 다른 창이 막 올린 사진이 지워질 수 있다. 그 창의 화면·저장에는 영향 없고 다시 꾸미기 때만 사진이 빠진다
export async function prunePhotos(): Promise<void> {
  const keep = new Set([...loadSavedDesigns().map((d) => d.snapshot), readAutosave()?.snap].flatMap(photoIds));
  const s = await store('readwrite').catch(() => null);
  if (!s) return;
  const req = s.getAllKeys();
  req.onsuccess = () => { for (const k of req.result) if (!keep.has(String(k))) s.delete(k); };
}

function photoIds(snap: unknown): string[] {
  const layers = isObj(snap) && Array.isArray(snap.layers) ? snap.layers : [];
  return layers.flatMap((l) => (isObj(l) && typeof l.photoId === 'string' ? [l.photoId] : []));
}

// ---------- 편집 상태 ↔ 저장 모양 ----------

// blob 주소는 창을 닫으면 사라지므로 올린 사진은 'upload' + photoId로 남긴다
export function toStored(s: EditorSnapshot): unknown {
  return {
    ...s,
    layers: s.layers.map((l) => (l.type === 'image' && l.uploaded ? { ...l, src: 'upload', uploaded: undefined } : l)),
  };
}

// 저장 모양을 다시 편집 상태로. 값은 서버 검사(sanitizeDraft)와 같은 규칙으로 정리하고, 사진은 이 기기에서 다시 꺼낸다
export async function fromStored(
  v: unknown,
  ctx: { styleIds: string[]; events: string[] },
): Promise<{ snap: EditorSnapshot; missingPhotos: number } | null> {
  if (!isObj(v) || !Array.isArray(v.layers)) return null;
  const draft = sanitizeDraft(v);
  const raw = new Map(v.layers.filter(isObj).map((l) => [String(l.id), l]));
  const layers: EditorLayer[] = [];
  let missingPhotos = 0;
  for (const l of draft.layers) {
    if (l.type !== 'image' || l.src !== 'upload') {
      layers.push(l);
      continue;
    }
    const meta = raw.get(l.id);
    const photoId = typeof meta?.photoId === 'string' ? meta.photoId : null;
    const blob = photoId ? await getPhoto(photoId) : undefined;
    if (!photoId || !blob) {
      missingPhotos++;
      continue;
    }
    const naturalWidth = Number(meta?.naturalWidth);
    layers.push({ ...l, src: URL.createObjectURL(blob), uploaded: true, photoId, naturalWidth: naturalWidth > 0 ? naturalWidth : undefined });
  }
  const sticker = sanitizeSticker(v) ?? { shape: 'circle', sizeCm: 6 };
  return {
    snap: {
      styleId: ctx.styleIds.includes(String(v.styleId)) ? String(v.styleId) : (ctx.styleIds[0] ?? ''),
      withSticker: v.withSticker !== false,
      shape: sticker.shape,
      sizeCm: sticker.sizeCm,
      background: draft.background,
      layers,
      fields: draft.fields,
      event: ctx.events.includes(String(v.event)) ? (String(v.event) as EditorSnapshot['event']) : null,
      quantity: clampQty(v.quantity),
    },
    missingPhotos,
  };
}

// ---------- 꾸미던 디자인 자동 보관 (상품 하나, 7일) ----------

const AUTOSAVE_KEY = 'ondap_editor_autosave';
const AUTOSAVE_DAYS = 7;

function readAutosave(): { productNo: number; at: number; snap: unknown } | null {
  const v = readJson(AUTOSAVE_KEY);
  return isObj(v) && typeof v.productNo === 'number' && typeof v.at === 'number' ? { productNo: v.productNo, at: v.at, snap: v.snap } : null;
}

export function autosave(productNo: number, snap: EditorSnapshot): void {
  writeJson(AUTOSAVE_KEY, { productNo, at: Date.now(), snap: toStored(snap) });
}

export function loadAutosave(productNo: number, now = Date.now()): unknown | null {
  const v = readAutosave();
  return v && v.productNo === productNo && now - v.at < AUTOSAVE_DAYS * 24 * 3600 * 1000 ? v.snap : null;
}

export function clearAutosave(): void {
  removeKey(AUTOSAVE_KEY);
}

// ---------- 자주 쓰는 이름 (날짜는 행사마다 달라 기억하지 않는다) ----------

const FIELDS_KEY = 'ondap_fields';

export function rememberFields(f: DesignDraft['fields']): void {
  const v = { recipient: f.recipient.trim(), sender: f.sender.trim() };
  if (v.recipient || v.sender) writeJson(FIELDS_KEY, v);
}

export function loadFields(): Pick<DesignDraft['fields'], 'recipient' | 'sender'> | null {
  const v = readJson(FIELDS_KEY);
  if (!isObj(v)) return null;
  const pick = (x: unknown) => (typeof x === 'string' ? x.slice(0, 30) : '');
  const out = { recipient: pick(v.recipient), sender: pick(v.sender) };
  return out.recipient || out.sender ? out : null;
}

export function forgetFields(): void {
  removeKey(FIELDS_KEY);
}

export function todayLabel(d = new Date()): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ---------- 실제 크기 보기: 화면 1mm가 몇 CSS 픽셀인지 ----------
// 브라우저는 실제 화면 크기를 알려 주지 않는다. 휴대폰은 대개 6px 안팎, PC는 96dpi 기준 3.78px.
// 고객이 신용카드 짧은 변(53.98mm)에 맞춰 고치면 그 값을 기억한다

const PX_KEY = 'ondap_px_per_mm';
export const PX_PER_MM_RANGE = [2.5, 8] as const;
export const CARD_SHORT_MM = 53.98;

export function loadPxPerMm(): number {
  const v = Number(readJson(PX_KEY));
  if (v >= PX_PER_MM_RANGE[0] && v <= PX_PER_MM_RANGE[1]) return v;
  return isMobileUA() ? 6 : 96 / 25.4;
}

export function savePxPerMm(v: number): void {
  writeJson(PX_KEY, v);
}
