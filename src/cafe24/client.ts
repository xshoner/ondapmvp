// 카페24 Front API 상품 조회 클라이언트
// 앱이 쇼핑몰에 설치(운영자 동의)돼 있어야 동작한다. 미설치 시 403 Uninstalled app.

import type { Cafe24Product } from '../engine/types.ts';
import { validateProductSnapshot } from './sync-rules.ts';

export interface Cafe24Config {
  mallId: string;
  clientId: string;
  frontApiKey?: string;
  apiVersion?: string;
}

interface RawProduct {
  product_no: number;
  product_name: string;
  price: string;
  display: 'T' | 'F';
  selling: 'T' | 'F';
  sold_out?: 'T' | 'F';
  list_image?: string | null;
  detail_image?: string | null;
}

function cleanEnvValue(v?: string | null): string {
  if (!v) return '';
  return v.trim().replace(/^["']|["']$/g, '').trim();
}

export function cafe24ConfigFromEnv(env: Record<string, string>): Cafe24Config {
  const mallId = cleanEnvValue(env.CAFE24_MALL_ID);
  const clientId = cleanEnvValue(env.CAFE24_CLIENT_ID);
  if (!mallId || !clientId) throw new Error('.env.local에 CAFE24_MALL_ID와 CAFE24_CLIENT_ID가 필요합니다.');
  return {
    mallId,
    clientId,
    frontApiKey: cleanEnvValue(env.CAFE24_FRONT_API_KEY) || undefined,
    apiVersion: cleanEnvValue(env.CAFE24_API_VERSION) || undefined,
  };
}

function headers(config: Cafe24Config): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiVersion) h['X-Cafe24-Api-Version'] = config.apiVersion;
  if (config.frontApiKey) h.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.frontApiKey}`).toString('base64')}`;
  else h['X-Cafe24-Client-Id'] = config.clientId;
  return h;
}

async function get<T>(config: Cafe24Config, path: string, deadline = Date.now() + 45000): Promise<T> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.mallId)) throw new Error('쇼핑몰 ID 형식이 올바르지 않습니다.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('상품 조회 시간이 초과됐습니다. 기존 목록을 유지합니다.');
    const url = `https://${config.mallId}.cafe24api.com/api/v2${path}`;
    let res = await fetch(url, { headers: headers(config), cache: 'no-store', signal: AbortSignal.timeout(Math.min(12000, remaining)) });
    // 일부 상점은 공개 상품 조회에 Client ID 방식만 허용한다.
    if (res.status === 401 && config.frontApiKey && Date.now() < deadline) {
      res = await fetch(url, { headers: headers({ ...config, frontApiKey: undefined }), cache: 'no-store', signal: AbortSignal.timeout(Math.min(12000, deadline - Date.now())) });
    }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`카페24 상품 조회에 실패했습니다 (${res.status}).`);
    const body = await res.json();
    if (!body || typeof body !== 'object' || body.error) throw new Error('카페24 상품 응답을 확인할 수 없습니다.');
    return body as T;
  }
  throw new Error('카페24 상품 조회를 다시 시도해 주세요.');
}

function normalize(p: RawProduct, mallId: string): Cafe24Product {
  if (!p || !['T', 'F'].includes(p.display) || !['T', 'F'].includes(p.selling) || (p.sold_out !== undefined && !['T', 'F'].includes(p.sold_out))) throw new Error('카페24 상품 상태 응답이 올바르지 않습니다.');
  return {
    productNo: p.product_no,
    name: p.product_name,
    price: Number(p.price),
    display: p.display === 'T',
    selling: p.selling === 'T',
    soldOut: p.sold_out === 'T',
    image: p.list_image ?? null,
    detailImage: p.detail_image ?? null,
    url: `https://${mallId}.cafe24.com/product/detail.html?product_no=${p.product_no}`,
  };
}

