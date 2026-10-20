// 카페24 Front API 상품 조회 클라이언트
// 앱이 쇼핑몰에 설치(운영자 동의)돼 있어야 동작한다. 미설치 시 403 Uninstalled app.

import type { Cafe24Product } from '../engine/types.ts';

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

async function get<T>(config: Cafe24Config, path: string): Promise<T> {
  const res = await fetch(`https://${config.mallId}.cafe24api.com/api/v2${path}`, { headers: headers(config) });
  const body = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
  if (!res.ok) {
    const msg = body?.error ? `${body.error.code ?? res.status} ${body.error.message ?? ''}` : res.statusText;
    throw new Error(`카페24 API 오류 (${path}): ${msg}`);
  }
  return body as T;
}

function normalize(p: RawProduct, mallId: string): Cafe24Product {
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

export async function fetchProduct(config: Cafe24Config, productNo: number): Promise<Cafe24Product> {
  const body = await get<{ product: RawProduct }>(config, `/products/${productNo}`);
  return normalize(body.product, config.mallId);
}

export async function fetchAllProducts(config: Cafe24Config): Promise<Cafe24Product[]> {
  const limit = 100;
  const all: Cafe24Product[] = [];
  for (let offset = 0; ; offset += limit) {
    const body = await get<{ products: RawProduct[] }>(config, `/products?limit=${limit}&offset=${offset}`);
    all.push(...body.products.map((p) => normalize(p, config.mallId)));
    if (body.products.length < limit) break;
  }
  return all.sort((a, b) => a.productNo - b.productNo);
}
