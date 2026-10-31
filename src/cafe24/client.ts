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

export function cafe24ConfigFromEnv(env: Record<string, string>): Cafe24Config {
  const { CAFE24_MALL_ID: mallId, CAFE24_CLIENT_ID: clientId } = env;
  if (!mallId || !clientId) throw new Error('.env.local에 CAFE24_MALL_ID와 CAFE24_CLIENT_ID가 필요합니다.');
  return {
    mallId,
    clientId,
    frontApiKey: env.CAFE24_FRONT_API_KEY || undefined,
    apiVersion: env.CAFE24_API_VERSION || undefined,
  };
}

function headers(config: Cafe24Config): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiVersion) h['X-Cafe24-Api-Version'] = config.apiVersion;
  if (config.frontApiKey) {
    h.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.frontApiKey}`).toString('base64')}`;
  } else {
    h['X-Cafe24-Client-Id'] = config.clientId;
  }
  return h;
}

async function get<T>(config: Cafe24Config, path: string, deadline = Date.now() + 45000): Promise<T> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.mallId)) throw new Error('쇼핑몰 ID 형식이 올바르지 않습니다.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('상품 조회 시간이 초과됐습니다. 기존 목록을 유지합니다.');
    const res = await fetch(`https://${config.mallId}.cafe24api.com/api/v2${path}`, { headers: headers(config), cache: 'no-store', signal: AbortSignal.timeout(Math.min(12000, remaining)) });
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
