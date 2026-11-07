import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductSnapshot } from '../src/cafe24/sync-rules.ts';
import { buildSyncPreview, computeSnapshotHash, type MissingCandidate } from '../src/cafe24/sync-preview.ts';
import { createAdminSyncServices, type AdminSyncDependencies } from '../src/cafe24/sync-service.ts';
import type { Cafe24Product } from '../src/engine/types.ts';

function makeProduct(productNo: number, name = `상품 ${productNo}`, price = 10000): Cafe24Product {
  return {
    productNo,
    name,
    price,
    display: true,
    selling: true,
    soldOut: false,
    image: `https://example.com/img/${productNo}.jpg`,
    detailImage: `https://example.com/detail/${productNo}.jpg`,
    url: `https://example.com/product/detail.html?product_no=${productNo}`,
  };
}

test('1. validateProductSnapshot: 기본 20% 보호 유지 및 관리자 수동 allowBulkRemoval 분기 검증', () => {
  const current43 = Array.from({ length: 43 }, (_, i) => makeProduct(i + 1));
  const cafe24_29 = current43.slice(0, 29); // 14개 삭제 (32.6% 삭제)

  // 1-1. 빈 응답 거부
  assert.throws(() => validateProductSnapshot([]), /비었거나/);

  // 1-2. 중복 상품번호 거부
  assert.throws(() => validateProductSnapshot([cafe24_29[0], cafe24_29[0]]), /유효하지 않거나 중복/);

  // 1-3. 유효하지 않은 가격 또는 잘못된 url 거부
  assert.throws(() => validateProductSnapshot([{ ...cafe24_29[0], price: -100 }]), /유효하지 않거나 중복/);
  assert.throws(() => validateProductSnapshot([{ ...cafe24_29[0], url: 'http://insecure.com' }]), /유효하지 않거나 중복/);

  // 1-4. 기본 호출(오전 자동동기화 등): 20% 초과 삭제 거절 (43개 중 14개 누락 = 32.6% > 20%)
  assert.throws(
    () => validateProductSnapshot(cafe24_29, current43),
    /20% 넘게 사라진 응답이라 갱신을 중단했습니다/,
  );

  // 1-5. 관리자 수동 승인 호출(allowBulkRemoval: true): 20% 초과 삭제 허용
  assert.doesNotThrow(() => {
    validateProductSnapshot(cafe24_29, current43, { allowBulkRemoval: true });
  });

  // 1-6. allowBulkRemoval: true라도 빈 배열이나 잘못된 형식은 여전히 거부
  assert.throws(() => validateProductSnapshot([], current43, { allowBulkRemoval: true }), /비었거나/);
});

test('2. computeSnapshotHash: 순서 독립성 및 내용 변경 감지 검증', () => {
  const p1 = makeProduct(1, '도자기 세트', 30000);
  const p2 = makeProduct(2, '전통 한과', 25000);

  const hashA = computeSnapshotHash([p1, p2]);
  const hashB = computeSnapshotHash([p2, p1]); // 순서 변경

  assert.equal(hashA, hashB, '정렬 후 해시를 생성하므로 순서가 바뀌어도 동일해야 함');
  assert.equal(hashA.length, 64, 'SHA-256 64자리 16진수 문자열이어야 함');

  // 내용 변경 시 해시 변경
  const p2Modified = { ...p2, price: 28000 };
  const hashC = computeSnapshotHash([p1, p2Modified]);
  assert.notEqual(hashA, hashC, '가격 변경 시 해시가 달라져야 함');
});

