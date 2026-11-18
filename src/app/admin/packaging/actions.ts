'use server';

async function safeRevalidatePath(path: string, type?: 'layout' | 'page') {
  try {
    const { revalidatePath } = await import('next/cache');
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  } catch {
    // 테스트 환경 등 Next.js 컨텍스트 외부에서는 안전하게 패스
  }
}
import {
  deleteAsset, getDesign, getDesignsByCodes, getDesignsByOrderNo, getPackagingAssets, listDesigns, saveAsset, updateDesign, updateDesignsStatus, uploadAssetFile, type AssetKind,
} from '../../../data/packaging-repository.ts';
import { MAX_ACTIVE, canActivate, isCategory, normalizeDesignCode, sanitizeIsoDate } from '../../../packaging/rules.ts';
import type { DesignImage, DesignStatus, DesignText, PackagingStyle } from '../../../packaging/types.ts';
import { requireAdmin } from '../../../lib/admin-guard.ts';
import { cleanTargeting } from '../../../packaging/presets.ts';

// 모든 액션은 첫 줄에서 관리자인지 확인한다. Supabase 모드에서는 RLS가 한 번 더 막는다.
// 권한 오류는 던지지 않고 {ok:false}로 돌려준다: 세션이 만료돼도 화면 전체가 오류 화면으로 바뀌지 않게

type Result = { ok: true } | { ok: false; message: string };
const KINDS: AssetKind[] = ['styles', 'images', 'texts'];
const STATUSES: DesignStatus[] = ['received', 'order_confirmed', 'printed', 'completed', 'no_packaging', 'canceled'];
const MAX_ASSET_BYTES = 2 * 1024 * 1024; // 브라우저에서 줄여서 올리므로 넉넉하다

async function denied(): Promise<{ ok: false; message: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    return { ok: false, message: `${e instanceof Error ? e.message : String(e)} 다시 로그인해 주세요.` };
  }
}

