import type { Cafe24Product, Catalog, EngineConfig, ProductAttributes } from '../src/engine/types.ts';

export const testConfig: EngineConfig = {
  modelVersion: 'test',
  indicators: [
    { id: 'rarity', name: '희소성', description: '', max: 10, mode: 'higher', reasonPhrase: '귀한 상품' },
    { id: 'formality', name: '격식 적합도', description: '', max: 10, mode: 'target', reasonPhrase: '격식에 맞는 상품' },
  ],
  events: {
    funeral: { name: '장례', formalityTarget: 7, weights: { rarity: 1, formality: 3 } },
    wedding: { name: '결혼', formalityTarget: 7, weights: { rarity: 1, formality: 2 } },
    longevity: { name: '회갑/칠순', formalityTarget: 8, weights: { rarity: 1, formality: 2 } },
    birth: { name: '출산', formalityTarget: 5, weights: { rarity: 1, formality: 1 } },
    promotion: { name: '승진/이직', formalityTarget: 8, weights: { rarity: 2, formality: 2 } },
    opening: { name: '신축/개업', formalityTarget: 6, weights: { rarity: 1, formality: 1 } },
    thanks: { name: '감사선물', formalityTarget: 6, weights: { rarity: 1, formality: 1 } },
    birthday: { name: '생일', formalityTarget: 4, weights: { rarity: 2, formality: 1 } },
  },
  relations: {
    senior: { name: '상급자/어르신', formalityShift: 1.5, multipliers: { rarity: 1, formality: 1.5 } },
    business: { name: '거래처/공식', formalityShift: 1, multipliers: { rarity: 1, formality: 1 } },
    peer: { name: '동료/친구', formalityShift: -1, multipliers: { rarity: 1, formality: 1 } },
    family: { name: '가족/친밀', formalityShift: -1.5, multipliers: { rarity: 1, formality: 1 } },
  },
  targetSlope: 1.5,
  bonus: { eventFit: 8, eventMiss: -12, relationFit: 4, meaning: 6, depopulation: 3 },
  depopulationAreas: ['영광'],
  tiers: [
    { minFormality: 8, label: '격을 갖춘 선택' },
    { minFormality: 6, label: '실속 있는 정성' },
    { minFormality: 0, label: '가벼운 안부의 예의' },
  ],
  diversity: { maxPerCategory: 1 },
  budgetRelaxRatio: 1.3,
  resultCount: 3,
};

export function product(productNo: number, price: number, extra: Partial<Cafe24Product> = {}): Cafe24Product {
  return {
    productNo,
    name: `상품${productNo}`,
    price,
    display: true,
    selling: true,
    soldOut: false,
    image: null,
    detailImage: null,
    url: `https://test.cafe24.com/product/detail.html?product_no=${productNo}`,
    ...extra,
  };
}

export function attrs(productNo: number, extra: Partial<ProductAttributes> = {}): ProductAttributes {
  return {
    productNo,
    region: '테스트',
    category: `카테고리${productNo}`,
    scores: { rarity: 5, formality: 7 },
    events: ['funeral', 'wedding', 'thanks'],
    relations: ['senior', 'business'],
    excludedEvents: [],
    meanings: {},
    tags: [],
    story: '',
    reviewed: true,
    ...extra,
  };
}

export function catalog(products: Cafe24Product[], attributes: ProductAttributes[], config = testConfig): Catalog {
  return { products, attributes, config };
}