test('3. buildSyncPreview: 43개 운영 상품 중 14개 누락(실제 29개) 시 후보 및 근거 보존 검증', () => {
  const current43 = Array.from({ length: 43 }, (_, i) => makeProduct(i + 1, `운영 상품 ${i + 1}`, 10000 * (i + 1)));
  const cafe24_29 = current43.slice(0, 29); // 30~43번 14개 누락 (32.6%)

  const evidenceMap = new Map<number, { reviewed: boolean; hasEvidence: boolean }>();
  // 30번은 검수 완료 근거가 있는 상품
  evidenceMap.set(30, { reviewed: true, hasEvidence: true });
  // 31번은 초안 근거가 있는 상품
  evidenceMap.set(31, { reviewed: false, hasEvidence: true });
  // 32번은 근거 없음

  const preview = buildSyncPreview(current43, cafe24_29, evidenceMap, '2026-11-01T00:00:00Z');

  assert.equal(preview.currentCount, 43);
  assert.equal(preview.newCount, 29);
  assert.equal(preview.missingCount, 14);
  assert.equal(preview.exceedsThreshold, true, '14/43 = 32.6%로 20% 초과 경고 활성화');
  assert.equal(preview.missingProducts.length, 14);

  // 30번 누락 후보 확인
  const cand30 = preview.missingProducts.find((p) => p.productNo === 30);
  assert.ok(cand30);
  assert.equal(cand30.hasEvidence, true);
  assert.equal(cand30.reviewed, true);

  // 31번 누락 후보 확인
  const cand31 = preview.missingProducts.find((p) => p.productNo === 31);
  assert.ok(cand31);
  assert.equal(cand31.hasEvidence, true);
  assert.equal(cand31.reviewed, false);

  // 32번 누락 후보 확인
  const cand32 = preview.missingProducts.find((p) => p.productNo === 32);
  assert.ok(cand32);
  assert.equal(cand32.hasEvidence, false);
});

test('4. createAdminSyncServices: 비인가 접근(권한 없음) 차단 검증', async () => {
  const services = createAdminSyncServices({
    requireAdmin: async () => {
      throw new Error('권한 없음');
    },
    getCafe24Config: () => ({ mallId: 'test', clientId: 'test' }),
    fetchAllProducts: async () => [makeProduct(1)],
    loadCurrentState: async () => ({ products: [makeProduct(1)], syncedAt: null, evidenceMap: new Map() }),
    saveProducts: async () => ({ count: 1 }),
  });

  const previewRes = await services.preview();
  assert.equal(previewRes.ok, false);
  if (!previewRes.ok) {
    assert.equal(previewRes.error.code, 'unauthorized');
  }

  const applyRes = await services.apply({
    snapshotHash: 'some-hash',
    expectedSyncedAt: null,
    products: [makeProduct(1)],
  });
  assert.equal(applyRes.ok, false);
  if (!applyRes.ok) {
    assert.equal(applyRes.error.code, 'unauthorized');
  }
});

test('5. createAdminSyncServices: 빈 응답 및 잘못된 입력 방어 검증', async () => {
  const services = createAdminSyncServices({
    requireAdmin: async () => {},
    getCafe24Config: () => ({ mallId: 'test', clientId: 'test' }),
    fetchAllProducts: async () => [], // 카페24가 빈 목록 반환
    loadCurrentState: async () => ({ products: [makeProduct(1)], syncedAt: null, evidenceMap: new Map() }),
    saveProducts: async () => ({ count: 0 }),
  });

  const previewRes = await services.preview();
  assert.equal(previewRes.ok, false);
  if (!previewRes.ok) {
    assert.equal(previewRes.error.code, 'unavailable');
    assert.match(previewRes.error.message, /비어 있거나/);
  }
});

test('6. createAdminSyncServices: 검토 이후 카페24 목록 변화(Drift) 방어 검증', async () => {
  const p1 = makeProduct(1, '상품 1', 10000);
  const p2 = makeProduct(2, '상품 2', 20000);
  let cafe24Products = [p1, p2];

  const services = createAdminSyncServices({
    requireAdmin: async () => {},
    getCafe24Config: () => ({ mallId: 'test', clientId: 'test' }),
    fetchAllProducts: async () => cafe24Products,
    loadCurrentState: async () => ({ products: [p1, p2, makeProduct(3)], syncedAt: 'v1', evidenceMap: new Map() }),
    saveProducts: async () => ({ count: 2 }),
  });

  // 1. 관리자가 미리보기를 조회
  const previewRes = await services.preview();
  assert.equal(previewRes.ok, true);
  if (!previewRes.ok) return;

  const snapshotHash = previewRes.data.snapshotHash;
  const productsToApply = previewRes.data.products;

  // 2. 검토 도중 카페24 쇼핑몰에서 상품 2의 가격이 변경됨
  cafe24Products = [p1, { ...p2, price: 25000 }];

  // 3. 관리자가 미리보기 당시의 스냅샷으로 적용 시도
  const applyRes = await services.apply({
    snapshotHash,
    expectedSyncedAt: 'v1',
    products: productsToApply,
  });

  // 4. 카페24 목록 변경을 감지하고 revision_conflict로 안전하게 거절해야 함
  assert.equal(applyRes.ok, false);
  if (!applyRes.ok) {
    assert.equal(applyRes.error.code, 'revision_conflict');
    assert.match(applyRes.error.message, /검토 이후 카페24 상품 목록이 변경/);
  }
});

