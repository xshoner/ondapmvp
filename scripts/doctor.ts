// 복제·이전 직후 설정 점검: Node, 패키지, .env.local, Supabase(표·함수), 카페24, AI 키, (선택) 배포 주소
// 사용법: npm run doctor                         → 로컬 설정 점검
//         npm run doctor -- https://새주소.vercel.app → 배포된 화면·도우미 스크립트·관리자 보호까지 점검
// 비밀값은 출력하지 않는다(있음/없음만). 실패가 하나라도 있으면 종료 코드 1.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/lib/env.ts';
import { projectRoot } from '../src/lib/paths.ts';
import { cafe24ConfigFromEnv, fetchAllProducts } from '../src/cafe24/client.ts';

let failed = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string, fix?: string) => {
  failed++;
  console.log(`  ✗ ${msg}${fix ? `\n      → ${fix}` : ''}`);
};
const skip = (msg: string) => console.log(`  - ${msg}`);
const section = (title: string) => console.log(`\n[${title}]`);

section('Node·패키지');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 24) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} (24 이상 필요: TypeScript를 그대로 실행)`, 'https://nodejs.org 에서 Node 24 LTS 설치');
if (existsSync(join(projectRoot, 'node_modules', 'next'))) ok('node_modules 설치됨');
else bad('node_modules 없음', 'npm ci');

section('.env.local');
let env: Record<string, string> = {};
if (existsSync(join(projectRoot, '.env.local'))) {
  env = loadEnv();
  ok('.env.local 있음');
} else {
  bad('.env.local 없음', 'cp .env.example .env.local 후 값 채우기 (docs/CLONE.md 2장)');
}
const has = (k: string) => Boolean(env[k]);
const mode = env.ONDAP_DATA_SOURCE || 'local';
if (mode === 'local' || mode === 'supabase') ok(`ONDAP_DATA_SOURCE=${mode}`);
else bad(`ONDAP_DATA_SOURCE=${mode} (local 또는 supabase)`);
// local 모드는 저장소의 data/로 돌아가므로 카페24 값이 없어도 된다 (상품 가져오기 때만 필요)
const cafe24Keys = ['CAFE24_MALL_ID', 'CAFE24_CLIENT_ID', 'CAFE24_FRONT_API_KEY'];
const required = mode === 'supabase' ? [...cafe24Keys, 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] : [];
const optional: Record<string, string> = { CAFE24_REDIRECT_URI: '카페24 앱 설치 주소 만들 때', ondap_ai: 'AI 점수 제안' };
if (mode === 'local') for (const k of cafe24Keys) optional[k] = 'local 모드는 없어도 됨, 상품 가져오기 때 필요';
for (const k of required) has(k) ? ok(`${k} 있음`) : bad(`${k} 비어 있음`);
for (const [k, why] of Object.entries(optional)) has(k) ? ok(`${k} 있음`) : skip(`${k} 없음 (선택: ${why})`);

section('Supabase');
if (!has('NEXT_PUBLIC_SUPABASE_URL') || !has('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')) {
  skip('주소·키가 없어 건너뜀 (local 모드면 정상)');
} else {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const SETUP = 'SQL Editor에서 supabase/setup.sql 실행 (docs/CLONE.md 3장)';
  try {
    for (const table of ['products', 'product_attributes', 'packaging_styles', 'design_images', 'design_texts']) {
      const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
      if (error) bad(`${table} 읽기 실패: ${error.message}`, SETUP);
      else if (!count && (table === 'products' || table === 'product_attributes')) bad(`${table} 0행`, 'seed가 빠졌다: setup.sql 마지막 seed 부분 실행, 또는 관리자 > 카페24 상품 다시 가져오기');
      else ok(`${table} ${count}행`);
    }
    const config = await db.from('engine_config').select('id').eq('id', 'active').maybeSingle();
    if (config.error || !config.data) bad(`엔진 설정(engine_config active) 없음${config.error ? `: ${config.error.message}` : ''}`, SETUP);
    else ok('엔진 설정 있음');
    const count = await db.rpc('monthly_recommendation_count');
    if (count.error) bad(`이용 실적 함수 없음: ${count.error.message}`, SETUP);
    else ok(`이용 실적 함수 동작 (이번 달 ${count.data}건)`);
    const lookup = await db.rpc('lookup_design', { p_code: 'OD-AAAA-AAAA' });
    if (lookup.error) bad(`디자인 코드 조회 함수 없음: ${lookup.error.message}`, SETUP);
    else ok('디자인 코드 조회 함수 동작');
    const logs = await db.from('recommendation_logs').select('id').limit(1);
    if (logs.error || !logs.data?.length) ok('추천 기록은 외부에서 읽을 수 없음 (RLS 정상)');
    else bad('추천 기록이 로그인 없이 읽힌다 (RLS 확인)');
  } catch (e) {
    bad(`접속 실패: ${(e as Error).message}`, 'NEXT_PUBLIC_SUPABASE_URL 확인');
  }
}

section('카페24');
if (!has('CAFE24_MALL_ID') || !has('CAFE24_CLIENT_ID')) {
  skip('쇼핑몰 ID·Client ID가 없어 건너뜀');
} else {
  try {
    const products = await fetchAllProducts(cafe24ConfigFromEnv(env));
    ok(`상품 조회 성공: ${env.CAFE24_MALL_ID} 상품 ${products.length}개`);
  } catch (e) {
    const msg = (e as Error).message;
    bad(msg, /Uninstalled|403/.test(msg) ? '앱이 쇼핑몰에 설치되지 않았다: node scripts/cafe24-install-url.mjs 주소를 운영자 계정으로 열어 동의' : 'Client ID·Front API Key·쇼핑몰 ID 확인');
  }
}

const origin = process.argv[2]?.replace(/\/+$/, '');
section('배포 주소');
if (!origin) {
  skip('주소를 주지 않아 건너뜀 (npm run doctor -- https://주소)');
} else {
  const check = async (path: string, test: (r: Response, body: string) => boolean, label: string, fix?: string) => {
    try {
      const r = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const body = r.status < 300 ? await r.text() : '';
      test(r, body) ? ok(`${label} (${r.status})`) : bad(`${label} 실패 (${r.status})`, fix);
    } catch (e) {
      bad(`${label} 실패: ${(e as Error).message}`, fix);
    }
  };
  const SSO = 'Vercel 배포 보호가 켜져 있으면 401: Settings > Deployment Protection 확인, 운영 도메인 주소로 점검';
  await check('/', (r, b) => r.status === 200 && b.includes('온답'), '고객 첫 화면', SSO);
  await check('/formality', (r) => r.status === 200, '격식지수 소개 화면');
  await check('/packaging/pick', (r, b) => r.status === 200 && b.includes('포장'), '포장만 꾸미기 화면', 'Supabase 포장 표(setup.sql) 확인');
  await check('/cafe24/ondap-helper.js', (r, b) => r.status === 200 && b.includes('ondap_code'), '카페24 도우미 스크립트');
  await check('/manifest.webmanifest', (r) => r.status === 200, '앱 정보(manifest)');
  await check('/admin', (r) => r.status >= 300 && r.status < 400, '관리자 화면은 로그인으로 넘어감', '관리자 보호 확인 (ONDAP_DATA_SOURCE=supabase인지)');
}

console.log(failed ? `\n점검 실패 ${failed}건. 위 → 안내대로 고친 뒤 다시 실행하세요.` : '\n모두 통과.');
process.exit(failed ? 1 : 0);
