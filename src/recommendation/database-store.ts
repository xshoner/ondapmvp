import type { SupabaseClient } from '@supabase/supabase-js';
import { readPages } from '../data/db.ts';
import type { ProductAssessment, ProductSnapshot } from './contracts.ts';
import { parseProductAssessment, parseRecommendationPolicy } from './validation.ts';
import { assertReviewable, checkRevision, nextTimestamp, policyFromConfig, storedFactors, StoreError, type CoreData, type CoreStore } from './store.ts';

// 읽기는 서버 클라이언트, 쓰기는 로그인 사용자의 RLS 클라이언트로 분리한다.
export function createDatabaseCoreStore(reader: SupabaseClient, writer?: SupabaseClient): CoreStore {
  const columns = 'product_no,description,factors,reviewed,updated_at,reviewed_at';
  function rowAssessment(row: any): ProductAssessment {
    return parseProductAssessment({ productNo: row.product_no, description: row.description, factors: row.factors, reviewed: row.reviewed, updatedAt: row.updated_at, reviewedAt: row.reviewed_at });
  }
  async function configRow(db: SupabaseClient) {
    const r = await db.from('engine_config').select('config,updated_at').eq('id', 'active').single();
    if (r.error || !r.data) throw new StoreError('unavailable', '추천 기준을 읽지 못했습니다.');
    return r.data;
  }
  async function load(): Promise<CoreData> {
    const [p, a, config] = await Promise.all([
      readPages((from, to) => reader.from('products').select('product_no,name,price,display,selling,sold_out,image,detail_image,url').order('product_no').range(from, to), 5000, true),
      readPages((from, to) => reader.from('product_evidence').select(columns).order('product_no').range(from, to), 5000, true),
      configRow(reader),
    ]);
    if (p.error || a.error) throw new StoreError('unavailable', '상품 또는 평가 자료를 읽지 못했습니다.');
    const products: ProductSnapshot[] = p.rows.map((p: any) => ({ productNo: p.product_no, name: p.name, price: typeof p.price === 'number' || (typeof p.price === 'string' && p.price.trim()) ? Number(p.price) : NaN, display: p.display, selling: p.selling, soldOut: p.sold_out, imageUrl: p.detail_image ?? p.image ?? null, productUrl: p.url }));
    return { products, assessments: a.rows.map(rowAssessment), policy: { policy: policyFromConfig(config.config), updatedAt: config.updated_at } };
  }
  return {
    load,
    async saveAssessment(a, expected) {
      if (!writer) throw new StoreError('unauthorized', '관리자 권한이 필요합니다.');
      const data = await load();
      if (!data.products.some((p) => p.productNo === a.productNo)) throw new StoreError('not_found', '상품을 찾지 못했습니다.');
      const previous = data.assessments.find((p) => p.productNo === a.productNo);
      checkRevision(previous?.updatedAt ?? null, expected);
      assertReviewable(a, data.policy.policy);
      const now = nextTimestamp(expected);
      const row = { product_no: a.productNo, description: a.description, factors: storedFactors(a), reviewed: a.reviewed, updated_at: now, reviewed_at: a.reviewed ? now : previous?.reviewedAt ?? null, rarity_score: null };
      const query = expected === null ? writer.from('product_evidence').insert(row) : writer.from('product_evidence').update(row).eq('product_no', a.productNo).eq('updated_at', expected);
      const r = await query.select(columns).maybeSingle();
      if (r.error?.code === '23505' || (!r.error && !r.data)) throw new StoreError('revision_conflict', '다른 저장 내용이 있습니다. 입력을 보존하고 최신 자료를 확인해 주세요.');
      if (r.error || !r.data) throw new StoreError('save_failed', '평가를 저장하지 못했습니다.');
      return rowAssessment(r.data);
    },
    async savePolicy(policy, expected) {
      if (!writer) throw new StoreError('unauthorized', '관리자 권한이 필요합니다.');
      const current = await configRow(writer);
      checkRevision(current.updated_at, expected);
      const clean = parseRecommendationPolicy(policy);
      const now = nextTimestamp(expected);
      const r = await writer.from('engine_config').update({ config: { ...current.config, coreRecommendation: clean }, updated_at: now }).eq('id', 'active').eq('updated_at', expected).select('updated_at').maybeSingle();
      if (!r.error && !r.data) throw new StoreError('revision_conflict', '다른 기준 저장 내용이 있습니다. 최신 기준을 확인해 주세요.');
      if (r.error || !r.data) throw new StoreError('save_failed', '추천 기준을 저장하지 못했습니다.');
      return { policy: clean, updatedAt: r.data.updated_at };
    },
  };
}