test('7. createAdminSyncServices: 동시 수정(DB synced_at 버전 불일치) 방어 검증', async () => {
  const p1 = makeProduct(1, '상품 1', 10000);

  const services = createAdminSyncServices({
    requireAdmin: async () => {},
    getCafe24Config: () => ({ mallId: 'test', clientId: 'test' }),
    fetchAllProducts: async () => [p1],
    loadCurrentState: async () => ({ products: [p1], syncedAt: 'v1', evidenceMap: new Map() }),
    saveProducts: async (_mallId, _products, expectedSyncedAt) => {
      if (expectedSyncedAt !== 'v2') {
        throw new Error('다른 작업에서 상품이 갱신됐습니다. 최신 상태를 다시 확인해 주세요.');
      }
      return { count: 1 };
    },
  });

  const hash = computeSnapshotHash([p1]);
  const applyRes = await services.apply({
    snapshotHash: hash,
    expectedSyncedAt: 'v1', // DB는 이미 v2로 변경된 상태
    products: [p1],
  });

  assert.equal(applyRes.ok, false);
  if (!applyRes.ok) {
    assert.equal(applyRes.error.code, 'revision_conflict');
    assert.match(applyRes.error.message, /다른 작업/);
  }
});

test('8. createAdminSyncServices: 43개 -> 29개 수동 동기화 성공 및 검수 근거 보존 흐름 검증', async () => {
  const current43 = Array.from({ length: 43 }, (_, i) => makeProduct(i + 1, `상품 ${i + 1}`, 10000));
  const cafe24_29 = current43.slice(0, 29); // 30~43번 14개 누락

  // 30번에 검수 완료 근거가 존재
  const evidenceStore = new Map<number, { reviewed: boolean; factors: any; description: string }>([
    [30, { reviewed: true, factors: { skill: { score: 8, basis: '장인의 3대 전통' } }, description: '장인의 3대 전통 도자기' }],
  ]);

  let savedCatalog: Cafe24Product[] = [...current43];
  let savedSyncedAt: string | null = '2026-11-01T00:00:00Z';

  const services = createAdminSyncServices({
    requireAdmin: async () => {},
    getCafe24Config: () => ({ mallId: 'test-mall', clientId: 'test-client' }),
    fetchAllProducts: async () => cafe24_29,
    loadCurrentState: async () => {
      const evidenceMap = new Map<number, { reviewed: boolean; hasEvidence: boolean }>();
      for (const [no, item] of evidenceStore.entries()) {
        evidenceMap.set(no, { reviewed: item.reviewed, hasEvidence: true });
      }
      return {
        products: savedCatalog,
        syncedAt: savedSyncedAt,
        evidenceMap,
      };
    },
    saveProducts: async (mallId, products, expectedSyncedAt, previewToken) => {
      validateProductSnapshot(products, savedCatalog, { allowBulkRemoval: true });
      if (savedSyncedAt !== expectedSyncedAt) {
        throw new Error('다른 작업에서 상품이 갱신됐습니다.');
      }
      savedCatalog = [...products];
      savedSyncedAt = '2026-11-07T12:00:00Z';
      return { count: products.length };
    },
  });

  // 1. 미리보기 조회
  const previewRes = await services.preview();
  assert.equal(previewRes.ok, true);
  if (!previewRes.ok) return;

  assert.equal(previewRes.data.currentCount, 43);
  assert.equal(previewRes.data.newCount, 29);
  assert.equal(previewRes.data.missingCount, 14);
  assert.equal(previewRes.data.exceedsThreshold, true);

  // 30번 상품이 쇼핑몰 미확인 목록에 포함되고 근거 보존 상태인지 확인
  const cand30 = previewRes.data.missingProducts.find((p) => p.productNo === 30);
  assert.ok(cand30);
  assert.equal(cand30.hasEvidence, true);
  assert.equal(cand30.reviewed, true);

  // 2. 관리자가 명시적으로 동기화 적용
  const applyRes = await services.apply({
    snapshotHash: previewRes.data.snapshotHash,
    expectedSyncedAt: previewRes.data.expectedSyncedAt,
    products: previewRes.data.products,
  });

  assert.equal(applyRes.ok, true);
  if (!applyRes.ok) return;
  assert.equal(applyRes.data.count, 29);

  // 3. 상품 목록이 29개로 정상 반영됨 확인
  assert.equal(savedCatalog.length, 29);
  assert.equal(savedCatalog.some((p) => p.productNo === 30), false);

  // 4. 검수 근거 저장소 확인: 쇼핑몰에서 상품이 빠졌어도 30번 상품의 검수 근거는 절대 지워지지 않고 온전히 보존됨!
  const ev30 = evidenceStore.get(30);
  assert.ok(ev30, '30번 상품의 검수 근거가 보존되어야 함');
  assert.equal(ev30.reviewed, true);
  assert.equal(ev30.description, '장인의 3대 전통 도자기');
});