// 고객 화면(next/image·캔버스)이 불러올 수 있는 주소만: 앱 안 예시 이미지 또는 우리 Supabase 공개 저장소
function isAllowedImageUrl(url: string): boolean {
  const storage = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/packaging-assets/`;
  return url.startsWith('/packaging/') || (storage.startsWith('https://') && url.startsWith(storage));
}

async function run(fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    await safeRevalidatePath('/admin/packaging');
    await safeRevalidatePath('/packaging');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function clean(kind: AssetKind, raw: Record<string, unknown>): PackagingStyle | DesignImage | DesignText {
  const base = { id: String(raw.id ?? ''), active: raw.active !== false, sort: Math.round(Number(raw.sort) || 0), targeting: cleanTargeting(raw.targeting) };
  const url = String(raw.imageUrl ?? '');
  if (kind !== 'texts' && !isAllowedImageUrl(url)) throw new Error('이미지가 없거나 허용되지 않은 주소입니다. 이 화면에서 파일을 올려 주세요.');
  if (kind === 'styles') {
    const name = String(raw.name ?? '').trim().slice(0, 40);
    if (!name) throw new Error('스타일 이름을 적어 주세요.');
    return { ...base, name, description: String(raw.description ?? '').trim().slice(0, 200), imageUrl: url };
  }
  const category = String(raw.category ?? '');
  if (!isCategory(category)) throw new Error('분류를 골라 주세요.');
  if (kind === 'images') return { ...base, category, name: String(raw.name ?? '').trim().slice(0, 40), imageUrl: url };
  const text = String(raw.text ?? '').trim().slice(0, 200);
  if (!text) throw new Error('문구를 적어 주세요.');
  return { ...base, category, text };
}

// '사용' 최대 개수: 스타일은 전체에서, 추천 이미지·문구는 분류별로
async function checkActiveLimit(kind: AssetKind, item: { id: string; active: boolean; category?: string }): Promise<void> {
  if (!item.active) return;
  const assets = await getPackagingAssets({ includeInactive: true });
  const group = (assets[kind] as { id: string; active: boolean; category?: string }[])
    .filter((x) => kind === 'styles' || x.category === item.category);
  if (!canActivate(group, item.id)) throw new Error(`'사용'은 ${kind === 'styles' ? '' : '분류별로 '}최대 ${MAX_ACTIVE}개까지입니다. 다른 항목을 먼저 꺼 주세요.`);
}

export async function saveAssetAction(kind: AssetKind, raw: Record<string, unknown>): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!KINDS.includes(kind)) return { ok: false, message: '잘못된 종류입니다.' };
  return run(async () => {
    const item = clean(kind, raw);
    await checkActiveLimit(kind, item as { id: string; active: boolean; category?: string });
    await saveAsset(kind, item);
  });
}

export async function deleteAssetAction(kind: AssetKind, id: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!KINDS.includes(kind)) return { ok: false, message: '잘못된 종류입니다.' };
  return run(() => deleteAsset(kind, String(id)));
}

// 파일 형식은 확장자가 아니라 파일 머리로 확인한다
function sniff(bytes: Uint8Array): { ext: 'webp' | 'png' | 'jpg'; type: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return { ext: 'png', type: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  return null;
}

export async function uploadAssetAction(form: FormData): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const no = await denied();
  if (no) return no;
  try {
    const folder = form.get('folder') === 'styles' ? 'styles' : 'images';
    const file = form.get('file');
    if (!(file instanceof Blob)) return { ok: false, message: '파일이 없습니다.' };
    if (file.size > MAX_ASSET_BYTES) return { ok: false, message: '파일이 너무 큽니다 (2MB까지).' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) return { ok: false, message: 'PNG·JPG·WEBP 이미지만 올릴 수 있습니다.' };
    return { ok: true, url: await uploadAssetFile(folder, bytes, kind.ext, kind.type) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const ORDER_NO = /^[0-9A-Za-z-]{0,40}$/;

// 선택한 여러 건의 상태를 한 번에 (관리자 접수 목록, 스캔 되돌리기)
export async function updateDesignsStatusAction(rawCodes: string[], status: string): Promise<{ ok: true; updated: string[]; missing: string[] } | { ok: false; message: string }> {
  const no = await denied();
  if (no) return no;
  if (!STATUSES.includes(status as DesignStatus)) return { ok: false, message: '잘못된 상태입니다.' };
  const codes = [...new Set((Array.isArray(rawCodes) ? rawCodes : []).map((c) => normalizeDesignCode(String(c))).filter((c): c is string => Boolean(c)))];
  if (codes.length === 0) return { ok: false, message: '고른 접수가 없습니다.' };
  if (codes.length > 500) return { ok: false, message: '한 번에 500건까지 바꿀 수 있습니다.' };

  // 선택된 코드 전부를 빠짐없이 전수 조회하여 결제 대기(pending) 또는 취소(canceled) 여부 검증 (500개 제한 누락 방지)
  const existing = await getDesignsByCodes(codes);
  const foundCodes = new Set(existing.map((d) => d.code));
  const missingCodes = codes.filter((c) => !foundCodes.has(c));

  const pendingSet = new Set(existing.filter((d) => d.status === 'pending').map((d) => d.code));
  const canceledSet = new Set(existing.filter((d) => d.status === 'canceled' || d.cafe24Canceled).map((d) => d.code));

  if (status !== 'canceled') {
    const invalidPending = codes.filter((c) => pendingSet.has(c));
    if (invalidPending.length > 0) {
      return { ok: false, message: `결제 대기 중인 디자인(${invalidPending.slice(0, 3).join(', ')} 등 ${invalidPending.length}건)은 결제 확인 전 변경할 수 없습니다.` };
    }
  }

  if (status !== 'canceled') {
    const invalidCanceled = codes.filter((c) => canceledSet.has(c));
    if (invalidCanceled.length > 0) {
      return { ok: false, message: `취소된 디자인(${invalidCanceled.slice(0, 3).join(', ')} 등 ${invalidCanceled.length}건)은 상태를 변경할 수 없습니다.` };
    }
  }
  if (['order_confirmed', 'printed', 'completed'].includes(status) && existing.some((d) => !d.orderNo)) {
    return { ok: false, message: '주문번호가 연결되지 않은 접수가 있습니다. 주문을 확인해 주세요.' };
  }
  if (status === 'no_packaging' && existing.some((d) => d.styleId || d.sticker || d.card || d.hasPrintFile || d.hasCardPrintFile)) {
    return { ok: false, message: '포장이나 인쇄물이 포함된 접수는 포장 없음으로 변경할 수 없습니다.' };
  }

  try {
    const updated = await updateDesignsStatus(codes, status as DesignStatus);
    await safeRevalidatePath('/admin', 'layout');
    return { ok: true, updated, missing: [...new Set([...missingCodes, ...codes.filter((c) => !updated.includes(c))])] };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// 카페24 주문 상세 붙여넣기 결과로 주문번호를 잇는다. '접수' 상태였으면 '주문 확인'으로 올린다 (다른 상태는 그대로)
export async function linkOrdersAction(links: { code: string; orderNo: string }[]): Promise<{ ok: true; results: { code: string; ok: boolean; message: string }[] } | { ok: false; message: string }> {
  const no = await denied();
  if (no) return no;
  if (!Array.isArray(links) || links.length === 0 || links.length > 200) return { ok: false, message: '잇을 주문이 없거나 너무 많습니다 (200건까지).' };
  const results: { code: string; ok: boolean; message: string }[] = [];
  for (const l of links) {
    const code = normalizeDesignCode(String(l?.code ?? ''));
    const orderNo = String(l?.orderNo ?? '').trim();
    if (!code || !orderNo || !ORDER_NO.test(orderNo)) {
      results.push({ code: String(l?.code ?? ''), ok: false, message: '코드나 주문번호 형식이 맞지 않습니다.' });
      continue;
    }
    try {
      const [d] = await listDesigns({ code, limit: 1, includePending: true });
      if (!d) {
        results.push({ code, ok: false, message: '접수를 찾을 수 없습니다.' });
        continue;
      }
      if (d.status === 'pending') {
        // 결제 대기 건은 카페24 결제 확인을 먼저 거쳐야 한다
        try {
          const { processSingleOrder } = await import('../../../cafe24/intake-worker.ts');
          const decision = await processSingleOrder(orderNo);
          if (decision.status === 'confirmed' || decision.status === 'already_confirmed') {
            results.push({ code, ok: true, message: '카페24 결제 확인 완료 · 주문 확인' });
          } else {
            results.push({ code, ok: false, message: `카페24 결제 미확인: ${decision.message}` });
          }
        } catch (err) {
          results.push({ code, ok: false, message: `결제 대기 건은 카페24 결제 확인이 필요합니다: ${err instanceof Error ? err.message : String(err)}` });
        }
        continue;
      }
      const status = d.status === 'received' ? 'order_confirmed' : d.status;
      await updateDesign(code, { status, orderNo, memo: d.memo });
      results.push({ code, ok: true, message: d.status === 'received' ? '주문번호 연결 · 주문 확인' : '주문번호 연결' });
    } catch (e) {
      results.push({ code, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  await safeRevalidatePath('/admin', 'layout');
  return { ok: true, results };
}

// 인쇄 시트 QR을 찍으면 그 건을 '인쇄 완료'로. 되돌리기용으로 바꾸기 전 상태를 돌려준다
export async function markPrintedAction(raw: string): Promise<
  { ok: true; code: string; previous: DesignStatus; productName: string; quantity: number; already: boolean } | { ok: false; message: string }
> {
  const no = await denied();
  if (no) return no;
  const code = normalizeDesignCode(String(raw ?? ''));
  if (!code) return { ok: false, message: '디자인 코드를 읽지 못했습니다.' };
  try {
    const [d] = await listDesigns({ code, limit: 1, includePending: true });
    if (!d) return { ok: false, message: `${code} 접수를 찾을 수 없습니다.` };
    if (d.status === 'pending') return { ok: false, message: `${code}는 결제 대기 중인 접수라 인쇄 완료로 바꿀 수 없습니다.` };
    if (d.status === 'canceled' || d.cafe24Canceled) return { ok: false, message: `${code}는 취소된 접수라 바꾸지 않았습니다.` };
    if (!d.orderNo) return { ok: false, message: `${code}의 주문 연결을 확인해 주세요.` };
    const base = { ok: true as const, code, previous: d.status, productName: d.productName, quantity: d.quantity };
    if (d.status === 'printed') return { ...base, already: true };
    await updateDesign(code, { status: 'printed' }, { status: d.status, orderNo: d.orderNo, cafe24Canceled: d.cafe24Canceled });
    await safeRevalidatePath('/admin', 'layout');
    return { ...base, already: false };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateDesignAction(
  code: string,
  patch: {
    status?: string;
    orderNo?: string | null;
    memo?: string;
    eventDate?: string | null;
    desiredDeliveryDate?: string | null;
  },
): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };

  const [d] = await listDesigns({ code: c, limit: 1, includePending: true });
  if (!d) return { ok: false, message: '접수를 찾을 수 없습니다.' };

  // 취소된 주문의 상태는 변경 불가
  if ((d.status === 'canceled' || d.cafe24Canceled) && patch.status !== undefined && patch.status !== 'canceled') {
    return { ok: false, message: '취소된 디자인의 상태는 변경할 수 없습니다.' };
  }

  // 결제 대기 건은 임의로 확인/인쇄/완료/포장없음으로 변경 불가 (카페24 결제 확인 필요)
  if (d.status === 'pending' && patch.status !== undefined && patch.status !== 'canceled') {
    return { ok: false, message: '결제 대기 중인 디자인은 카페24 결제가 확인되어야 변경할 수 있습니다.' };
  }
  if (patch.status === 'no_packaging' && (d.styleId || d.sticker || d.card || d.hasPrintFile || d.hasCardPrintFile)) {
    return { ok: false, message: '포장이나 인쇄물이 포함된 접수는 포장 없음으로 변경할 수 없습니다.' };
  }
  if (patch.status && ['order_confirmed', 'printed', 'completed'].includes(patch.status) && !d.orderNo) {
    return { ok: false, message: '카페24 주문 연결을 확인한 뒤 처리해 주세요.' };
  }

  const updatePatch: Parameters<typeof updateDesign>[1] = {};

  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status as DesignStatus)) {
      return { ok: false, message: '잘못된 상태입니다.' };
    }
    updatePatch.status = patch.status as DesignStatus;
  }

  if (patch.orderNo !== undefined) {
    const raw = patch.orderNo === null ? null : String(patch.orderNo).trim();
    if (raw && !ORDER_NO.test(raw)) {
      return { ok: false, message: '주문번호는 숫자·영문·하이픈만 적어 주세요. 예: 20261021-0000123' };
    }
    if (raw && raw !== d.orderNo) return { ok: false, message: '주문번호 연결은 카페24 주문 검증을 통해 진행해 주세요.' };
    updatePatch.orderNo = raw || null;
  }

  if (patch.memo !== undefined) {
    updatePatch.memo = String(patch.memo ?? '').trim().slice(0, 500);
  }

  if (patch.eventDate !== undefined) {
    updatePatch.eventDate = sanitizeIsoDate(patch.eventDate);
  }

  if (patch.desiredDeliveryDate !== undefined) {
    updatePatch.desiredDeliveryDate = sanitizeIsoDate(patch.desiredDeliveryDate);
  }

  return run(() => updateDesign(c, updatePatch, { status: d.status, orderNo: d.orderNo, cafe24Canceled: d.cafe24Canceled }));
}

// 관리자 단건 상세 조회: 고객 작성 문구(draft, cardDraft)를 온전히 읽어와 검수를 지원한다
export async function getDesignDetailAction(code: string): Promise<{ ok: true; design: import('../../../packaging/types.ts').Design } | { ok: false; message: string }> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };
  try {
    const d = await getDesign(c);
    if (!d) return { ok: false, message: '디자인을 찾을 수 없습니다.' };
    return { ok: true, design: d };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// 카페24 주문 실제 검증 후 디자인 단건에 주문번호 연결
// 주문 존재, 결제 완료, 상품번호 일치, 수량 일치, 중복 연결 방지를 실시간 검증한다.
// 검증할 수 없는 임의 입력은 안전을 위해 원천 차단한다.
export async function linkDesignToOrderAction(code: string, rawOrderNo: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };
  const orderNo = String(rawOrderNo ?? '').trim();
  if (!orderNo || !ORDER_NO.test(orderNo)) return { ok: false, message: '주문번호는 숫자·영문·하이픈만 입력해 주세요.' };

  const [d] = await listDesigns({ code: c, limit: 1, includePending: true });
  if (!d) return { ok: false, message: '접수를 찾을 수 없습니다.' };
  if (d.status === 'pending') {
    return { ok: false, message: '결제 대기 건은 카페24 결제 확인이 선행되어야 합니다.' };
  }
  if (d.status === 'canceled' || d.cafe24Canceled) {
    return { ok: false, message: '취소된 접수는 주문번호를 연결할 수 없습니다.' };
  }
  if (d.orderNo && d.orderNo !== orderNo) {
    return { ok: false, message: '이미 다른 주문에 연결된 디자인입니다.' };
  }

  // 1) 카페24 API를 통한 주문 존재·결제·취소 실시간 검증
  let order: import('../../../cafe24/admin-orders.ts').Cafe24AdminOrder;
  let validItems: import('../../../cafe24/admin-orders.ts').Cafe24AdminOrderItem[];
  try {
    const { fetchAdminOrder, isOrderPaid, isOrderCanceled, isItemCanceledOrRefunded } = await import('../../../cafe24/admin-orders.ts');
    const { extractAllDesignCodes } = await import('../../../cafe24/readonly-orders.ts');
    order = await fetchAdminOrder(orderNo);

    const allCodes = extractAllDesignCodes(order);
    if (!allCodes.includes(c)) {
      return { ok: false, message: '카페24 주문에 이 디자인 코드가 확인되지 않습니다. 주문서의 코드를 확인해 주세요.' };
    }

    if (isOrderCanceled(order)) {
      return { ok: false, message: `카페24 주문(${orderNo})이 취소/환불 상태입니다.` };
    }

    if (!isOrderPaid(order)) {
      return { ok: false, message: `카페24 주문(${orderNo})의 결제가 아직 확인되지 않았습니다 (미결제 상태).` };
    }

    const items = Array.isArray(order.items) ? order.items : [];
    validItems = items.filter((item) => !isItemCanceledOrRefunded(item));
  } catch (err) {
    return {
      ok: false,
      message: `카페24 주문 검증 실패: ${err instanceof Error ? err.message : String(err)}. 상품·수량·결제가 검증되지 않은 주문번호는 기록할 수 없습니다.`,
    };
  }

  // 2) 주문 내 해당 상품의 총 유효 주문 수량 계산
  const totalOrderedQty = validItems
    .filter((item) => item.product_no === d.productNo)
    .reduce((sum, item) => sum + (item.quantity || 0), 0);

  if (totalOrderedQty === 0) {
    const orderProducts = validItems.map((i) => `#${i.product_no}(${i.quantity}개)`).join(', ') || '없음';
    return {
      ok: false,
      message: `카페24 주문의 상품 목록(${orderProducts})에 디자인 상품(#${d.productNo})이 포함되어 있지 않습니다.`,
    };
  }

  // 3) 주문번호에 연결된 기존 디자인 전수 조회 (최근 500개 제한 없는 전체 조회)
  // 한 주문에 여러 디자인이 연결될 수 있으므로(다품목 주문 또는 동일 품목 분할), 다른 디자인에 기할당된 수량을 집계하여 초과 연결을 차단한다.
  const existingForOrder = await getDesignsByOrderNo(orderNo);
  const otherLinked = existingForOrder.filter((x) => x.code !== c && x.status !== 'canceled');

  const alreadyAllocatedQty = otherLinked
    .filter((x) => x.productNo === d.productNo)
    .reduce((sum, x) => sum + x.quantity, 0);

  const remainingQty = totalOrderedQty - alreadyAllocatedQty;

  if (remainingQty < d.quantity) {
    const conflictingCodes = otherLinked
      .filter((x) => x.productNo === d.productNo)
      .map((x) => x.code)
      .join(', ');

    if (alreadyAllocatedQty >= totalOrderedQty) {
      return {
        ok: false,
        message: `카페24 주문(${orderNo})의 상품(#${d.productNo}) 주문 수량(${totalOrderedQty}개)이 이미 다른 디자인(${conflictingCodes})에 전체 연결되어 있습니다.`,
      };
    }
    return {
      ok: false,
      message: `카페24 주문(${orderNo})의 상품(#${d.productNo}) 남은 수량(${remainingQty}개)이 디자인 접수 수량(${d.quantity}개)보다 부족합니다. (기존 연결: ${conflictingCodes} - ${alreadyAllocatedQty}개)`,
    };
  }

  // 5대 검증 불변식이 모두 통과한 경우에만 안전하게 기록
  return run(() => updateDesign(c, {
    orderNo,
  }, { status: d.status, orderNo: d.orderNo, cafe24Canceled: d.cafe24Canceled }));
}

