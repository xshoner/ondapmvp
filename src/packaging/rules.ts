// 포장 디자인 규칙: 인쇄 크기, 디자인 코드, 자리표시자, 입력 검사.
// 고객 화면(브라우저)과 서버 액션이 함께 쓰므로 Node 전용 모듈을 쓰지 않는다.

import type { DesignCategory, DesignDraft, Layer, StickerShape, StickerSizeCm, StickerSpec } from './types.ts';

export const MAX_ACTIVE = 10; // 스타일, 분류별 추천 이미지·문구 각각 '사용' 최대 개수
export const DPI = 300;
export const BLEED_CM = 0.2; // 재단 여백(사방 2mm). 인쇄 파일은 이만큼 크게 만든다
export const CANVAS_UNITS = 1000; // 편집기 좌표계: 재단 여백 포함 전체 = 1000
export const MAX_LAYERS = 12;
export const MAX_PRINT_BYTES = 3 * 1024 * 1024;
export const MIN_PRINT_DPI = 150; // 이보다 낮으면 고객에게 흐릿할 수 있다고 알린다

export const STICKER_SIZES: StickerSizeCm[] = [4, 6];

export const FONTS = [
  { id: 'sans', label: '고딕' },
  { id: 'serif', label: '명조' },
  { id: 'batang', label: '바탕' },
  { id: 'pen', label: '손글씨' },
] as const;
export type FontId = (typeof FONTS)[number]['id'];

export const CATEGORY_ORDER: DesignCategory[] = [
  'funeral', 'wedding', 'longevity', 'birth', 'promotion', 'opening', 'thanks', 'birthday', 'common',
];

export function categoryName(category: DesignCategory, eventNames: Record<string, string>): string {
  return category === 'common' ? '공통' : (eventNames[category] ?? category);
}

export function isCategory(value: string): value is DesignCategory {
  return (CATEGORY_ORDER as string[]).includes(value);
}

// ---------- 크기 ----------

export function totalCm(sizeCm: number): number {
  return sizeCm + BLEED_CM * 2;
}

// 인쇄 파일 한 변의 픽셀 수 (재단 여백 포함, 300dpi). 4cm → 520, 6cm → 756
export function printPixels(sizeCm: number): number {
  return Math.round((totalCm(sizeCm) / 2.54) * DPI);
}

// 재단 여백 두께를 편집기 좌표로
export function bleedUnits(sizeCm: number): number {
  return (BLEED_CM / totalCm(sizeCm)) * CANVAS_UNITS;
}

// 사진이 스티커 위에서 차지하는 폭 기준 실제 인쇄 해상도
export function effectiveDpi(naturalWidth: number, widthUnits: number, sizeCm: number): number {
  const inches = ((widthUnits / CANVAS_UNITS) * totalCm(sizeCm)) / 2.54;
  return inches > 0 ? naturalWidth / inches : Infinity;
}

// ---------- 안전선 (자르는 선에서 재단 여백만큼 더 안쪽) ----------

export interface Box { x: number; y: number; width: number; height: number } // 편집기 좌표

// 상자를 가운데 기준으로 몇 배로 바꾸면 안전선에 꼭 맞는지. 1 이상이면 지금 그대로 안전하다
export function fitScale(shape: StickerShape, sizeCm: number, box: Box): number {
  const c = CANVAS_UNITS / 2;
  const safe = c - 2 * bleedUnits(sizeCm); // 원은 반지름, 사각은 가운데에서 변까지
  const hw = box.width / 2;
  const hh = box.height / 2;
  if (hw <= 0 || hh <= 0) return Infinity;
  const dx = Math.abs(box.x + hw - c);
  const dy = Math.abs(box.y + hh - c);
  if (shape === 'square') return Math.max(0, Math.min((safe - dx) / hw, (safe - dy) / hh));
  // 원: 가장 먼 모서리 (dx + s·hw, dy + s·hh)가 반지름 안에 드는 가장 큰 s
  const a = hw * hw + hh * hh;
  const b = 2 * (dx * hw + dy * hh);
  const k = dx * dx + dy * dy - safe * safe;
  return k >= 0 ? 0 : (-b + Math.sqrt(b * b - 4 * a * k)) / (2 * a);
}

// ---------- 행사와 어긋난 말 (막지 않고 알려만 준다) ----------

