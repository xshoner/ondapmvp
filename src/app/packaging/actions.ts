'use server';

// 고객 포장 디자인 저장 → 디자인 코드 발급 (A안: 고객이 카페24 주문서 추가항목에 코드를 적는다)
// 로그인 없이 누구나 부르므로 상품명·스타일 이름 같은 값은 클라이언트를 믿지 않고 저장소에서 다시 읽는다.

import { headers } from 'next/headers';
import { getCatalog } from '@/data/repository.ts';
import { createDesign, getPackagingAssets, lookupDesign, reorderDesign, type DesignSummary } from '@/data/packaging-repository.ts';
import { isEvent } from '@/engine/labels.ts';
import type { Cafe24Product } from '@/engine/types.ts';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { clampQty } from '@/lib/result-query.ts';
import { cleanTargeting } from '@/packaging/presets.ts';
import { recordOperation } from '@/data/operations-repository.ts';
import { MAX_PRINT_BYTES, generateDesignCode, normalizeDesignCode, pngSize, printPixels, sanitizeDraft, sanitizeSticker } from '@/packaging/rules.ts';

// 같은 접속 주소에서 10분에 20번까지 (보통 고객은 한두 번 저장한다)
const allowSave = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

// 코드 조회는 추측 시도를 막으려고 접속 주소당 10분에 30번까지
const allowLookup = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });
// '이 기기에서 저장한 디자인'(최대 10개)의 진행 상황은 화면을 열 때마다 한꺼번에 보므로 따로, 코드 한 개를 한 번으로 센다
const allowListLookup = createRateLimiter({ limit: 100, windowMs: 10 * 60 * 1000 });

export interface CustomerDesign {
  code: string;
  createdAt: string;
  productNo: number;
  productName: string;
  productUrl: string | null;
  canOrder: boolean; // 지금 쇼핑몰에서 살 수 있는 상품인지 (품절·판매중지·사라짐이면 false)
  quantity: number;
  styleName: string;
  sticker: string;
  status: DesignSummary['status'];
  statusChangedAt: string;
}

export type LookupResult = { ok: true; design: CustomerDesign } | { ok: false; message: string };

// 상품 주소·판매 여부는 쇼핑몰 상품 목록에서 (여러 건이면 목록을 한 번만 읽어 넘긴다)
async function toCustomer(d: DesignSummary, products?: Cafe24Product[]): Promise<CustomerDesign> {
  const product = (products ?? (await getCatalog()).products).find((p) => p.productNo === d.productNo);
  return {
    code: d.code,
    createdAt: d.createdAt,
    productNo: d.productNo,
    productName: d.productName,
    productUrl: product?.url ?? null,
    canOrder: Boolean(product && product.display && product.selling && !product.soldOut),
    quantity: d.quantity,
    styleName: d.styleName,
    sticker: d.sticker ? `${d.sticker.shape === 'circle' ? '원형' : '사각'} ${d.sticker.sizeCm}cm 스티커` : '인쇄물 없음',
    status: d.status,
    statusChangedAt: d.statusChangedAt,
  };
}

export async function lookupDesignAction(raw: string): Promise<LookupResult> {
  const startedAt = Date.now();
  if (!allowLookup(clientIp(await headers()))) return { ok: false, message: '조회를 너무 자주 했어요. 잠시 후 다시 시도해 주세요.' };
  const code = normalizeDesignCode(String(raw ?? ''));
  if (!code) return { ok: false, message: '코드 형식이 맞지 않아요. 예: OD-7QDF-3P6M' };
  try {
    const d = await lookupDesign(code);
    if (!d) return { ok: false, message: '해당 코드의 디자인을 찾지 못했어요. 코드를 다시 확인해 주세요.' };
    return { ok: true, design: await toCustomer(d) };
  } catch (e) {
    await recordOperation('design_lookup', 'error', startedAt, 'db_read');
    return { ok: false, message: '지금은 조회할 수 없어요. 잠시 후 다시 시도해 주세요.' };
  }
}

// 이 기기에 저장한 디자인들의 진행 상황 (최대 10개). 못 찾거나 막히면 그 코드는 빠진다
export async function lookupDesignsAction(raw: string[]): Promise<Record<string, CustomerDesign>> {
  const ip = clientIp(await headers());
  const codes = [...new Set((Array.isArray(raw) ? raw : []).slice(0, 10).map((c) => normalizeDesignCode(String(c))).filter((c): c is string => Boolean(c)))];
  const out: Record<string, CustomerDesign> = {};
  if (codes.length === 0) return out;
  const { products } = await getCatalog();
  for (const code of codes) {
    if (!allowListLookup(ip)) break;
    try {
      const d = await lookupDesign(code);
      if (d) out[code] = await toCustomer(d, products);
    } catch (e) {
      console.error('[포장 디자인] 목록 조회 실패:', e instanceof Error ? e.message : e);
      break;
    }
  }
  return out;
}

