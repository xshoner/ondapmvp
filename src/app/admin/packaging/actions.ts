'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteAsset, getPackagingAssets, listDesigns, saveAsset, updateDesign, updateDesignsStatus, uploadAssetFile, type AssetKind,
} from '@/data/packaging-repository.ts';
import { MAX_ACTIVE, canActivate, isCategory, normalizeDesignCode } from '@/packaging/rules.ts';
import type { DesignImage, DesignStatus, DesignText, PackagingStyle } from '@/packaging/types.ts';
import { requireAdmin } from '@/lib/admin-guard.ts';

// 모든 액션은 첫 줄에서 관리자인지 확인한다. Supabase 모드에서는 RLS가 한 번 더 막는다.
// 권한 오류는 던지지 않고 {ok:false}로 돌려준다: 세션이 만료돼도 화면 전체가 오류 화면으로 바뀌지 않게

type Result = { ok: true } | { ok: false; message: string };
const KINDS: AssetKind[] = ['styles', 'images', 'texts'];
const STATUSES: DesignStatus[] = ['received', 'order_confirmed', 'printed', 'canceled'];
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
    revalidatePath('/admin/packaging');
    revalidatePath('/packaging');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function clean(kind: AssetKind, raw: Record<string, unknown>): PackagingStyle | DesignImage | DesignText {
  const base = { id: String(raw.id ?? ''), active: raw.active !== false, sort: Math.round(Number(raw.sort) || 0) };
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
  try {
    const updated = await updateDesignsStatus(codes, status as DesignStatus);
    revalidatePath('/admin', 'layout');
    return { ok: true, updated, missing: codes.filter((c) => !updated.includes(c)) };
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
      const [d] = await listDesigns({ code, limit: 1 });
      if (!d) {
        results.push({ code, ok: false, message: '접수를 찾을 수 없습니다.' });
        continue;
      }
      const status = d.status === 'received' ? 'order_confirmed' : d.status;
      await updateDesign(code, { status, orderNo, memo: d.memo });
      results.push({ code, ok: true, message: d.status === 'received' ? '주문번호 연결 · 주문 확인' : '주문번호 연결' });
    } catch (e) {
      results.push({ code, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  revalidatePath('/admin', 'layout');
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
    const [d] = await listDesigns({ code, limit: 1 });
    if (!d) return { ok: false, message: `${code} 접수를 찾을 수 없습니다.` };
    if (d.status === 'canceled') return { ok: false, message: `${code}는 취소된 접수라 바꾸지 않았습니다.` };
    const base = { ok: true as const, code, previous: d.status, productName: d.productName, quantity: d.quantity };
    if (d.status === 'printed') return { ...base, already: true };
    await updateDesign(code, { status: 'printed', orderNo: d.orderNo, memo: d.memo });
    revalidatePath('/admin', 'layout');
    return { ...base, already: false };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateDesignAction(code: string, patch: { status: string; orderNo: string; memo: string }): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const c = normalizeDesignCode(String(code));
  if (!c) return { ok: false, message: '잘못된 디자인 코드입니다.' };
  if (!STATUSES.includes(patch.status as DesignStatus)) return { ok: false, message: '잘못된 상태입니다.' };
  // 카페24 주문번호는 숫자·영문·하이픈 (인쇄 PDF 머리글에도 찍힌다)
  const orderNo = String(patch.orderNo ?? '').trim();
  if (!ORDER_NO.test(orderNo)) return { ok: false, message: '주문번호는 숫자·영문·하이픈만 적어 주세요. 예: 20261021-0000123' };
  return run(() => updateDesign(c, {
    status: patch.status as DesignStatus,
    orderNo: orderNo || null,
    memo: String(patch.memo ?? '').trim().slice(0, 500),
  }));
}