// 포장이나 인쇄물이 없는 일반 단품 주문에 대해 '포장 없음' 상태로 확정
// 오처리 방지: 스티커/카드 인쇄물이 있거나 결제대기/취소 건은 엄격히 차단
export async function dismissPackagingAction(code: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };

  const [d] = await listDesigns({ code: c, limit: 1, includePending: true });
  if (!d) return { ok: false, message: '접수를 찾을 수 없습니다.' };

  if (d.status === 'pending') {
    return { ok: false, message: '결제 대기 중인 주문은 포장 없음으로 변경할 수 없습니다.' };
  }
  if (d.status === 'canceled' || d.cafe24Canceled) {
    return { ok: false, message: '취소된 주문은 포장 없음으로 변경할 수 없습니다.' };
  }
  if (d.styleId || d.sticker || d.card || d.hasPrintFile || d.hasCardPrintFile) {
    return { ok: false, message: '포장이나 인쇄물이 포함된 주문은 포장 없음으로 확정할 수 없습니다.' };
  }

  return run(() => updateDesign(c, {
    status: 'no_packaging',
  }, { status: d.status, orderNo: d.orderNo, cafe24Canceled: d.cafe24Canceled }));
}

// 부분 취소 확인 필요 상태(cafe24Canceled: true)인 디자인에 대해 관리자가 카페24 주문서 대조 후 정상 진행으로 복구
export async function confirmResumeAction(code: string, note?: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };

  const [d] = await listDesigns({ code: c, limit: 1, includePending: true });
  if (!d) return { ok: false, message: '접수를 찾을 수 없습니다.' };

  // 1) 이미 취소 확정된 건은 정상 진행으로 복구 불가 (필수 검증 7)
  if (d.status === 'canceled') {
    return { ok: false, message: '취소 확정된 접수는 정상 진행으로 변경할 수 없습니다.' };
  }

  // 2) 실제 전체 취소나 해당 품목 취소가 확인된 건을 정상 진행으로 잘못 되돌리지 않도록 서버에서 주문 상태 검증
  if (d.orderNo) {
    try {
      const { fetchAdminOrder, isOrderCanceled, isItemCanceledOrRefunded } = await import('../../../cafe24/admin-orders.ts');
      const { extractItemDesignCode } = await import('../../../cafe24/readonly-orders.ts');
      const order = await fetchAdminOrder(d.orderNo);

      if (isOrderCanceled(order)) {
        return {
          ok: false,
          message: `카페24 주문(${d.orderNo}) 전체가 취소된 상태입니다. 정상 진행할 수 없으며 취소 확정이 필요합니다.`,
        };
      }

      const items = Array.isArray(order.items) ? order.items : [];
      const itemForThisDesign = items.find((item) => extractItemDesignCode(item) === c);
      if (itemForThisDesign && isItemCanceledOrRefunded(itemForThisDesign)) {
        return {
          ok: false,
          message: '해당 품목이 카페24에서 취소된 상태입니다. 취소 확정 처리를 해 주세요.',
        };
      }
    } catch {
      // 조회 실패 시에도 관리자 명시적 확인 메모가 기록되므로 진행
    }
  }

  const confirmMsg = `[관리자 확인: 정상 진행${note?.trim() ? ` - ${note.trim()}` : ''}]`;
  const nextMemo = d.memo.includes('정상 진행')
    ? d.memo
    : d.memo.trim()
    ? `${d.memo.trim()}\n${confirmMsg}`.slice(0, 500)
    : confirmMsg;

  return run(() =>
    updateDesign(
      c,
      {
        cafe24Canceled: false,
        memo: nextMemo,
      },
      { status: d.status, orderNo: d.orderNo, cafe24Canceled: d.cafe24Canceled },
    ),
  );
}

