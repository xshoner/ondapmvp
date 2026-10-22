// DB 검증: supabase/migrations를 차례로 실행하고 보안 규칙(RLS)·함수·트리거를 실제로 시험한다. Supabase 계정 없이 PGlite(Postgres 17)로.
// 실행: npm run e2e:db   (처음 한 번 npm --prefix scripts/e2e ci)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 이 검사만 쓰는 도구(PGlite: 브라우저·Node에서 도는 Postgres, jsQR: QR 판독)는 scripts/e2e 안에 따로 설치한다
async function need(name) {
  try { return await import(name); } catch {
    console.error(`${name}이 없습니다. 한 번만: npm --prefix scripts/e2e ci`);
    process.exit(1);
  }
}

const { PGlite } = await need('@electric-sql/pglite');
const root = process.argv[2] ?? join(import.meta.dirname, '..', '..');
const db = new PGlite();
const ok = [];
const check = (name, cond, detail = '') => { ok.push(cond); console.log(`${cond ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const expectError = async (name, fn, pattern) => {
  try { await fn(); check(name, false, '오류가 나야 하는데 성공함'); } catch (e) { check(name, pattern.test(e.message), e.message); }
};

// Supabase가 미리 갖추고 있는 것만 흉내 낸다
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated;
`;
await db.exec(SUPABASE_STUB);

const files = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
  check(`마이그레이션 실행 ${f}`, true);
}
await db.exec(readFileSync(join(root, 'supabase/seed.sql'), 'utf8'));
check('seed.sql 실행', true);

const ADMIN = '11111111-1111-1111-1111-111111111111';
await db.exec(`insert into auth.users values ('${ADMIN}', 'admin@example.com'); insert into public.admins (user_id) values ('${ADMIN}');`);
const asAnon = async () => db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);`);
const asAdmin = async () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claims', '{"sub":"${ADMIN}","email":"admin@example.com","role":"authenticated"}', false);`);

// ---------- 접수와 상태 시각 ----------
await asAnon();
await db.exec(`insert into public.designs (code, product_no, product_name, quantity, style_name, sticker, print_path, status_changed_at)
  values ('OD-AAAA-AAAA', 27, '멸치', 30, '송학 장생', '{"shape":"circle","sizeCm":6}', 'OD-AAAA-AAAA.png', '2000-01-01')`);
await expectError('고객이 원본 연결(source_code)을 직접 넣을 수 없음', () => db.exec(`insert into public.designs (code, product_no, product_name, quantity, style_name, source_code)
  values ('OD-BBBB-BBBB', 27, '멸치', 1, '송학', 'OD-AAAA-AAAA')`), /row-level security/);
await asAdmin();
let [d] = await q(`select status_changed_at > now() - interval '1 minute' as fresh from public.designs where code = 'OD-AAAA-AAAA'`);
check('접수 시 상태 시각은 서버 시각 (보낸 값 무시)', d.fresh === true);
await db.exec(`update public.designs set status_changed_at = '2001-01-01' where code = 'OD-AAAA-AAAA'`);
[d] = await q(`select extract(year from status_changed_at) as y from public.designs where code = 'OD-AAAA-AAAA'`);
check('상태가 그대로면 시각을 바꿀 수 없음', Number(d.y) >= 2026, String(d.y));
await db.exec(`update public.designs set memo = '메모' where code = 'OD-AAAA-AAAA'`);
const [before] = await q(`select status_changed_at as t from public.designs where code = 'OD-AAAA-AAAA'`);
await new Promise((r) => setTimeout(r, 20));
await db.exec(`update public.designs set status = 'order_confirmed' where code = 'OD-AAAA-AAAA'`);
const [after] = await q(`select status_changed_at as t from public.designs where code = 'OD-AAAA-AAAA'`);
check('상태가 바뀌면 시각 갱신', after.t > before.t);