// 같은 디자인으로 다시 주문: 수량만 정해 새 코드를 받는다 (인쇄·주문 단위가 섞이지 않게 새 접수로)
export async function reorderDesignAction(raw: string, rawQuantity: unknown): Promise<{ ok: true; code: string; design: CustomerDesign } | { ok: false; message: string }> {
  if (!allowSave(clientIp(await headers()))) return { ok: false, message: '너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.' };
  const code = normalizeDesignCode(String(raw ?? ''));
  if (!code) return { ok: false, message: '코드 형식이 맞지 않아요.' };
  const quantity = clampQty(rawQuantity);
  try {
    const src = await lookupDesign(code);
    if (!src || src.status === 'canceled') return { ok: false, message: '취소됐거나 없는 디자인이라 다시 주문할 수 없어요.' };
    const current = await toCustomer(src);
    if (!current.canOrder) return { ok: false, message: '이 상품은 지금 쇼핑몰에서 주문할 수 없어요(품절·판매중지).' };
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = generateDesignCode();
      const r = await reorderDesign(code, next, quantity);
      if (r === 'not_found') return { ok: false, message: '디자인을 찾지 못했어요.' };
      if (r === 'ok') {
        const d = await lookupDesign(next);
        return d ? { ok: true, code: next, design: await toCustomer(d) } : { ok: false, message: '새 코드를 확인하지 못했어요. 내 디자인에서 다시 찾아 주세요.' };
      }
    }
    return { ok: false, message: '코드를 만들지 못했어요. 다시 시도해 주세요.' };
  } catch (e) {
    console.error('[포장 디자인] 다시 주문 실패:', e instanceof Error ? e.message : e);
    return { ok: false, message: '지금은 다시 주문할 수 없어요. 잠시 후 다시 시도해 주세요.' };
  }
}

export type SaveDesignResult = { ok: true; code: string } | { ok: false; message: string };

export async function saveDesignAction(form: FormData): Promise<SaveDesignResult> {
  const startedAt = Date.now();
  if (!allowSave(clientIp(await headers()))) {
    return { ok: false, message: '저장을 너무 자주 했어요. 잠시 후 다시 시도해 주세요.' };
  }
  try {
    const metaText = String(form.get('meta') ?? '');
    if (metaText.length > 100_000) return { ok: false, message: '디자인 정보가 너무 큽니다.' };
    const meta = JSON.parse(metaText) as Record<string, unknown>;

    const catalog = await getCatalog();
    const product = catalog.products.find((p) => p.productNo === Number(meta.productNo));
    if (!product || !product.display || !product.selling || product.soldOut) return { ok: false, message: '지금 주문할 수 없는 상품입니다. 상품을 다시 골라 주세요.' };
    const quantity = clampQty(meta.quantity);
    const event = isEvent(catalog.config, meta.event) ? meta.event : null;

    const { styles } = await getPackagingAssets();
    const style = styles.find((s) => s.id === String(meta.styleId));
    if (!style) return { ok: false, message: '포장 스타일을 다시 골라 주세요.' };
    const targets = cleanTargeting(style.targeting).productNos;
    if (targets.length && !targets.includes(product.productNo)) return { ok: false, message: '이 상품에 적용할 수 없는 포장입니다. 포장지를 다시 골라 주세요.' };

    const sticker = sanitizeSticker(meta.sticker);
    let print: Uint8Array | null = null;
    if (sticker) {
      const file = form.get('print');
      if (!(file instanceof Blob)) return { ok: false, message: '스티커 이미지가 없습니다.' };
      if (file.size > MAX_PRINT_BYTES) return { ok: false, message: '스티커 이미지가 너무 큽니다.' };
      print = new Uint8Array(await file.arrayBuffer());
      const size = pngSize(print);
      const want = printPixels(sticker.sizeCm);
      if (!size || Math.abs(size.width - want) > 2 || Math.abs(size.height - want) > 2) {
        return { ok: false, message: '스티커 이미지 크기가 맞지 않습니다. 새로고침 후 다시 저장해 주세요.' };
      }
    }

    const base = {
      productNo: product.productNo,
      productName: product.name,
      quantity,
      event,
      styleId: style.id,
      styleName: style.name,
      sticker,
      draft: sticker ? sanitizeDraft(meta.draft) : null,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateDesignCode();
      if ((await createDesign({ ...base, code }, print)) === 'ok') {
        await recordOperation('design_save', 'ok', startedAt);
        return { ok: true, code };
      }
    }
    return { ok: false, message: '코드를 만들지 못했습니다. 다시 시도해 주세요.' };
  } catch (e) {
    await recordOperation('design_save', 'error', startedAt, 'storage_or_db');
    return { ok: false, message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}