const CALM_WORDS = ['축하', '경축', '기쁨', '기쁜', '행복', '경사', '축복']; // 장례에 어울리지 않는 말
const MOURN_WORDS = ['위로', '조의', '애도', '명복', '부고', '조문']; // 장례가 아닌 자리에 어울리지 않는 말

export function cautionWords(event: DesignCategory | null, text: string): string[] {
  if (!event || event === 'common') return [];
  return (event === 'funeral' ? CALM_WORDS : MOURN_WORDS).filter((w) => text.includes(w));
}

// ---------- 디자인 코드 (카페24 주문서 추가항목에 고객이 붙여넣는 값) ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0·O·1·I 제외, 32자라 치우침 없음
const CODE_PATTERN = /^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function generateDesignCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const chars = Array.from(random(8), (b) => CODE_ALPHABET[b % 32]);
  return `OD-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

// 고객이 소문자·공백을 섞어 적어도 찾을 수 있게 정리한다
export function normalizeDesignCode(value: string): string | null {
  const v = value.trim().toUpperCase().replace(/\s+/g, '');
  return CODE_PATTERN.test(v) ? v : null;
}

// ---------- 자리표시자 ----------

export const PLACEHOLDER_BLANK = '○○○';

export function fillPlaceholders(template: string, fields: DesignDraft['fields']): string {
  const pick = (v: string) => v.trim() || PLACEHOLDER_BLANK;
  return template
    .replaceAll('{받는분}', pick(fields.recipient))
    .replaceAll('{보내는분}', pick(fields.sender))
    .replaceAll('{날짜}', pick(fields.date));
}

// ---------- 인쇄 파일 검사 ----------

// PNG 머리(IHDR)에서 가로·세로를 읽는다. PNG가 아니면 null
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// ---------- 고객 입력 정리 (서버에서 다시 검사) ----------

const HEX = /^#[0-9a-f]{6}$/i;
const FONT_IDS = FONTS.map((f) => f.id) as string[];

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function str(v: unknown, max: number): string {
  return String(v ?? '').slice(0, max);
}

function cleanSrc(v: unknown): string | null {
  const s = str(v, 500);
  if (s === 'upload' || s.startsWith('/packaging/') || /^https:\/\/[^\s"'<>]+$/.test(s)) return s;
  return null;
}

export function sanitizeSticker(v: unknown): StickerSpec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const shape = o.shape === 'circle' || o.shape === 'square' ? o.shape : null;
  const sizeCm = STICKER_SIZES.find((s) => s === Number(o.sizeCm));
  return shape && sizeCm ? { shape, sizeCm } : null;
}

export function sanitizeDraft(v: unknown): DesignDraft {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const f = (o.fields && typeof o.fields === 'object' ? o.fields : {}) as Record<string, unknown>;
  const layers: Layer[] = [];
  for (const raw of Array.isArray(o.layers) ? o.layers.slice(0, MAX_LAYERS) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const l = raw as Record<string, unknown>;
    const base = {
      id: str(l.id, 40) || `l${layers.length}`,
      x: num(l.x, -2000, 3000, 500),
      y: num(l.y, -2000, 3000, 500),
      rotation: num(l.rotation, -360, 360, 0),
      scaleX: num(l.scaleX, 0.05, 20, 1),
      scaleY: num(l.scaleY, 0.05, 20, 1),
    };
    if (l.type === 'image') {
      const src = cleanSrc(l.src);
      if (!src) continue;
      layers.push({ ...base, type: 'image', src, width: num(l.width, 1, 5000, 1000), height: num(l.height, 1, 5000, 1000) });
    } else if (l.type === 'text') {
      layers.push({
        ...base,
        type: 'text',
        text: str(l.text, 200),
        font: FONT_IDS.includes(String(l.font)) ? String(l.font) : 'sans',
        fontSize: num(l.fontSize, 10, 400, 60),
        color: HEX.test(String(l.color)) ? String(l.color) : '#1f2a26',
        stroke: HEX.test(String(l.stroke)) ? String(l.stroke) : null,
        shadow: l.shadow === true,
      });
    }
  }
  return {
    background: HEX.test(String(o.background)) ? String(o.background) : '#ffffff',
    layers,
    fields: { recipient: str(f.recipient, 30), sender: str(f.sender, 30), date: str(f.date, 30) },
  };
}

// '사용' 켜기 전에 같은 묶음 안의 사용 개수를 확인한다
export function canActivate(items: { id: string; active: boolean }[], id: string): boolean {
  return items.filter((x) => x.active && x.id !== id).length < MAX_ACTIVE;
}