// ---------- 다시 주문 ----------
await asAnon();
const [r1] = await q(`select public.reorder_design(' od-aaaa-aaaa ', 'OD-CCCC-CCCC', 50) as code`);
check('다시 주문: 새 코드 반환', r1.code === 'OD-CCCC-CCCC');
const [r2] = await q(`select public.reorder_design('OD-CCCC-CCCC', 'OD-DDDD-DDDD', 5) as code`);
await asAdmin();
const rows = await q(`select code, quantity, status, print_path, source_code, sticker->>'sizeCm' as size, memo, order_no from public.designs where code in ('OD-CCCC-CCCC','OD-DDDD-DDDD') order by code`);
check('다시 주문: 수량·상태·원본 인쇄 파일 연결', rows[0].quantity === 50 && rows[0].status === 'received' && rows[0].print_path === null && rows[0].source_code === 'OD-AAAA-AAAA' && rows[0].size === '6' && rows[0].memo === '' && rows[0].order_no === null, JSON.stringify(rows[0]));
check('다시 주문의 다시 주문도 처음 원본 파일을 가리킴', rows[1].source_code === 'OD-AAAA-AAAA' && r2.code === 'OD-DDDD-DDDD');
await asAnon();
await expectError('다시 주문: 이미 있는 코드는 중복 오류(23505)', () => q(`select public.reorder_design('OD-AAAA-AAAA', 'OD-CCCC-CCCC', 1)`), /duplicate key/);
await expectError('다시 주문: 수량 범위 검사', () => q(`select public.reorder_design('OD-AAAA-AAAA', 'OD-EEEE-EEEE', 0)`), /수량/);
await expectError('다시 주문: 코드 형식 검사', () => q(`select public.reorder_design('OD-AAAA-AAAA', 'od-0000-1111', 1)`), /새 코드/);
await asAdmin();
await db.exec(`update public.designs set status = 'canceled' where code = 'OD-DDDD-DDDD'`);
await asAnon();
await expectError('다시 주문: 취소된 접수는 안 됨', () => q(`select public.reorder_design('OD-DDDD-DDDD', 'OD-EEEE-EEEE', 1)`), /찾을 수 없/);
await expectError('고객은 접수 목록을 직접 못 읽음', async () => { const r = await q(`select * from public.designs`); if (r.length === 0) throw new Error('row-level security: 0행'); }, /0행|permission denied/);

// ---------- 고객 조회 ----------
const [lk] = await q(`select * from public.lookup_design('od-dddd-dddd')`);
check('조회: 취소 건도 상태로 알려 줌 + 상태 시각', lk?.status === 'canceled' && lk.status_changed_at instanceof Date, JSON.stringify(lk));
check('조회: 편집 내용·주문번호·메모는 안 돌려줌', lk && !('draft' in lk) && !('order_no' in lk) && !('memo' in lk));

// ---------- 지표 변경 이력 ----------
await asAdmin();
await db.exec(`insert into public.product_attributes (product_no, region, category, scores) values (999, '남해', '수산', '{"rarity":7}')`);
await db.exec(`update public.product_attributes set scores = '{"rarity":9}', updated_at = now() where product_no = 999`);
await db.exec(`update public.product_attributes set updated_at = now() where product_no = 999`); // 내용 같음
const hist = await q(`select op, changed_by_email, before->'scores'->>'rarity' as b, after->'scores'->>'rarity' as a, after ? 'updated_at' as has_ts from public.product_attributes_history where product_no = 999 order by id`);
check('이력: 추가·수정만 남고 내용 같은 저장은 안 남음', hist.length === 2 && hist[0].op === 'insert' && hist[1].op === 'update', JSON.stringify(hist));
check('이력: 바뀌기 전후 점수와 바꾼 사람 이메일', hist[1].b === '7' && hist[1].a === '9' && hist[1].changed_by_email === 'admin@example.com' && hist[1].has_ts === false);
await db.exec(`delete from public.product_attributes where product_no = 999`);
const [del] = await q(`select op, after from public.product_attributes_history where product_no = 999 order by id desc limit 1`);
check('이력: 삭제도 남음', del.op === 'delete' && del.after === null);
await asAnon();
const anonHist = await q(`select count(*)::int as n from public.product_attributes_history`).catch((e) => [{ n: e.message }]);
check('이력: 고객(anon)은 못 읽음', anonHist[0].n === 0 || /permission denied/.test(String(anonHist[0].n)), String(anonHist[0].n));
await expectError('이력: 고객이 직접 쓸 수 없음', () => db.exec(`insert into public.product_attributes_history (product_no, op) values (1, 'update')`), /permission denied|row-level security/);

