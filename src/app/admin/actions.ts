'use server';

import { revalidatePath } from 'next/cache';
import { saveCafe24Products, saveEngineConfig, saveExpectation, saveProductAttributes } from '@/data/catalog.ts';
import { cafe24ConfigFromEnv, fetchAllProducts } from '@/cafe24/client.ts';
import type { EngineConfig, ProductAttributes } from '@/engine/types.ts';

function clampScore(n: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(n)));
}

export async function saveAttributesAction(attrs: ProductAttributes): Promise<{ ok: true; savedAt: string }> {
  saveProductAttributes({
    ...attrs,
    scores: Object.fromEntries(Object.entries(attrs.scores).map(([k, v]) => [k, clampScore(Number(v), 10)])),
    tags: attrs.tags.map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    excludedEvents: attrs.excludedEvents.filter((x) => x.reason.trim()),
    meanings: Object.fromEntries(Object.entries(attrs.meanings).filter(([, v]) => v && v.trim())),
  });
  revalidatePath('/admin', 'layout');
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function saveConfigAction(config: EngineConfig): Promise<{ ok: true }> {
  saveEngineConfig(config);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function syncCafe24Action(): Promise<{ ok: boolean; message: string }> {
  try {
    const config = cafe24ConfigFromEnv(process.env as Record<string, string>);
    const products = await fetchAllProducts(config);
    saveCafe24Products(config.mallId, products);
    revalidatePath('/', 'layout');
    return { ok: true, message: `상품 ${products.length}개를 가져왔습니다.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveExpectationAction(key: string, productNo: number | null): Promise<void> {
  saveExpectation(key, productNo);
  revalidatePath('/admin/verify');
}