export async function fetchAllProducts(config: Cafe24Config, deadline = Date.now() + 45000): Promise<Cafe24Product[]> {
  const limit = 100;
  const startedAt = Date.now();
  const beforeCount = await get<{ count: number | null }>(config, '/products/count', deadline);
  if (beforeCount.count !== null && (!Number.isSafeInteger(beforeCount.count) || beforeCount.count < 1 || beforeCount.count > 5000)) throw new Error('쇼핑몰 상품 수를 확인할 수 없거나 5,000개를 넘어 갱신하지 않았습니다.');
  async function readProducts(): Promise<Cafe24Product[]> {
    const all: Cafe24Product[] = [];
    for (let offset = 0; ; offset += limit) {
      if (Date.now() - startedAt > 50000 || offset > 5000) throw new Error('상품 조회 제한을 넘겨 갱신하지 않았습니다.');
      const body = await get<{ products: RawProduct[] }>(config, `/products?limit=${limit}&offset=${offset}`, deadline);
      if (!Array.isArray(body.products) || body.products.length > limit) throw new Error('카페24 상품 페이지 응답이 올바르지 않습니다.');
      all.push(...body.products.map((p) => normalize(p, config.mallId)));
      if (all.length > 5000) throw new Error('상품 조회 제한을 넘겨 갱신하지 않았습니다.');
      if (body.products.length < limit) break;
    }
    validateProductSnapshot(all);
    return all.sort((a, b) => a.productNo - b.productNo);
  }
  const all = await readProducts();
  if (beforeCount.count === null) {
    const again = await readProducts();
    if (JSON.stringify(all) !== JSON.stringify(again)) throw new Error('상품 조회 중 목록이 바뀌어 갱신하지 않았습니다. 다시 시도해 주세요.');
  } else {
    const afterCount = await get<{ count: number | null }>(config, '/products/count', deadline);
    if (beforeCount.count !== afterCount.count || all.length !== afterCount.count) throw new Error('상품 조회 중 개수가 바뀌거나 일부 응답이 빠져 갱신하지 않았습니다. 다시 시도해 주세요.');
  }
  return all;
}

// 상세 설명은 목록 응답에 포함되지 않으므로 선택한 상품만 별도로 조회한다.
export async function fetchProductDescription(config: Cafe24Config, productNo: number): Promise<string> {
  if (!Number.isSafeInteger(productNo) || productNo <= 0) throw new Error('상품번호를 확인해 주세요.');
  const body = await get<{ product: { product_no: number; simple_description?: string; summary_description?: string; description?: string; origin_place_value?: string } }>(config, `/products/${productNo}`);
  const p = body.product;
  if (!p || p.product_no !== productNo) throw new Error('카페24 상품 상세를 확인할 수 없습니다.');
  const plain = (s: unknown) => typeof s === 'string' ? s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim() : '';
  return [p.origin_place_value && `원산지: ${plain(p.origin_place_value)}`, plain(p.summary_description), plain(p.simple_description), plain(p.description)].filter(Boolean).join('\n').slice(0, 12000);
}

export interface RawVariantOption {
  name: string;
  value: string;
}

export interface RawVariant {
  shop_no?: number;
  variant_code: string;
  options: RawVariantOption[];
  display: 'T' | 'F';
  selling: 'T' | 'F';
  display_order?: number;
  additional_amount: string;
  display_soldout?: 'T' | 'F';
  quantity?: number;
  safety_inventory?: number;
}

export type Cafe24VariantItem = RawVariant;

export const PACKAGING_OPTION_NAME_REGEX = /포장\s*디자인|포장디자인|포장\s*신청|포장\s*서비스|선물\s*포장|스티커\s*제작/i;
export const PACKAGING_NEGATIVE_VALUE_REGEX = /신청\s*하지\s*않|안\s*함|않\s*음|미\s*신청|없\s*음|불\s*필요|제\s*외|취\s*소|선택\s*안|선택\s*하지\s*않|미\s*선택|원치\s*않|원하지\s*않|기본\s*포장\s*없음/i;
export const PACKAGING_POSITIVE_VALUE_REGEX = /포장\s*신청|포장디자인\s*신청|신청|추가|선물\s*포장|포장\s*포함/i;