// 카페24 주문 취소 알림이 발생한 디자인에 대해 관리자가 취소를 확인하고 접수를 취소 확정 처리
export async function confirmCancelAction(code: string, note?: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };

  const [d] = await listDesigns({ code: c, limit: 1, includePending: true });
  if (!d) return { ok: false, message: '접수를 찾을 수 없습니다.' };
  if (d.status === 'canceled') return { ok: true };

  const confirmMsg = `[관리자 확인: 취소 확정${note?.trim() ? ` - ${note.trim()}` : ''}]`;
  const nextMemo = d.memo.includes('취소 확정')
    ? d.memo
    : d.memo.trim()
    ? `${d.memo.trim()}\n${confirmMsg}`.slice(0, 500)
    : confirmMsg;

  return run(() =>
    updateDesign(
      c,
      {
        status: 'canceled',
        cafe24Canceled: true,
        memo: nextMemo,
      },
      { status: d.status, orderNo: d.orderNo, cafe24Canceled: d.cafe24Canceled },
    ),
  );
}

export async function syncCafe24OrdersAction(): Promise<{ ok: boolean; message: string; confirmed?: number; total?: number }> {
  const no = await denied();
  if (no) return { ok: false, message: no.message };
  try {
    const { processPaymentEventQueue, syncRecentCafe24Orders } = await import('../../../cafe24/intake-worker.ts');
    const queue = await processPaymentEventQueue();
    const result = await syncRecentCafe24Orders(3);
    await safeRevalidatePath('/admin/packaging');
    await safeRevalidatePath('/admin/health');
    return {
      ok: queue.errors === 0,
      message: `카페24 주문 동기화 완료: 최근 주문 ${result.total}건 확인 (입금 완료: ${result.confirmed}건, 결제 대기: ${result.pendingOrders}건)${queue.errors ? ' · 결제 알림 재처리 오류를 운영 상태에서 확인해 주세요.' : ''}`,
      confirmed: result.confirmed,
      total: result.total,
    };
  } catch (e) {
    return { ok: false, message: `카페24 주문 동기화 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}
