// 앱(서버 컴포넌트·서버 액션)이 쓰는 데이터 입구.
// ONDAP_DATA_SOURCE=supabase 이면 Supabase, 아니면 로컬 JSON(data/)을 쓴다.
// CLI 스크립트와 테스트는 src/data/catalog.ts(로컬 JSON)를 직접 쓴다.

import * as local from './catalog.ts';
import { fail, readPages, type DbPage } from './db.ts';
import { attributesFromRow, attributesToRow, productFromRow, productToRow, type AttributesRow, type ProductRow } from './rows.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { createClient } from '../lib/supabase/server.ts';
import type { Cafe24Product, Catalog, EngineConfig, ProductAttributes, RecommendResult } from '../engine/types.ts';
import type { FeedbackLog, FeedbackReason } from '../lib/feedback.ts';
import { cache } from 'react';
import { reportOperation } from '../lib/operations.ts';
import { validateProductSnapshot } from '../cafe24/sync-rules.ts';
import { recordOperation } from './operations-repository.ts';

export type Expectations = local.Expectations;
export type AttributeChange = local.AttributeChange;

// React 캐시는 요청 안에서만 공유한다. 관리자 쿠키/가격을 다른 요청에 보관하지 않는다.
export const getCatalog = cache(async function getCatalog(): Promise<Catalog> {
  const startedAt = Date.now();
  try {
    const result = await readCatalog();
    reportOperation('catalog_read', 'ok', startedAt);
    return result;
  } catch {
    await recordOperation('catalog_read', 'error', startedAt, 'db_read');
    throw new Error('상품 정보를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

async function readCatalog(): Promise<Catalog> {
  if (dataSource() === 'local') return local.loadCatalog();
  const db = await createClient();
  const [p, a, c] = await Promise.all([
    readPages((from, to) => db.from('products').select('product_no,name,price,display,selling,sold_out,image,detail_image,url').order('product_no').range(from, to) as DbPage<ProductRow>, 20000, true),
    readPages((from, to) => db.from('product_attributes').select('product_no,region,category,scores,events,relations,excluded_events,meanings,tags,story,reviewed').order('product_no').range(from, to) as DbPage<AttributesRow>, 20000, true),
    db.from('engine_config').select('config').eq('id', 'active').maybeSingle(),
  ]);
  if (p.error) fail('상품 읽기', p.error);
  if (a.error) fail('지표 읽기', a.error);
  if (c.error || !c.data) fail('엔진 설정 읽기', c.error ?? { message: 'engine_config 행이 없습니다. seed.sql을 실행하세요.' });
  return {
    products: p.rows.map(productFromRow),
    attributes: a.rows.map(attributesFromRow),
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
export async function saveProducts(mallId: string, products: Cafe24Product[], expectedSyncedAt: string | null): Promise<void> {
  validateProductSnapshot(products);
  if (dataSource() === 'local') {
    validateProductSnapshot(products, local.loadCatalog().products);
    if (local.loadSyncInfo().syncedAt !== expectedSyncedAt) throw new Error('다른 작업에서 상품이 갱신됐습니다. 다시 가져와 주세요.');
    return local.saveCafe24Products(mallId, products);
  }
  const db = await createClient();
  const { error } = await db.rpc('sync_product_snapshot', { p_products: products.map(productToRow), p_expected_synced_at: expectedSyncedAt });
  if (error) fail('상품 일괄 갱신 (DB 변경 적용 여부도 확인해 주세요)', error);
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
export async function logRecommendation(result: RecommendResult, modelVersion: string, client?: Awaited<ReturnType<typeof createClient>>): Promise<void> {
  if (dataSource() === 'local') return;
  const startedAt = Date.now();
  try {
    const db = client ?? await createClient();
    const { error } = await db.from('recommendation_logs').insert({
      event: result.input.event,
      relation: result.input.relation,
      budget_max: result.input.budgetMax ?? null,
      quantity: result.input.quantity ?? null,
      result_product_nos: result.results.map((r) => r.product.productNo),
      model_version: modelVersion,
    });
    if (error) await recordOperation('recommendation_log', 'error', startedAt, 'db_write');
    else reportOperation('recommendation_log', 'ok', startedAt);
  } catch (e) {
    await recordOperation('recommendation_log', 'error', startedAt, 'db_unavailable');
  }
}

type RecLogRow = { createdAt: string; event: string; relation: string; resultProductNos: number[]; budgetMax: number | null };

// 기간 조건을 건 기록 읽기 (실적 화면). 최대 20,000건
async function readPeriod(table: string, columns: string, range: { gte: string | null; lt: string | null }) {
  const db = await createClient();
  return readPages((from, to) => {
    let q = db.from(table).select(columns).order('created_at', { ascending: true }).range(from, to);
    if (range.gte) q = q.gte('created_at', range.gte);
    if (range.lt) q = q.lt('created_at', range.lt);
    return q as DbPage<Record<string, unknown>>;
  }, 20000, true);
}

// 실적 대시보드용 추천 기록 (관리자만 읽기 가능)
export async function getRecommendationLogs(range: { gte: string | null; lt: string | null }): Promise<RecLogRow[]> {
  if (dataSource() === 'local') return []; // 로컬 모드는 추천 기록을 남기지 않는다
  const { rows, error } = await readPeriod('recommendation_logs', 'created_at, event, relation, result_product_nos, budget_max', range);
  if (error) fail('추천 기록 읽기', error);
  return rows.map((r) => ({
    createdAt: r.created_at as string, event: r.event as string, relation: r.relation as string,
    resultProductNos: (r.result_product_nos as number[]) ?? [], budgetMax: (r.budget_max as number | null) ?? null,
  }));
}

// 추천에 대한 고객 목소리 (결과 화면 끝). 저장이 안 돼도 고객 화면은 그대로 둔다
export interface NewFeedback {
  event: string; relation: string; budgetMax: number | null; quantity: number; resultProductNos: number[];
  helpful: boolean; reasons: FeedbackReason[]; modelVersion: string;
  requestId: string;
}

export async function saveFeedback(f: NewFeedback): Promise<void> {
  if (dataSource() === 'local') return local.appendFeedback({ ...f, createdAt: new Date().toISOString() });
  const db = await createClient();
  const { error } = await db.rpc('submit_feedback', { p_request_id: f.requestId, p_payload: {
    event: f.event, relation: f.relation, budget_max: f.budgetMax, quantity: f.quantity,
    result_product_nos: f.resultProductNos, helpful: f.helpful, reasons: f.reasons, model_version: f.modelVersion,
  } });
  if (error) fail('의견 저장', error);
}

// 실적 화면용 (관리자만 읽기). 표가 아직 없으면(SQL 실행 전) null → 화면에서 안내
export async function getFeedback(range: { gte: string | null; lt: string | null }): Promise<FeedbackLog[] | null> {
  if (dataSource() === 'local') {
    return local.loadFeedback().filter((f) => (!range.gte || f.createdAt >= range.gte) && (!range.lt || f.createdAt < range.lt));
  }
  const { rows, error } = await readPeriod('recommendation_feedback', 'created_at, event, relation, helpful, reasons', range);
  if (error) return null;
  return rows.map((r) => ({ createdAt: r.created_at as string, event: r.event as string, relation: r.relation as string, helpful: r.helpful as boolean, reasons: (r.reasons as string[]) ?? [] }));
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

// --------------------------------------------------------------------------
// 격식지수 v2 (특허출원 구조): 상품 근거(5대 희소 속성) 및 정책 저장소
// --------------------------------------------------------------------------
import type { IntakeFactors } from '../engine/formality-intake.ts';
import { evidenceFromIntake } from '../engine/formality-intake.ts';
import type { FormalityPolicy, ProductEvidence } from '../engine/eligibility.ts';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../lib/paths.ts';

export interface FormalityEvidenceItem {
  productNo: number;
  description: string;
  factors: IntakeFactors;
  reviewed: boolean;
  rarity: number | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  updatedAt?: string;
}

export interface FormalityData {
  products: Cafe24Product[];
  items: Record<string, FormalityEvidenceItem>;
}

const PILOT_FILE = join(dataDir, 'formality-pilot.json');

function readLocalPilot(catalogProducts: Cafe24Product[]): FormalityData {
  if (!existsSync(PILOT_FILE)) return { products: catalogProducts, items: {} };
  try {
    const value = JSON.parse(readFileSync(PILOT_FILE, 'utf8')) as FormalityData;
    if (!Array.isArray(value.products) || !value.items || typeof value.items !== 'object') {
      throw new Error('잘못된 형식');
    }
    return value;
  } catch {
    throw new Error('로컬 시험 파일을 읽을 수 없습니다. 기존 파일을 확인해 주세요.');
  }
}

function writeLocalPilot(value: FormalityData) {
  const temp = `${PILOT_FILE}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, PILOT_FILE);
}

// 상품 평가 데이터 로드 (로컬은 JSON, 운영은 Supabase products + product_evidence)
export async function getFormalityData(): Promise<FormalityData> {
  const catalog = await getCatalog();
  if (dataSource() === 'local') {
    return readLocalPilot(catalog.products);
  }
  const db = await createClient();
  const { rows, error } = await readPages((from, to) => db
    .from('product_evidence')
    .select('product_no, description, factors, reviewed, rarity_score, reviewed_by, reviewed_at, updated_at')
    .order('product_no').range(from, to), 20000, true);
  if (error) fail('상품 근거 조회 (DB 변경 적용 여부도 확인해 주세요)', error);
  const items: Record<string, FormalityEvidenceItem> = {};
  for (const row of rows) {
    const no = row.product_no as number;
    items[String(no)] = {
      productNo: no,
      description: (row.description as string) ?? '',
      factors: (row.factors as IntakeFactors) ?? {},
      reviewed: Boolean(row.reviewed),
      rarity: row.rarity_score !== null ? Number(row.rarity_score) : null,
      reviewedBy: (row.reviewed_by as string | null) ?? null,
      reviewedAt: (row.reviewed_at as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? undefined,
    };
  }
  return { products: catalog.products, items };
}

export async function saveLocalFormalityProducts(products: Cafe24Product[]): Promise<void> {
  if (dataSource() !== 'local') throw new Error('로컬 상품 시험에서만 사용할 수 있습니다.');
  const pilot = readLocalPilot((await getCatalog()).products);
  validateProductSnapshot(products, pilot.products);
  writeLocalPilot({ ...pilot, products });
}

// 상품 근거(희소 속성·설명·검수 상태) 단건 저장
export async function saveFormalityEvidenceItem(item: FormalityEvidenceItem): Promise<void> {
  if (dataSource() === 'local') {
    const catalog = await getCatalog();
    const pilot = readLocalPilot(catalog.products);
    pilot.items[String(item.productNo)] = item;
    writeLocalPilot(pilot);
    return;
  }
  const db = await createClient();
  const email = (await db.auth.getClaims()).data?.claims?.email as string | undefined;
  const row = {
    product_no: item.productNo,
    description: item.description,
    factors: item.factors,
    reviewed: item.reviewed,
    rarity_score: item.rarity,
    reviewed_by: item.reviewed ? (email ?? 'admin') : null,
    reviewed_at: item.reviewed ? (item.reviewedAt || new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('product_evidence').upsert(row);
  if (error) fail('상품 근거 저장', error);
}

// v2 검증실(lab)에서 사용할 검수 근거 목록 변환
export async function getFormalityEvidenceList(): Promise<ProductEvidence[]> {
  const data = await getFormalityData();
  return Object.entries(data.items).map(([no, item]) => evidenceFromIntake(Number(no), item.factors, item.reviewed));
}