export interface PackagingOptionResolution {
  status: 'confirmed' | 'unconfirmed';
  productNo: number;
  unitPrice: number | null;
  optionName: string | null;
  optionValue: string | null;
  variantCode: string | null;
  reason:
    | 'confirmed'
    | 'no_option'
    | 'composite_ambiguous'
    | 'not_sellable'
    | 'invalid_amount'
    | 'duplicate_candidates'
    | 'api_error';
}

/**
 * 카페24 품목(variants) 목록을 분석하여 단일 포장 신청 옵션의 추가금액을 판별하는 순수 함수.
 * 단일 옵션에서 명확한 신청 추가금액만 확정하며, 복합 옵션이나 미판매 품목은 확인 불가로 안전하게 반환한다.
 */
export function resolvePackagingOptionFromVariants(
  productNo: number,
  variants: RawVariant[] | null | undefined,
): PackagingOptionResolution {
  if (!variants || !Array.isArray(variants) || variants.length === 0) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'no_option',
    };
  }

  // 1. 복합 옵션 검사: 품목의 옵션 종류가 2개 이상이면 포장 외 다른 선택(맛/사이즈 등)과 추가금액이 결합되어 있어 단일 포장비 확정 불가
  const hasMultipleOptionTypes = variants.some((v) => Array.isArray(v.options) && v.options.length > 1);
  if (hasMultipleOptionTypes) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'composite_ambiguous',
    };
  }

  // 2. 포장 디자인 옵션에 해당하는 품목 후보 탐색
  const candidates: { variant: RawVariant; optName: string; optValue: string }[] = [];

  for (const v of variants) {
    if (!v.options || !Array.isArray(v.options)) continue;
    for (const o of v.options) {
      if (!o || typeof o.name !== 'string' || typeof o.value !== 'string') continue;
      const nameMatch = PACKAGING_OPTION_NAME_REGEX.test(o.name);
      if (!nameMatch) continue;

      const fullText = `${o.name} ${o.value}`;
      if (PACKAGING_NEGATIVE_VALUE_REGEX.test(o.value) || PACKAGING_NEGATIVE_VALUE_REGEX.test(fullText)) {
        continue; // "신청하지 않음", "신청안함", "불필요", "미신청", "선택안함" 등 제외
      }

      const isPositive = PACKAGING_POSITIVE_VALUE_REGEX.test(o.value);
      if (isPositive) {
        candidates.push({ variant: v, optName: o.name, optValue: o.value });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'no_option',
    };
  }

  // 후보가 여러 개인 경우 단일 옵션으로 확정할 수 없음 (동일 가격이더라도 중복 후보이면 임의 선택 금지)
  if (candidates.length > 1) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'duplicate_candidates',
    };
  }

  const selected = candidates[0];
  const variant = selected.variant;

  // 진열, 판매, 품절, 재고 관리 상태 확인: 실제 구매 불가 상태이면 가격을 0원으로 간주하지 않고 확인 불가 처리
  const isInventoryManaged =
    (variant as unknown as { use_inventory?: string }).use_inventory === 'T' ||
    (variant as unknown as { inventory_control?: string }).inventory_control === 'T' ||
    (variant as unknown as { use_stock?: string }).use_stock === 'T';

  const isOutOfStock =
    isInventoryManaged &&
    typeof variant.quantity === 'number' &&
    variant.quantity <= (typeof variant.safety_inventory === 'number' ? variant.safety_inventory : 0);

  const isSoldOut =
    variant.display_soldout === 'T' ||
    (variant as unknown as { is_sold_out?: string }).is_sold_out === 'T' ||
    (variant as unknown as { sold_out?: boolean | string }).sold_out === true ||
    (variant as unknown as { sold_out?: boolean | string }).sold_out === 'T' ||
    isOutOfStock;

  if (variant.display !== 'T' || variant.selling !== 'T' || isSoldOut) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: selected.optName,
      optionValue: selected.optValue,
      variantCode: variant.variant_code,
      reason: 'not_sellable',
    };
  }

  // additional_amount 유효성 엄격 검증 (null, boolean, 빈 문자열, 비원화 소수점(예: 1.50) 거부)
  if (
    variant.additional_amount === null ||
    variant.additional_amount === undefined ||
    typeof variant.additional_amount === 'boolean'
  ) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: selected.optName,
      optionValue: selected.optValue,
      variantCode: variant.variant_code,
      reason: 'invalid_amount',
    };
  }

  const strAmount = String(variant.additional_amount).trim();
  if (strAmount === '') {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: selected.optName,
      optionValue: selected.optValue,
      variantCode: variant.variant_code,
      reason: 'invalid_amount',
    };
  }

  // 원화 정수 검증: 소수부 0 외의 소수(예: 1.50)는 원화 정수가 아니므로 무효 처리 (반올림 임의 확정 금지)
  if (!/^-?\d+(\.0+)?$/.test(strAmount)) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: selected.optName,
      optionValue: selected.optValue,
      variantCode: variant.variant_code,
      reason: 'invalid_amount',
    };
  }

  const intAmount = Number(strAmount.split('.')[0]);
  if (!Number.isSafeInteger(intAmount) || intAmount < 0) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: selected.optName,
      optionValue: selected.optValue,
      variantCode: variant.variant_code,
      reason: 'invalid_amount',
    };
  }

  return {
    status: 'confirmed',
    productNo,
    unitPrice: intAmount,
    optionName: selected.optName,
    optionValue: selected.optValue,
    variantCode: variant.variant_code,
    reason: 'confirmed',
  };
}

