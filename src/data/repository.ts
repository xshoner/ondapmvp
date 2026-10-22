// 앱(서버 컴포넌트·서버 액션)이 쓰는 데이터 입구.
// ONDAP_DATA_SOURCE=supabase 이면 Supabase, 아니면 로컬 JSON(data/)을 쓴다.
// CLI 스크립트와 테스트는 src/data/catalog.ts(로컬 JSON)를 직접 쓴다.

import * as local from './catalog.ts';
import { attributesFromRow, attributesToRow, productFromRow, productToRow, type AttributesRow, type ProductRow } from './rows.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { createClient } from '../lib/supabase/server.ts';
import type { Cafe24Product, Catalog, EngineConfig, ProductAttributes, RecommendResult } from '../engine/types.ts';

export type Expectations = local.Expectations;
export type AttributeChange = local.AttributeChange;

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what} 실패: ${error?.message ?? '알 수 없는 오류'}`);
}

export async function getCatalog(): Promise<Catalog> {
  if (dataSource() === 'local') return local.loadCatalog();
  const db = await createClient();
  const [p, a, c] = await Promise.all([
    db.from('products').select('*').order('product_no'),
    db.from('product_attributes').select('*').order('product_no'),
    db.from('engine_config').select('config').eq('id', 'active').maybeSingle(),
  ]);
  if (p.error) fail('상품 읽기', p.error);
  if (a.error) fail('지표 읽기', a.error);
  if (c.error || !c.data) fail('엔진 설정 읽기', c.error ?? { message: 'engine_config 행이 없습니다. seed.sql을 실행하세요.' });
  return {
    products: (p.data as ProductRow[]).map(productFromRow),
    attributes: (a.data as AttributesRow[]).map(attributesFromRow),
    config: c.data.config as EngineConfig,
  };
}

export async function getSyncInfo(): Promise<{ mallId: string; syncedAt: string | null }> {
  if (dataSource() === 'local') return local.loadSyncInfo();
  const db = await createClient();
  const { data, error } = await db.from('products').select('synced_at').order('synced_at', { ascending: false }).limit(1);
  if (error) fail('동기화 시각 읽기', error);
  return { mallId: process.env.CAFE24_MALL_ID ?? '', syncedAt: data?.[0]?.synced_at ?? null };
}

export async function getExpectations(): Promise<Expectations> {
  if (dataSource() === 'local') return local.loadExpectations();
  const db = await createClient();
  const { data, error } = await db.from('scenario_expectations').select('scenario_key, product_no');
  if (error) fail('기대 정답 읽기', error);
  return Object.fromEntries((data ?? []).map((r) => [r.scenario_key as string, r.product_no as number]));
}

async function currentUserId(db: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data } = await db.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

// 한 상품 또는 여러 상품(엑셀 올리기)의 지표를 한 번에 저장한다
export async function saveAttributes(...list: ProductAttributes[]): Promise<void> {
  if (list.length === 0) return;
  if (dataSource() === 'local') return local.saveProductAttributes(...list);
  const db = await createClient();
  const meta = { updated_at: new Date().toISOString(), updated_by: await currentUserId(db) };
  const { error, count } = await db.from('product_attributes').upsert(list.map((a) => ({ ...attributesToRow(a), ...meta })), { count: 'exact' });
  if (error) fail('지표 저장', error);
  if (count === 0) fail('지표 저장', { message: '권한이 없어 저장되지 않았습니다.' });
}

// 한 상품의 지표 변경 이력 (최근 것부터)
export async function getAttributeHistory(productNo: number, limit = 30): Promise<AttributeChange[]> {
  if (dataSource() === 'local') {
    return local.loadAttributeHistory().filter((h) => h.productNo === productNo).reverse().slice(0, limit);
  }
  const db = await createClient();
  const { data, error } = await db
    .from('product_attributes_history')
    .select('id, product_no, changed_at, changed_by_email, op, before, after')
    .eq('product_no', productNo)
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) fail('지표 이력 읽기', error);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    productNo: r.product_no as number,
    changedAt: r.changed_at as string,
    changedBy: (r.changed_by_email as string | null) ?? null,
    op: r.op as AttributeChange['op'],
    before: r.before ? attributesFromRow(r.before as AttributesRow) : null,
    after: r.after ? attributesFromRow(r.after as AttributesRow) : null,
  }));
}

export async function saveConfig(config: EngineConfig): Promise<void> {
  if (dataSource() === 'local') return local.saveEngineConfig(config);
  const db = await createClient();
  const { error, count } = await db
    .from('engine_config')
    .upsert({ id: 'active', config, updated_at: new Date().toISOString(), updated_by: await currentUserId(db) }, { count: 'exact' });
  if (error) fail('설정 저장', error);
  if (count === 0) fail('설정 저장', { message: '권한이 없어 저장되지 않았습니다.' });
}

// 카페24 동기화 결과로 상품 표를 맞춘다 (카페24에서 사라진 상품은 지운다. 지표는 남겨 둔다)
export async function saveProducts(mallId: string, products: Cafe24Product[]): Promise<void> {
  if (dataSource() === 'local') return local.saveCafe24Products(mallId, products);
  const db = await createClient();
  const now = new Date().toISOString();
  const { error } = await db.from('products').upsert(products.map((p) => ({ ...productToRow(p), synced_at: now })));
  if (error) fail('상품 저장', error);
  const keep = products.map((p) => p.productNo);
  if (keep.length) {
    const del = await db.from('products').delete().not('product_no', 'in', `(${keep.join(',')})`);
    if (del.error) fail('사라진 상품 정리', del.error);
  }
}

export async function saveExpectation(key: string, productNo: number | null): Promise<void> {
  if (dataSource() === 'local') return local.saveExpectation(key, productNo);
  const db = await createClient();
  const q = productNo === null
    ? db.from('scenario_expectations').delete().eq('scenario_key', key)
    : db.from('scenario_expectations').upsert({ scenario_key: key, product_no: productNo, updated_at: new Date().toISOString(), updated_by: await currentUserId(db) });
  const { error } = await q;
  if (error) fail('기대 정답 저장', error);
}

// 고객 추천 기록. 실패해도 화면은 계속 보여준다
export async function logRecommendation(result: RecommendResult, modelVersion: string): Promise<void> {
  if (dataSource() === 'local') return;
  try {
    const db = await createClient();
    const { error } = await db.from('recommendation_logs').insert({
      event: result.input.event,
      relation: result.input.relation,
      budget_max: result.input.budgetMax ?? null,
      quantity: result.input.quantity ?? null,
      result_product_nos: result.results.map((r) => r.product.productNo),
      model_version: modelVersion,
    });
    if (error) console.warn('[추천 기록] 저장 실패:', error.message);
  } catch (e) {
    console.warn('[추천 기록] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

// 실적 대시보드용 추천 기록 (관리자만 읽기 가능). 한 번에 1,000건씩 나눠 최대 20,000건
export async function getRecommendationLogs(range: { gte: string | null; lt: string | null }): Promise<{ createdAt: string; event: string; relation: string; resultProductNos: number[] }[]> {
  if (dataSource() === 'local') return []; // 로컬 모드는 추천 기록을 남기지 않는다
  const db = await createClient();
  const out: { createdAt: string; event: string; relation: string; resultProductNos: number[] }[] = [];
  for (let page = 0; page < 20; page++) {
    let q = db.from('recommendation_logs').select('created_at, event, relation, result_product_nos').order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999);
    if (range.gte) q = q.gte('created_at', range.gte);
    if (range.lt) q = q.lt('created_at', range.lt);
    const { data, error } = await q;
    if (error) fail('추천 기록 읽기', error);
    for (const r of data ?? []) out.push({ createdAt: r.created_at as string, event: r.event as string, relation: r.relation as string, resultProductNos: (r.result_product_nos as number[]) ?? [] });
    if (!data || data.length < 1000) break;
  }
  return out;
}

// 메인 화면 '이번 달 n번' 한 줄. 함수가 아직 없거나(SQL 미실행) 로컬 모드면 null → 화면에서 숨김
export async function getMonthlyRecommendationCount(): Promise<number | null> {
  if (dataSource() === 'local') return null;
  try {
    const db = await createClient();
    const { data, error } = await db.rpc('monthly_recommendation_count');
    return error || typeof data !== 'number' ? null : data;
  } catch {
    return null;
  }
}
