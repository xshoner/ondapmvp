'use server';

// 고객 포장 디자인 저장 → 디자인 코드 발급 (A안: 고객이 카페24 주문서 추가항목에 코드를 적는다)
// 로그인 없이 누구나 부르므로 상품명·스타일 이름 같은 값은 클라이언트를 믿지 않고 저장소에서 다시 읽는다.

import { headers } from 'next/headers';
import { getCatalog } from '@/data/repository.ts';
import { createDesign, getPackagingAssets, lookupDesign } from '@/data/packaging-repository.ts';
import type { EventType } from '@/engine/types.ts';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { MAX_PRINT_BYTES, generateDesignCode, normalizeDesignCode, pngSize, printPixels, sanitizeDraft, sanitizeSticker } from '@/packaging/rules.ts';

// 같은 접속 주소에서 10분에 20번까지 (보통 고객은 한두 번 저장한다)
const allowSave = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

// 코드 조회는 추측 시도를 막으려고 접속 주소당 10분에 30번까지
const allowLookup = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

export type LookupResult =
  | { ok: true; design: { code: string; createdAt: string; productName: string; productUrl: string | null; quantity: number; styleName: string; sticker: string; status: string } }
  | { ok: false; message: string };

const STATUS_TEXT: Record<string, string> = { received: '접수됨', order_confirmed: '주문 확인됨', printed: '인쇄 완료' };

export async function lookupDesignAction(raw: string): Promise<LookupResult> {
  if (!allowLookup(clientIp(await headers()))) return { ok: false, message: '조회를 너무 자주 했어요. 잠시 후 다시 시도해 주세요.' };
  const code = normalizeDesignCode(String(raw ?? ''));
  if (!code) return { ok: false, message: '코드 형식이 맞지 않아요. 예: OD-7QDF-3P6M' };
  try {
    const d = await lookupDesign(code);
    if (!d) return { ok: false, message: '해당 코드의 디자인을 찾지 못했어요. 코드를 다시 확인해 주세요.' };
    const product = (await getCatalog()).products.find((p) => p.productNo === d.productNo);
    return {
      ok: true,
      design: {
        code: d.code,
        createdAt: d.createdAt,
        productName: d.productName,
        productUrl: product?.url ?? null,
        quantity: d.quantity,
        styleName: d.styleName,
        sticker: d.sticker ? `${d.sticker.shape === 'circle' ? '원형' : '사각'} ${d.sticker.sizeCm}cm 스티커` : '인쇄물 없음',
        status: STATUS_TEXT[d.status] ?? d.status,
      },
    };
  } catch (e) {
    console.error('[포장 디자인] 조회 실패:', e instanceof Error ? e.message : e);
    return { ok: false, message: '지금은 조회할 수 없어요. 잠시 후 다시 시도해 주세요.' };
  }
}

export type SaveDesignResult = { ok: true; code: string } | { ok: false; message: string };

export async function saveDesignAction(form: FormData): Promise<SaveDesignResult> {
  if (!allowSave(clientIp(await headers()))) {
    return { ok: false, message: '저장을 너무 자주 했어요. 잠시 후 다시 시도해 주세요.' };
  }
  try {
    const metaText = String(form.get('meta') ?? '');
    if (metaText.length > 100_000) return { ok: false, message: '디자인 정보가 너무 큽니다.' };
    const meta = JSON.parse(metaText) as Record<string, unknown>;

    const catalog = await getCatalog();
    const product = catalog.products.find((p) => p.productNo === Number(meta.productNo));
    if (!product) return { ok: false, message: '상품을 찾을 수 없습니다.' };
    const quantity = Math.min(100000, Math.max(1, Math.round(Number(meta.quantity) || 1)));
    const event = catalog.config.events[String(meta.event) as EventType] ? (String(meta.event) as EventType) : null;

    const { styles } = await getPackagingAssets();
    const style = styles.find((s) => s.id === String(meta.styleId));
    if (!style) return { ok: false, message: '포장 스타일을 다시 골라 주세요.' };

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
      if ((await createDesign({ ...base, code }, print)) === 'ok') return { ok: true, code };
    }
    return { ok: false, message: '코드를 만들지 못했습니다. 다시 시도해 주세요.' };
  } catch (e) {
    console.error('[포장 디자인] 저장 실패:', e instanceof Error ? e.message : e);
    return { ok: false, message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}