test('9. 미저장 초안 보호: 제외 대상 상품에 미저장 편집이 있으면 적용 차단 및 안전 전환 검증', () => {
  // 관리자 워크벤치의 미저장 초안 방어 로직 검증
  const draftsByProduct = new Map<number, any>();
  let selectedNo = 30; // 현재 30번 상품 선택 중
  let dirty = true; // 30번 상품 편집 중 (미저장)

  draftsByProduct.set(30, { productNo: 30, description: '작성 중인 내용' });

  const missingProducts: MissingCandidate[] = [
    {
      productNo: 30,
      name: '도자기',
      price: 10000,
      display: false,
      selling: false,
      soldOut: false,
      imageUrl: null,
      productUrl: 'https://example.com/30',
      hasEvidence: true,
      reviewed: true,
    },
  ];

  const getDirtyProductNos = (): number[] => {
    const set = new Set<number>(draftsByProduct.keys());
    if (dirty) set.add(selectedNo);
    return Array.from(set);
  };

  const dirtyProductNos = getDirtyProductNos();
  const dirtyMissingNos = missingProducts
    .filter((p) => dirtyProductNos.includes(p.productNo))
    .map((p) => p.productNo);
  const hasUnsavedDraftInMissing = dirtyMissingNos.length > 0;

  // 9-1. 미저장 초안이 있는 30번이 제외 대상이므로 적용이 반드시 차단되어야 함
  assert.equal(hasUnsavedDraftInMissing, true);
  assert.deepEqual(dirtyMissingNos, [30]);

  // 9-2. 30번의 편집을 저장하거나 취소하여 미저장 상태가 해소된 경우
  draftsByProduct.delete(30);
  dirty = false;

  const resolvedDirtyNos = Array.from(draftsByProduct.keys());
  const resolvedMissingNos = missingProducts
    .filter((p) => resolvedDirtyNos.includes(p.productNo))
    .map((p) => p.productNo);
  assert.equal(resolvedMissingNos.length === 0, true, '미저장 상태가 없으면 차단 해제');

  // 9-3. 미저장 상태가 없는 30번이 목록에서 빠질 때 첫 상품(1번)으로 안전 전환
  const newProducts = [makeProduct(1), makeProduct(2)];
  const isSelectedKept = newProducts.some((p) => p.productNo === selectedNo);
  assert.equal(isSelectedKept, false);

  const nextSelectedNo = isSelectedKept ? selectedNo : (newProducts[0]?.productNo ?? 0);
  assert.equal(nextSelectedNo, 1, '제외된 상품에서 첫 상품(1번)으로 안전 전환');

  // 9-4. 만약 선택 상품이 2번(유지되는 상품)이고 초안이 있다면, 선택과 초안 모두 유지
  selectedNo = 2;
  draftsByProduct.set(2, { productNo: 2, description: '2번 초안' });
  const is2Kept = newProducts.some((p) => p.productNo === selectedNo);
  assert.equal(is2Kept, true);
  assert.ok(draftsByProduct.has(2), '남아있는 상품의 초안은 유지되어야 함');
});
