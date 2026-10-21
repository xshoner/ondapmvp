'use server';

// 고객 포장 디자인 저장 → 디자인 코드 발급 (A안: 고객이 카페24 주문서 추가항목에 코드를 적는다)
// 로그인 없이 누구나 부르므로 상품명·스타일 이름 같은 값은 클라이언트를 믿지 않고 저장소에서 다시 읽는다.

import { getCatalog } from '@/data/repository.ts';
import { createDesign, getPackagingAssets } from '@/data/packaging-repository.ts';
import type { EventType } from '@/engine/types.ts';
import { MAX_PRINT_BYTES, generateDesignCode, pngSize, printPixels, sanitizeDraft, sanitizeSticker } from '@/packaging/rules.ts';

export type SaveDesignResult = { ok: true; code: string } | { ok: false; message: string };

export async function saveDesignAction(form: FormData): Promise<SaveDesignResult> {
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