// 옵션 가격 메모리 캐시 (TTL 60초)
const optionPriceCache = new Map<number, { data: PackagingOptionResolution; expiresAt: number }>();

export function clearOptionPriceCache(): void {
  optionPriceCache.clear();
}

/**
 * 특정 상품의 포장 디자인 서비스 옵션 추가금액 조회
 */
export async function fetchPackagingOption(
  config: Cafe24Config,
  productNo: number,
  options?: { refresh?: boolean; deadline?: number },
): Promise<PackagingOptionResolution> {
  if (!Number.isSafeInteger(productNo) || productNo <= 0) {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'invalid_amount',
    };
  }

  const now = Date.now();
  if (!options?.refresh) {
    const cached = optionPriceCache.get(productNo);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  try {
    const body = await get<{ variants: RawVariant[] }>(config, `/products/${productNo}/variants`, options?.deadline ?? Date.now() + 8000);
    const result = resolvePackagingOptionFromVariants(productNo, body?.variants);
    optionPriceCache.set(productNo, { data: result, expiresAt: now + 60000 });
    return result;
  } catch (err) {
    console.warn(`[Cafe24] 상품 ${productNo} 포장 옵션 조회 실패:`, err instanceof Error ? err.message : err);
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'api_error',
    };
  }
}

/**
 * 환경변수로부터 Cafe24 설정을 읽어 상품의 포장 옵션 가격을 조회하는 도우미
 */
export async function getPackagingOptionPrice(
  productNo: number,
  options?: { refresh?: boolean; deadline?: number },
): Promise<PackagingOptionResolution> {
  try {
    const config = cafe24ConfigFromEnv(process.env as Record<string, string>);
    return await fetchPackagingOption(config, productNo, options);
  } catch {
    return {
      status: 'unconfirmed',
      productNo,
      unitPrice: null,
      optionName: null,
      optionValue: null,
      variantCode: null,
      reason: 'api_error',
    };
  }
}
