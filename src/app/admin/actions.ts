'use server';

import { revalidatePath } from 'next/cache';
import {
  getAttributeHistory, getCatalog, getRecommendationLogs, saveAttributes, saveConfig, saveExpectation, saveProducts, type AttributeChange,
} from '@/data/repository.ts';
import { diffProducts, syncSummary } from '@/cafe24/sync-diff.ts';
import { soldOutFavorites, type FavoriteAlert } from '@/stats/summary.ts';
import { buildPrompt, normalizeSuggestion, suggestionSchema, type AiSuggestion } from '@/ai/suggest.ts';
import { generateJson } from '@/ai/gemini.ts';
import { cafe24ConfigFromEnv, fetchAllProducts } from '@/cafe24/client.ts';
import type { Cafe24Product, EngineConfig, ProductAttributes } from '@/engine/types.ts';
import { requireAdmin } from '@/lib/admin-guard.ts';

// 모든 액션은 첫 줄에서 requireAdmin()으로 확인한다. Supabase 모드에서는 DB의 RLS가 한 번 더 막는다.

function clampScore(n: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(n)));
}

// 저장 전 정리: 점수 0~10 정수, 태그 # 떼기, 사유 없는 제외·빈 의미 버리기
function cleanAttributes(attrs: ProductAttributes): ProductAttributes {
  if (!Number.isInteger(attrs.productNo) || attrs.productNo <= 0) throw new Error('잘못된 상품번호입니다.');
  return {
    ...attrs,
    scores: Object.fromEntries(Object.entries(attrs.scores).map(([k, v]) => [k, clampScore(Number(v), 10)])),
    tags: attrs.tags.map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    excludedEvents: attrs.excludedEvents.filter((x) => x.reason.trim()),
    meanings: Object.fromEntries(Object.entries(attrs.meanings).filter(([, v]) => v && v.trim())),
  };
}

export async function saveAttributesAction(attrs: ProductAttributes): Promise<{ ok: true; savedAt: string }> {
  await requireAdmin();
  await saveAttributes(cleanAttributes(attrs));
  revalidatePath('/admin', 'layout');
  return { ok: true, savedAt: new Date().toISOString() };
}

// 엑셀(CSV)로 고친 여러 상품을 한 번에 저장. 쇼핑몰에 없는 상품번호는 거절한다
export async function saveAttributesBulkAction(list: ProductAttributes[]): Promise<{ ok: true; saved: number } | { ok: false; message: string }> {
  try {
    await requireAdmin();
    if (!Array.isArray(list) || list.length === 0) return { ok: false, message: '저장할 상품이 없습니다.' };
    if (list.length > 1000) return { ok: false, message: '한 번에 1,000개까지 저장할 수 있습니다.' };
    const known = new Set((await getCatalog()).products.map((p) => p.productNo));
    const missing = list.filter((a) => !known.has(a.productNo)).map((a) => a.productNo);
    if (missing.length) return { ok: false, message: `쇼핑몰에 없는 상품번호: ${missing.join(', ')}` };
    await saveAttributes(...list.map(cleanAttributes));
    revalidatePath('/', 'layout');
    return { ok: true, saved: list.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function getAttributeHistoryAction(productNo: number): Promise<{ ok: true; history: AttributeChange[] } | { ok: false; message: string }> {
  try {
    await requireAdmin();
    if (!Number.isInteger(productNo) || productNo <= 0) return { ok: false, message: '잘못된 상품번호입니다.' };
    return { ok: true, history: await getAttributeHistory(productNo) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveConfigAction(config: EngineConfig): Promise<{ ok: true }> {
  await requireAdmin();
  if (!Array.isArray(config?.indicators) || !config.events || !config.relations) throw new Error('잘못된 설정입니다.');
  // 점수 기준 예시는 짧은 글만 (화면 도움말에 그대로 나온다)
  for (const ind of config.indicators) {
    if (!ind.examples) continue;
    ind.examples = Object.fromEntries(
      (['high', 'mid', 'low'] as const).map((k) => [k, String(ind.examples?.[k] ?? '').trim().slice(0, 120)]).filter(([, v]) => v),
    );
  }
  await saveConfig(config);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export interface SyncReport {
  count: number;
  summary: string;
  added: { productNo: number; name: string }[];
  priceChanged: { productNo: number; name: string; from: number; to: number }[];
  stopped: { productNo: number; name: string }[];
  resumed: { productNo: number; name: string }[];
  removed: { productNo: number; name: string }[];
  alerts: FavoriteAlert[]; // 최근 30일 자주 1위였는데 이번에 팔 수 없게 된 상품
}

// 카페24 상품을 다시 가져오고, 무엇이 바뀌었는지 요약한다
export async function syncCafe24Action(): Promise<{ ok: true; message: string; report: SyncReport } | { ok: false; message: string }> {
  await requireAdmin();
  try {
    const config = cafe24ConfigFromEnv(process.env as Record<string, string>);
    const before = (await getCatalog()).products;
    const products = await fetchAllProducts(config);
    if (products.length === 0) return { ok: false, message: '카페24에서 상품을 하나도 받지 못해 아무것도 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.' };
    await saveProducts(config.mallId, products);
    revalidatePath('/', 'layout');
    const d = diffProducts(before, products);
    const brief = (p: Cafe24Product) => ({ productNo: p.productNo, name: p.name });
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const alerts = d.stopped.length ? soldOutFavorites(await getRecommendationLogs({ gte: since, lt: null }), d.stopped) : [];
    const report: SyncReport = {
      count: products.length,
      summary: syncSummary(d),
      added: d.added.map(brief),
      priceChanged: d.priceChanged.map((x) => ({ ...brief(x.product), from: x.from, to: x.product.price })),
      stopped: d.stopped.map(brief),
      resumed: d.resumed.map(brief),
      removed: d.removed.map(brief),
      alerts,
    };
    return { ok: true, message: `상품 ${products.length}개를 가져왔습니다. ${report.summary}.`, report };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// AI 점수 제안. 저장하지 않고 제안만 돌려준다 (관리자가 확인 후 저장)
// 상품명·가격은 클라이언트 값을 믿지 않고 저장소에서 다시 읽는다
export async function suggestScoresAction(
  productNo: number,
  draft: { region: string; category: string; story: string; tags: string[] },
): Promise<{ ok: true; suggestion: AiSuggestion } | { ok: false; message: string }> {
  await requireAdmin();
  try {
    const catalog = await getCatalog();
    const product = catalog.products.find((p) => p.productNo === productNo);
    if (!product) return { ok: false, message: '상품을 찾을 수 없습니다.' };
    const input = {
      productName: product.name,
      price: product.price,
      region: String(draft.region ?? '').slice(0, 30),
      category: String(draft.category ?? '').slice(0, 30),
      story: String(draft.story ?? '').slice(0, 2000),
      tags: (Array.isArray(draft.tags) ? draft.tags : []).map((t) => String(t).slice(0, 20)).slice(0, 10),
    };
    const { system, user } = buildPrompt(catalog.config, input);
    const { data, model } = await generateJson({ system, user, schema: suggestionSchema(catalog.config) });
    return { ok: true, suggestion: normalizeSuggestion(data, catalog.config, model) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveExpectationAction(key: string, productNo: number | null): Promise<void> {
  await requireAdmin();
  if (!/^[a-z]+:[a-z]+$/.test(key)) throw new Error('잘못된 시나리오입니다.');
  if (productNo !== null && (!Number.isInteger(productNo) || productNo <= 0)) throw new Error('잘못된 상품번호입니다.');
  await saveExpectation(key, productNo);
  revalidatePath('/admin/verify');
}