// ---------- 20261026: 고객 의견 + 시각·이름 위조 방지 ----------
await asAnon();
await db.exec(`insert into public.designs (code, product_no, product_name, quantity, style_name, created_at, updated_at)
  values ('OD-FFFF-FFFF', 11, '가짜 이름', 3, '가짜 포장', '2099-01-01', '2099-01-01')`);
await asAdmin();
const [pin] = await q(`select created_at < now() + interval '1 minute' as c, updated_at < now() + interval '1 minute' as u, product_name from public.designs where code = 'OD-FFFF-FFFF'`);
check('접수: 시각은 DB가 찍음 (미래 시각 무시)', pin.c === true && pin.u === true, JSON.stringify(pin));
check('접수: 상품명은 DB 상품표 이름으로', pin.product_name === '고소하고 진한 풍미의 한우 차돌박이 양지', pin.product_name);
const [style] = await q(`select id, name from public.packaging_styles limit 1`);
if (style) {
  await asAnon();
  await db.exec(`insert into public.designs (code, product_no, product_name, quantity, style_id, style_name) values ('OD-GGGG-GGGG', 11, 'x', 1, '${style.id}', '위조')`);
  await asAdmin();
  const [g] = await q(`select style_name from public.designs where code = 'OD-GGGG-GGGG'`);
  check('접수: 포장 이름은 고른 스타일 이름으로', g.style_name === style.name, `${g.style_name} / ${style.name}`);
}
await asAnon();
await expectError('접수: 없는 상품 번호는 거절', () => db.exec(`insert into public.designs (code, product_no, product_name, quantity, style_name) values ('OD-HHHH-HHHH', 999999, 'x', 1, 'x')`), /없는 상품/);
const [ro] = await q(`select public.reorder_design('OD-FFFF-FFFF', 'OD-JJJJ-JJJJ', 7) as code`);
check('다시 주문은 보강 후에도 그대로 됨', ro.code === 'OD-JJJJ-JJJJ');

await db.exec(`insert into public.recommendation_logs (created_at, event, relation, result_product_nos) values ('2099-01-01', 'funeral', 'boss', '{11}')`);
await db.exec(`insert into public.recommendation_feedback (created_at, event, relation, budget_max, quantity, result_product_nos, helpful, reasons, model_version)
  values ('2099-01-01', 'funeral', 'boss', 50000, 10, '{11,12}', false, '{price,kind}', 'v1')`);
await expectError('의견: 정해진 이유만 받음', () => db.exec(`insert into public.recommendation_feedback (event, relation, result_product_nos, helpful, reasons) values ('funeral', 'boss', '{}', false, '{hack}')`), /check constraint/);
const anonFb = await q(`select count(*)::int as n from public.recommendation_feedback`).catch((e) => [{ n: e.message }]);
check('의견: 고객(anon)은 못 읽음', anonFb[0].n === 0 || /permission denied/.test(String(anonFb[0].n)), String(anonFb[0].n));
await asAdmin();
const [fb] = await q(`select created_at < now() + interval '1 minute' as c, reasons from public.recommendation_feedback`);
check('의견: 관리자는 읽음 + 시각은 DB가 찍음', fb.c === true && fb.reasons.join(',') === 'price,kind', JSON.stringify(fb));
const [lg] = await q(`select bool_and(created_at < now() + interval '1 minute') as c from public.recommendation_logs`);
check('추천 기록: 시각은 DB가 찍음', lg.c === true);


// supabase/setup.sql(새 프로젝트에 한 번에 붙여넣는 파일)도 빈 DB에서 그대로 도는지
const fresh = new PGlite();
await fresh.exec(SUPABASE_STUB);
await fresh.exec(readFileSync(join(root, 'supabase/setup.sql'), 'utf8'));
const [{ n }] = (await fresh.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public'`)).rows;
check('setup.sql 한 번에 실행', n >= 12, `public 표 ${n}개`);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과 (setup.sql 포함)`);
process.exitCode = ok.every(Boolean) ? 0 : 1;
