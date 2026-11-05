import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PolicyDocument, ProductAssessment, ProductSnapshot, RecommendationPolicy } from './contracts.ts';
import { parseProductAssessment, parseRecommendationPolicy } from './validation.ts';
import { assertReviewable, checkRevision, excludedEvents, nextTimestamp, policyFromConfig, storedFactors, StoreError, type CoreData, type CoreStore } from './store.ts';

const missing = (e: unknown) => (e as { code?: string })?.code === 'ENOENT';
export function createLocalCoreStore(root: string): CoreStore {
  const pilotPath = join(root, 'formality-pilot.json');
  const configPath = join(root, 'config', 'engine.json');
  async function readJson(path: string, fallback?: unknown): Promise<any> {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (e) { if (missing(e) && fallback !== undefined) return fallback; throw e; }
  }
  async function locked<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(root, { recursive: true });
    // shortcut: 비정상 종료 후 남은 락은 자동 삭제하지 않는다. 활성 저장이 없는지 확인한 뒤 로컬에서 제거한다.
    const lockPath = join(root, '.core-store.lock');
    const deadline = Date.now() + 3000;
    let handle;
    while (!handle) {
      try { handle = await open(lockPath, 'wx'); }
      catch (e) {
        if ((e as { code?: string }).code !== 'EEXIST') throw e;
        if (Date.now() >= deadline) throw new StoreError('unavailable', '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try { return await fn(); } finally { await handle.close(); await unlink(lockPath); }
  }
  async function atomic(path: string, data: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n'); await rename(temp, path); }
    finally { await unlink(temp).catch((e) => { if (!missing(e)) throw e; }); }
  }
  async function load(): Promise<CoreData> {
    const [catalog, pilot, config, attributes] = await Promise.all([readJson(join(root, 'cafe24-products.json')), readJson(pilotPath, { items: {} }), readJson(configPath), readJson(join(root, 'product-attributes.json'), { products: [] })]);
    if (!Array.isArray(catalog.products) || !pilot.items || Array.isArray(pilot.items)) throw new StoreError('unavailable', '로컬 상품·평가 자료 형식을 확인해 주세요.');
    if (!Array.isArray(attributes.products)) throw new StoreError('unavailable', '상품 행사 제외 자료 형식을 확인해 주세요.');
    const excludedByProduct = new Map(attributes.products.map((a: any) => [a.productNo, excludedEvents(a.excludedEvents)]));
    const products: ProductSnapshot[] = catalog.products.map((p: any) => ({ productNo: p.productNo, name: p.name, price: p.price, display: p.display, selling: p.selling, soldOut: p.soldOut, imageUrl: p.detailImage ?? p.image ?? null, productUrl: p.url, excludedEvents: excludedByProduct.get(p.productNo) ?? [] }));
    const assessments = Object.entries(pilot.items).map(([no, item]) => parseProductAssessment({ ...(item as object), productNo: Number(no) }));
    return { products, assessments, policy: { policy: policyFromConfig(config), updatedAt: config.coreRecommendationUpdatedAt ?? null } };
  }
  return {
    load,
    saveAssessment(a, expected) { return locked(async () => {
      const data = await load();
      if (!data.products.some((p) => p.productNo === a.productNo)) throw new StoreError('not_found', '상품을 찾지 못했습니다.');
      const previous = data.assessments.find((p) => p.productNo === a.productNo);
      checkRevision(previous?.updatedAt ?? null, expected);
      assertReviewable(a, data.policy.policy);
      const factors = storedFactors(a);
      const now = nextTimestamp(previous?.updatedAt ?? null);
      const saved: ProductAssessment = { ...a, updatedAt: now, reviewedAt: a.reviewed ? now : previous?.reviewedAt ?? null };
      const catalog = await readJson(join(root, 'cafe24-products.json'));
      const pilot = await readJson(pilotPath, { products: catalog.products, items: {} });
      pilot.items[String(a.productNo)] = { ...pilot.items[String(a.productNo)], ...saved, factors, rarity: null };
      await atomic(pilotPath, pilot);
      return saved;
    }); },
    savePolicy(policy, expected) { return locked(async () => {
      const config = await readJson(configPath);
      checkRevision(config.coreRecommendationUpdatedAt ?? null, expected);
      const clean = parseRecommendationPolicy(policy);
      const now = nextTimestamp(config.coreRecommendationUpdatedAt ?? null);
      await atomic(configPath, { ...config, coreRecommendation: clean, coreRecommendationUpdatedAt: now });
      return { policy: clean, updatedAt: now } satisfies PolicyDocument;
    }); },
  };
}
