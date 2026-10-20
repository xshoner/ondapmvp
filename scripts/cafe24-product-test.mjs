// 카페24 Front API 상품 조회 연결 테스트
// 사용법:
//   node scripts/cafe24-product-test.mjs              → 상품 목록 5개 조회
//   node scripts/cafe24-product-test.mjs 12           → 상품번호 12 단건 조회
//
// 두 가지 인증 방식으로 각각 호출해 결과를 비교합니다.
//   1) Basic 인증 (client_id + front_api_key)  ← 권장 방식
//   2) Client ID 헤더만                         ← 키 없이 되는지 확인용
// 키 값은 화면에 출력하지 않습니다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const env = {};
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`환경 파일을 찾을 수 없습니다: ${file}`);
    process.exit(1);
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv(join(root, '.env.local'));
const mallId = env.CAFE24_MALL_ID;
const clientId = env.CAFE24_CLIENT_ID;
const frontKey = env.CAFE24_FRONT_API_KEY;
const apiVersion = env.CAFE24_API_VERSION;

if (!mallId || !clientId) {
  console.error('.env.local에 CAFE24_MALL_ID와 CAFE24_CLIENT_ID를 채워 주세요.');
  process.exit(1);
}

const productNo = process.argv[2];
const base = `https://${mallId}.cafe24api.com/api/v2`;
const url = productNo ? `${base}/products/${encodeURIComponent(productNo)}` : `${base}/products?limit=5`;

function baseHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (apiVersion) headers['X-Cafe24-Api-Version'] = apiVersion;
  return headers;
}

const modes = [];
if (frontKey) {
  modes.push({
    name: 'Basic 인증 (client_id + front_api_key)',
    headers: {
      ...baseHeaders(),
      Authorization: `Basic ${Buffer.from(`${clientId}:${frontKey}`).toString('base64')}`,
    },
  });
} else {
  console.log('※ CAFE24_FRONT_API_KEY가 비어 있어 Basic 인증 테스트는 건너뜁니다.\n');
}
modes.push({
  name: 'Client ID 헤더만',
  headers: { ...baseHeaders(), 'X-Cafe24-Client-Id': clientId },
});

function summarize(p) {
  return {
    상품번호: p.product_no,
    상품명: p.product_name,
    판매가: p.price,
    진열: p.display,
    판매: p.selling,
    목록이미지: p.list_image ?? p.small_image ?? p.tiny_image ?? null,
  };
}

console.log(`쇼핑몰: ${mallId}`);
console.log(`요청: GET ${url.replace(base, '/api/v2')}\n`);

for (const mode of modes) {
  console.log(`── ${mode.name}`);
  try {
    const res = await fetch(url, { headers: mode.headers });
    const limit = res.headers.get('x-api-call-limit');
    const body = await res.json().catch(() => null);
    console.log(`   상태: ${res.status} ${res.statusText}${limit ? ` (호출량 ${limit})` : ''}`);
    if (!res.ok) {
      const err = body?.error;
      console.log(`   오류: ${err ? `${err.code ?? ''} ${err.message ?? ''}`.trim() : JSON.stringify(body)}`);
    } else if (body?.product) {
      console.table([summarize(body.product)]);
    } else if (Array.isArray(body?.products)) {
      console.log(`   상품 ${body.products.length}개`);
      if (body.products.length) console.table(body.products.map(summarize));
    } else {
      console.log('   예상하지 못한 응답 형식:', Object.keys(body ?? {}));
    }
  } catch (e) {
    console.log(`   요청 실패: ${e.message}`);
  }
  console.log('');
}
