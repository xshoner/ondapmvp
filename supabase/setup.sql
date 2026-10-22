-- 온답 새 Supabase 프로젝트 한 번에 만들기 (npm run db:setup-sql로 생성, 직접 고치지 말 것)
-- 빈 프로젝트의 SQL Editor에 전체를 붙여넣고 Run. 이미 만든 프로젝트에 다시 실행하면 "already exists" 오류가 난다.
-- 포함: migrations/20261020000000_init.sql, migrations/20261021000000_packaging.sql, migrations/20261022000000_packaging_hardening.sql, migrations/20261023000000_design_lookup.sql, migrations/20261024000000_usage_count.sql, migrations/20261025000000_operations.sql, seed.sql

-- ==================== migrations/20261020000000_init.sql ====================
-- 온답 추천 엔진 초기 스키마
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만)
--
-- 권한 원칙
--   상품·지표·설정    : 누구나 읽기, 관리자만 쓰기 (고객 화면이 추천 계산에 사용)
--   기대 정답         : 관리자만 읽기·쓰기
--   추천 기록         : 누구나 추가(고객 화면), 관리자만 읽기
--   관리자 목록       : 본인 행만 읽기, 추가는 SQL Editor에서만

-- ---------- 관리자 판별 함수 (외부 API에 노출되지 않는 private 스키마) ----------
create schema if not exists private;

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

grant usage on schema private to anon, authenticated;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

-- ---------- 카페24 상품 (원본은 카페24, 여기는 동기화 사본) ----------
create table public.products (
  product_no integer primary key check (product_no > 0),
  name text not null,
  price integer not null check (price >= 0),
  display boolean not null default true,
  selling boolean not null default true,
  sold_out boolean not null default false,
  image text,
  detail_image text,
  url text not null,
  synced_at timestamptz not null default now()
);

-- ---------- 상품별 격식지수 지표 (온답 관리자 입력) ----------
create table public.product_attributes (
  product_no integer primary key check (product_no > 0),
  region text not null default '국내',
  category text not null default '',
  scores jsonb not null default '{}'::jsonb,
  events text[] not null default '{}',
  relations text[] not null default '{}',
  excluded_events jsonb not null default '[]'::jsonb,
  meanings jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  story text not null default '',
  reviewed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------- 엔진 설정 (지표 정의, 가중치, 보너스). 한 행만 둔다 ----------
create table public.engine_config (
  id text primary key default 'active' check (id = 'active'),
  config jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------- 검증용 기대 정답 ("행사:관계" → 1위여야 할 상품) ----------
create table public.scenario_expectations (
  scenario_key text primary key check (scenario_key ~ '^[a-z]+:[a-z]+$'),
  product_no integer not null check (product_no > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------- 추천 사용 기록 (결과보고 실적, 개선용) ----------
create table public.recommendation_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (char_length(event) <= 20),
  relation text not null check (char_length(relation) <= 20),
  budget_max integer check (budget_max between 0 and 100000000),
  quantity integer check (quantity between 1 and 100000),
  result_product_nos integer[] not null check (cardinality(result_product_nos) <= 10),
  model_version text check (char_length(model_version) <= 20)
);
create index recommendation_logs_created_at_idx on public.recommendation_logs (created_at desc);

-- ---------- RLS ----------
alter table public.admins enable row level security;
alter table public.products enable row level security;
alter table public.product_attributes enable row level security;
alter table public.engine_config enable row level security;
alter table public.scenario_expectations enable row level security;
alter table public.recommendation_logs enable row level security;

create policy "본인 관리자 여부 확인" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

create policy "누구나 상품 읽기" on public.products
  for select to anon, authenticated using (true);
create policy "관리자 상품 추가" on public.products
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 상품 수정" on public.products
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 상품 삭제" on public.products
  for delete to authenticated using ((select private.is_admin()));

create policy "누구나 지표 읽기" on public.product_attributes
  for select to anon, authenticated using (true);
create policy "관리자 지표 추가" on public.product_attributes
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 지표 수정" on public.product_attributes
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 지표 삭제" on public.product_attributes
  for delete to authenticated using ((select private.is_admin()));

create policy "누구나 설정 읽기" on public.engine_config
  for select to anon, authenticated using (true);
create policy "관리자 설정 추가" on public.engine_config
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 설정 수정" on public.engine_config
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "관리자 기대 정답 읽기" on public.scenario_expectations
  for select to authenticated using ((select private.is_admin()));
create policy "관리자 기대 정답 추가" on public.scenario_expectations
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 기대 정답 수정" on public.scenario_expectations
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 기대 정답 삭제" on public.scenario_expectations
  for delete to authenticated using ((select private.is_admin()));

create policy "누구나 추천 기록 추가" on public.recommendation_logs
  for insert to anon, authenticated with check (true);
create policy "관리자 추천 기록 읽기" on public.recommendation_logs
  for select to authenticated using ((select private.is_admin()));

-- ---------- Data API 권한 (RLS가 행 단위로 다시 거른다) ----------
grant select on public.products, public.product_attributes, public.engine_config to anon, authenticated;
grant insert, update, delete on public.products, public.product_attributes to authenticated;
grant insert, update on public.engine_config to authenticated;
grant select, insert, update, delete on public.scenario_expectations to authenticated;
grant insert on public.recommendation_logs to anon, authenticated;
grant select on public.recommendation_logs to authenticated;
grant select on public.admins to authenticated;

-- ==================== migrations/20261021000000_packaging.sql ====================
-- 온답 포장 디자인 (실물 포장 스타일 선택 + 무료 스티커 편집)
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만). 20261020000000_init.sql을 먼저 실행한 상태여야 한다.
--
-- 권한 원칙
--   포장 스타일·추천 이미지·추천 문구 : 누구나 '사용' 중인 것만 읽기, 관리자는 전부 읽기·쓰기
--   디자인 접수                       : 누구나 추가(고객 저장), 관리자만 읽기·수정
--   저장소 packaging-assets(공개)     : 관리자만 올리기·지우기 (스타일·추천 이미지 파일)
--   저장소 design-files(비공개)       : 누구나 올리기(인쇄 파일 PNG), 관리자만 내려받기

-- ---------- 포장 스타일 (실물 포장지·보자기 등, 고객이 고르기만 한다) ----------
create table public.packaging_styles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '' check (char_length(description) <= 200),
  image_url text not null check (char_length(image_url) <= 500),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 스티커 추천 이미지 (행사 분류별) ----------
create table public.design_images (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('funeral','wedding','longevity','birth','promotion','opening','thanks','birthday','common')),
  name text not null default '' check (char_length(name) <= 40),
  image_url text not null check (char_length(image_url) <= 500),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 스티커 추천 문구 ({받는분} {보내는분} {날짜} 자리표시자 사용 가능) ----------
create table public.design_texts (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('funeral','wedding','longevity','birth','promotion','opening','thanks','birthday','common')),
  text text not null check (char_length(text) between 1 and 200),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 디자인 접수 (고객이 저장하면 코드 발급, 카페24 주문서 추가항목에 코드를 적는다) ----------
create table public.designs (
  code text primary key check (code ~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  created_at timestamptz not null default now(),
  product_no integer not null check (product_no > 0),
  product_name text not null check (char_length(product_name) <= 200),
  quantity integer not null check (quantity between 1 and 100000),
  event text check (char_length(event) <= 20),
  style_id uuid references public.packaging_styles (id) on delete set null,
  style_name text not null check (char_length(style_name) <= 40),
  sticker jsonb,
  draft jsonb check (pg_column_size(draft) < 65536),
  print_path text check (char_length(print_path) <= 100),
  status text not null default 'received' check (status in ('received','order_confirmed','printed','canceled')),
  order_no text check (char_length(order_no) <= 40),
  memo text not null default '' check (char_length(memo) <= 500),
  updated_at timestamptz not null default now()
);
create index designs_created_at_idx on public.designs (created_at desc);

-- ---------- RLS ----------
alter table public.packaging_styles enable row level security;
alter table public.design_images enable row level security;
alter table public.design_texts enable row level security;
alter table public.designs enable row level security;

create policy "누구나 사용 중인 스타일 읽기" on public.packaging_styles
  for select to anon, authenticated using (active or (select private.is_admin()));
create policy "관리자 스타일 추가" on public.packaging_styles
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 스타일 수정" on public.packaging_styles
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 스타일 삭제" on public.packaging_styles
  for delete to authenticated using ((select private.is_admin()));

create policy "누구나 사용 중인 추천 이미지 읽기" on public.design_images
  for select to anon, authenticated using (active or (select private.is_admin()));
create policy "관리자 추천 이미지 추가" on public.design_images
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 추천 이미지 수정" on public.design_images
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 추천 이미지 삭제" on public.design_images
  for delete to authenticated using ((select private.is_admin()));

create policy "누구나 사용 중인 추천 문구 읽기" on public.design_texts
  for select to anon, authenticated using (active or (select private.is_admin()));
create policy "관리자 추천 문구 추가" on public.design_texts
  for insert to authenticated with check ((select private.is_admin()));
create policy "관리자 추천 문구 수정" on public.design_texts
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 추천 문구 삭제" on public.design_texts
  for delete to authenticated using ((select private.is_admin()));

-- 고객은 접수 상태로만 추가할 수 있다 (주문번호·상태·메모는 관리자만)
create policy "누구나 디자인 접수" on public.designs
  for insert to anon, authenticated
  with check (status = 'received' and order_no is null and memo = '');
create policy "관리자 디자인 읽기" on public.designs
  for select to authenticated using ((select private.is_admin()));
create policy "관리자 디자인 수정" on public.designs
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "관리자 디자인 삭제" on public.designs
  for delete to authenticated using ((select private.is_admin()));

-- ---------- Data API 권한 (RLS가 행 단위로 다시 거른다) ----------
grant select on public.packaging_styles, public.design_images, public.design_texts to anon, authenticated;
grant insert, update, delete on public.packaging_styles, public.design_images, public.design_texts to authenticated;
grant insert on public.designs to anon, authenticated;
grant select, update, delete on public.designs to authenticated;

-- ---------- 파일 저장소 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('packaging-assets', 'packaging-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('design-files', 'design-files', false, 3145728, array['image/png'])
on conflict (id) do nothing;

create policy "관리자 포장 자산 올리기" on storage.objects
  for insert to authenticated with check (bucket_id = 'packaging-assets' and (select private.is_admin()));
create policy "관리자 포장 자산 지우기" on storage.objects
  for delete to authenticated using (bucket_id = 'packaging-assets' and (select private.is_admin()));
create policy "누구나 인쇄 파일 올리기" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'design-files' and name ~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\.png$');
create policy "관리자 인쇄 파일 내려받기" on storage.objects
  for select to authenticated using (bucket_id = 'design-files' and (select private.is_admin()));

-- ---------- 예시 데이터 (앱의 public/packaging/ 이미지를 쓴다. 관리자 화면에서 바꾸거나 끌 수 있다) ----------
insert into public.packaging_styles (name, description, image_url, sort) values
  ('송학 장생', '소나무와 학, 금박 구름 무늬. 회갑·칠순, 격식 있는 감사 자리에', '/packaging/styles/00001.webp', 1),
  ('모란 연분홍', '연분홍 모란과 벚꽃, 리본 장식. 결혼·출산·생일 같은 축하 자리에', '/packaging/styles/00002.webp', 2),
  ('매화 노리개', '붉은 매화와 노리개 술 장식. 명절 인사와 감사 답례에', '/packaging/styles/00003.webp', 3);

insert into public.design_images (category, name, image_url, sort) values
  ('longevity', '칠순 축하', '/packaging/stickers/012.webp', 1),
  ('wedding', '결혼기념일 축하', '/packaging/stickers/014.webp', 1),
  ('birthday', '생일 축하', '/packaging/stickers/017.webp', 1),
  ('thanks', '추석 인사', '/packaging/stickers/013.webp', 1),
  ('thanks', '설날 인사', '/packaging/stickers/018.webp', 2),
  ('common', '성탄 축하', '/packaging/stickers/011.webp', 1),
  ('common', '광복절 기념', '/packaging/stickers/015.webp', 2),
  ('common', '어린이날 축하', '/packaging/stickers/016.webp', 3);

insert into public.design_texts (category, text, sort) values
  ('funeral', E'보내주신 위로에\n깊이 감사드립니다', 1),
  ('funeral', E'삼가 감사의 마음을 전합니다\n{보내는분} 올림', 2),
  ('wedding', E'저희의 새 출발을\n축복해 주셔서 감사합니다', 1),
  ('wedding', E'{보내는분}\n{날짜} 결혼합니다', 2),
  ('longevity', E'함께해 주셔서 감사합니다\n{보내는분} 올림', 1),
  ('longevity', '늘 건강하시고 평안하세요', 2),
  ('birth', E'건강하게 태어났어요\n축하해 주셔서 고맙습니다', 1),
  ('birth', E'{보내는분}가\n첫 인사 드립니다', 2),
  ('promotion', E'보내주신 축하에 감사드립니다\n{보내는분} 드림', 1),
  ('opening', E'새로운 시작을 함께해 주셔서\n감사합니다', 1),
  ('opening', E'{보내는분}\n늘 정성을 다하겠습니다', 2),
  ('thanks', E'늘 감사합니다\n{보내는분} 드림', 1),
  ('thanks', '풍성하고 넉넉한 한가위 보내세요', 2),
  ('birthday', E'생일을 축하해 주셔서\n고맙습니다', 1),
  ('common', E'{받는분}님께\n감사의 마음을 담아', 1),
  ('common', '{보내는분} 드림', 2);

-- ==================== migrations/20261022000000_packaging_hardening.sql ====================
-- 포장 디자인 보강 (코드 검토 반영)
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만). 20261021000000_packaging.sql 다음에 실행.
--
-- 고객 저장은 로그인 없이 공개 키로 들어오므로, 누군가 서버를 거치지 않고 API로 직접 넣어도
-- 이상한 값이 들어가거나 접수가 폭주하지 않도록 DB에서 한 번 더 막는다.

-- 스티커 규격은 원형·사각 × 4·6cm만
alter table public.designs add constraint designs_sticker_spec check (
  sticker is null or (
    jsonb_typeof(sticker) = 'object'
    and sticker ->> 'shape' in ('circle', 'square')
    and sticker ->> 'sizeCm' in ('4', '6')
  )
);

-- 인쇄 파일 이름은 반드시 '코드.png'
alter table public.designs add constraint designs_print_path_matches_code check (print_path is null or print_path = code || '.png');

-- 접수 폭주 방지: 최근 10분 접수가 300건을 넘으면 새 접수를 거절 (평소 사용량의 수십 배)
create or replace function private.designs_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.designs where created_at > now() - interval '10 minutes') >= 300 then
    raise exception '디자인 접수가 너무 많습니다. 잠시 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.designs_throttle() from public;

create trigger designs_throttle
  before insert on public.designs
  for each row execute function private.designs_throttle();

-- ==================== migrations/20261023000000_design_lookup.sql ====================
-- 고객 '내 디자인 다시 보기': 디자인 코드로 접수 요약을 조회한다
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만)
--
-- designs 표는 관리자만 읽을 수 있으므로, 코드가 정확히 맞는 한 건의 요약만 돌려주는 함수를 따로 연다.
-- 코드는 32글자 × 8자리(약 1조 가지)라 추측으로 찾기 어렵고, 서버에서 조회 횟수도 제한한다.
-- 취소된 접수와 편집 내용(draft)·인쇄 파일 경로·주문번호·메모는 돌려주지 않는다.

create or replace function public.lookup_design(p_code text)
returns table (
  code text,
  created_at timestamptz,
  product_no integer,
  product_name text,
  quantity integer,
  style_name text,
  sticker jsonb,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.code, d.created_at, d.product_no, d.product_name, d.quantity, d.style_name, d.sticker, d.status
  from public.designs d
  where d.code = upper(trim(p_code)) and d.status <> 'canceled';
$$;

revoke all on function public.lookup_design(text) from public;
grant execute on function public.lookup_design(text) to anon, authenticated;

-- ==================== migrations/20261024000000_usage_count.sql ====================
-- 메인 화면 '이번 달 답례 추천 n건' 한 줄: 이번 달(한국 시간) 추천 기록 건수만 돌려준다
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만)
-- recommendation_logs는 관리자만 읽을 수 있으므로, 숫자 하나만 내주는 함수를 따로 연다(개별 기록은 노출하지 않음).

create or replace function public.monthly_recommendation_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.recommendation_logs
  where created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
$$;

revoke all on function public.monthly_recommendation_count() from public;
grant execute on function public.monthly_recommendation_count() to anon, authenticated;

-- ==================== migrations/20261025000000_operations.sql ====================
-- 운영 편의 기능: 디자인 상태가 바뀐 시각, 같은 디자인으로 다시 주문, 상품 지표 변경 이력, 고객 진행 상황 조회
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만). 앞의 마이그레이션을 모두 실행한 상태여야 한다.

-- ---------- 디자인 접수: 상태가 바뀐 시각 (늦어지는 건 강조, 고객 진행 상황) ----------
alter table public.designs add column status_changed_at timestamptz not null default now();
update public.designs set status_changed_at = case when status = 'received' then created_at else updated_at end;

-- 접수할 때와 상태가 바뀔 때만 시각을 찍는다 (클라이언트가 보낸 값은 무시)
create or replace function private.designs_status_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
  else
    new.status_changed_at := old.status_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function private.designs_status_changed() from public;

create trigger designs_status_changed
  before insert or update on public.designs
  for each row execute function private.designs_status_changed();

-- ---------- 같은 디자인으로 다시 주문: 새 코드로 접수하되 인쇄 파일은 원본 것을 쓴다 ----------
alter table public.designs add column source_code text references public.designs (code) on delete set null;
alter table public.designs add constraint designs_source_code_format
  check (source_code is null or source_code ~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$');
alter table public.designs add constraint designs_one_print_file check (print_path is null or source_code is null);

-- 고객이 직접 넣는 접수는 원본 연결 없이만 (다시 주문은 아래 함수로만)
drop policy "누구나 디자인 접수" on public.designs;
create policy "누구나 디자인 접수" on public.designs
  for insert to anon, authenticated
  with check (status = 'received' and order_no is null and memo = '' and source_code is null);

-- 코드가 맞는(취소 안 된) 접수를 수량만 바꿔 새 코드로 복사한다. 새 코드는 서버가 만들어 넘긴다(겹치면 23505 → 다시 시도)
create or replace function public.reorder_design(p_code text, p_new_code text, p_quantity integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.designs%rowtype;
begin
  if p_new_code is null or p_new_code !~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
    raise exception '잘못된 새 코드입니다.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception '수량은 1개부터 100,000개까지입니다.' using errcode = '22023';
  end if;
  select * into src from public.designs where code = upper(trim(p_code)) and status <> 'canceled';
  if not found then
    raise exception '디자인을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  insert into public.designs (code, product_no, product_name, quantity, event, style_id, style_name, sticker, draft, print_path, source_code)
  values (
    p_new_code, src.product_no, src.product_name, p_quantity, src.event, src.style_id, src.style_name, src.sticker, src.draft, null,
    case when src.print_path is not null then src.code else src.source_code end
  );
  return p_new_code;
end;
$$;

revoke all on function public.reorder_design(text, text, integer) from public;
grant execute on function public.reorder_design(text, text, integer) to anon, authenticated;

-- ---------- 고객 조회: 진행 단계와 그 시각, 취소 여부까지 (편집 내용·인쇄 파일·주문번호·메모는 여전히 주지 않는다) ----------
drop function public.lookup_design(text);
create function public.lookup_design(p_code text)
returns table (
  code text,
  created_at timestamptz,
  product_no integer,
  product_name text,
  quantity integer,
  style_name text,
  sticker jsonb,
  status text,
  status_changed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.code, d.created_at, d.product_no, d.product_name, d.quantity, d.style_name, d.sticker, d.status, d.status_changed_at
  from public.designs d
  where d.code = upper(trim(p_code));
$$;

revoke all on function public.lookup_design(text) from public;
grant execute on function public.lookup_design(text) to anon, authenticated;

-- ---------- 상품 지표 변경 이력 (누가 언제 무엇을 바꿨는지, 되돌리기용) ----------
create table public.product_attributes_history (
  id bigint generated always as identity primary key,
  product_no integer not null check (product_no > 0),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_email text check (char_length(changed_by_email) <= 320),
  op text not null check (op in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb
);
create index product_attributes_history_product_idx on public.product_attributes_history (product_no, changed_at desc);

-- 지표 표가 바뀌면 바뀌기 전·후를 남긴다. 내용이 같은 저장(시각만 바뀜)은 남기지 않는다
create or replace function private.product_attributes_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_at' - 'updated_by' end;
  a jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'updated_at' - 'updated_by' end;
begin
  if tg_op = 'UPDATE' and a = b then
    return null;
  end if;
  insert into public.product_attributes_history (product_no, changed_by, changed_by_email, op, before, after)
  values (
    coalesce((a ->> 'product_no')::integer, (b ->> 'product_no')::integer),
    (select auth.uid()),
    left((select auth.jwt()) ->> 'email', 320),
    lower(tg_op),
    b,
    a
  );
  return null;
end;
$$;

revoke all on function private.product_attributes_audit() from public;

create trigger product_attributes_audit
  after insert or update or delete on public.product_attributes
  for each row execute function private.product_attributes_audit();

alter table public.product_attributes_history enable row level security;
create policy "관리자 지표 이력 읽기" on public.product_attributes_history
  for select to authenticated using ((select private.is_admin()));
grant select on public.product_attributes_history to authenticated;

-- ==================== seed.sql ====================
-- 온답 초기 데이터 (npm run db:seed-sql로 생성). SQL Editor에서 Run
begin;

-- 카페24 상품
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (11, '고소하고 진한 풍미의 한우 차돌박이 양지', 76000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/2c70e43e823ec06c3b90c28798ee0c43.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/681d46d9ec2260b4939c4f624ee3ad3b.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=11') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (12, '최상급 1++ 한우 명품 등심 선물세트', 185000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/87ea516cdd3ada3b6889862f52b8d49a.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/d2990ae5f3c67ba082c7a45f3a24f0d0.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=12') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (13, '전통 명가 수제 양념 한우 갈비', 98000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/9f319bda230cd192f29785e8ad568b1a.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/7327d695bddc03fabf4c35e76f67558d.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=13') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (14, '지리산 청정 한우 부드러운 안심 스테이크용', 142000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/0bcc433f7cc6b74707b2b173cfe8b13c.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/4a7b70aef2df8dc10893360e6e0028c3.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=14') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (15, '국내산 무항생제 한돈 삼겹살 구이용', 32000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/3f15d2c486f4b9ffb53bb3f6ea1de18a.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/58b000759ba88fcd75920a6f9eb0894b.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=15') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (16, '육즙 가득한 프리미엄 한돈 목살', 29000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/ed7a50b90323349afa4191e0efd5faa1.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/ed43719849261b327a912f32ecfab0e5.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=16') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (17, '전통 방식으로 삶아낸 수제 족발과 보쌈 세트', 45000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/a5be4d72a7d3f39d3c3f8499ba25928a.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/f198c102b58755eb261f03c2056ba7db.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=17') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (18, '엄선된 1++ 한우 특수부위 모둠', 165000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/043d53451a72f5a2f2dc1ca60820bde5.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/881a8335e28c5f29f1120908e824c410.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=18') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (19, '제주 토종 흑돼지 등갈비 구이용', 38000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/74e553762db63badf622aac17f3f27c6.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/1000f8ac0592e0c79f6f790b9ed6a32d.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=19') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (20, '완도 청정 바다 활전복 선물용', 65000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/a7eaae97160e51115e936aaba218271d.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/9b57971f9fb4faf5b73d9c67eb01d7e5.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=20') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (21, '살이 오른 싱싱한 생물 고등어와 삼치 세트', 34000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/53818f73382c6442b5f4c81db44cba72.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/03a1bffb0227355dd044f33fc50af5b6.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=21') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (22, '자연방사 동물복지 신선한 유정란', 15000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/00b0b2d1f516290200a5e0523372d145.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/36c9c3b9cc2ee4fa23b9f38bc5386ca7.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=22') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (23, '임금님 진상 영광 법성포 굴비 세트', 120000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/a850b8b308a2ddc03339eca3744fd6fc.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/6adfba2d773321d7fb812fc89a7ab06b.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=23') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (24, '방목하여 키운 건강한 재래 토종닭', 27000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/afe9df459c13df65024ae852c2b45281.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/40960ee4eb7d3a8735adabc78ef7e388.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=24') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (25, '지리산 유황오리 로스 슬라이스', 35000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/8683cf160b41cd4abf302656ee55817b.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/c46e56f26d67dcceff91233921a4d6f7.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=25') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (26, '청정 제주 바다 은갈치 특대형', 89000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/97367c2936293024bd73dc750197cd61.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/1f73f3e3d8dc278f17c414a9bf0d2eb6.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=26') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (27, '남해안 전통 자연 건조 죽방멸치', 42000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/a247e802f90396292b02b12a661fb4e5.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/c6c94f34acd41266a967e519587c4dcc.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=27') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (28, '동해안 참 자연산 대게 프리미엄', 150000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/290bbf7adfa7fa52fa4e3b917a12b54f.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/180f7025eeeeacd804700863179373e4.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=28') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (29, '싱싱한 독도 자연산 새우와 딱새우 세트', 55000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/4d1174f0574b1178371a677400beb151.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/1c507b137c6b87e5840b8a17fc759f6a.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=29') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (30, '울릉도 청정 바다 반건조 오징어', 39000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/68c765a88f70fa88e4658da9073cd612.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/fd4d12bb7ae11fa5da68673fee1d6fad.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=30') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (31, '제주 비타민 가득 황금향과 한라봉 세트', 46000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/f132d9f3a4268d536f8f65814c15d50f.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/565292ef71feddd0c5fbe0f8fc0a0cf6.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=31') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (32, '완도 햇 재래김과 참기름 재래 미역 세트', 28000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/6e0b20c1ab3ee4f22d5613638f593fb5.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/faf6029fea9aa8aa6123eaf541f58034.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=32') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (33, '경북 청송 고당도 꿀사과 선물세트', 48000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/e8982354dd44d5185c40c44cefc45621.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/67db9715e634462637fef28c34e8a7a9.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=33') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (34, '나주 전통 명품 황금빛 큰 배 세트', 55000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/ed2a4e41830163b3e82fc1fd27a30552.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/e986160d2abb1dfa668d1188ec90e2bb.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=34') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (35, '향긋하고 과즙이 풍부한 햇사레 복숭아', 41000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/dd5b0dd60a0d3e7e76b0d07307d37b05.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/ebe779cd8c7e495f5756cec2eb1262eb.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=35') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (36, '프리미엄 고당도 아삭한 샤인머스캣', 42000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/f13e0f12c5250c78c21814b7cac2d14b.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/f471276f731569e5e61c528faac19e81.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=36') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (37, '친환경 우렁이 농법으로 키운 유기농 쌀', 48000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/86405d17048fadc8f48961e67320819f.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/606bfe3a166517bcb4a7dbb2a76671df.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=37') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (38, '철원 오대쌀 프리미엄 신곡', 52000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/200f6e9e61dd7b9d4cb6c90312419e39.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/125a811d2ead671ef8d0674ba7759e90.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=38') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (39, '전통 방식으로 자연 건조한 상주 반건시 곶감', 35000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/873f270e87ec610840e09b7016576dd9.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/ae8c69d5a951cbb27fc2aa82aa83b7e6.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=39') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (40, '충남 공주 알밤 큰 사이즈 선물용', 29000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/86213826a565a3f5aec9d6bd1da38ae9.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/ceb38df23004b558bfbc62ebbb3a2ff1.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=40') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (41, '고소한 향이 일품인 골든퀸 향미 쌀', 55000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/4d2e1f9f46257598938a1dca36e2c867.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/b59faa762024e1591aeeeb4f6f46bd8b.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=41') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (42, '달콤 향긋한 하우스 재배 머스크멜론', 38000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/ae54344ce005b2ed481acec7667c79bd.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/17cfe78b50b78a10a9a5f8ef0c1c3885.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=42') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (43, '건강을 채우는 15곡 프리미엄 혼합잡곡', 24000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/a4cd3b1eec60f92fee9ef83afa2da818.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/ea30dab310f61b51bb28c61f198b9e05.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=43') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (44, '전통 가마솥 방식으로 볶아낸 고소한 미숫가루', 18000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/f705acf14ad68fdd934ba3b3050ae8f4.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/c62b77f69d828d5c54d4596ce4ca6bb4.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=44') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (45, '태양초 고추장 명가의 순창 전통 고추장', 28000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/4b11f263b3b777533d8c53f1ecd29e19.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/cc4b388c84e0f30f04021bd29fb6e148.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=45') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (46, '청정 신안 토판에서 생산한 명품 천일염', 22000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/c6f66ee78a684a4b6f3bdebab7e40487.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/f93692a21eefc4bf0d9ebc8f9d8fbfb5.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=46') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (47, '전통 방식으로 저온 압착한 참기름과 들기름 세트', 45000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/f85d83e9af934a438c6e1e62a78958e9.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/75135f04f5ac60272c5d180834d41682.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=47') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (48, '하동 전통 차밭에서 딴 수제 우전 녹차', 38000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/ef038bc27f3176b2982c0e9357dd44e9.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/bf9e49846eee07a29621de205093bef5.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=48') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (49, '지리산 야생화로 채밀한 순수 자연산 벌꿀', 58000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/8c3940d119718ab4b3225b6ebeed7c53.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/66b06913f3abffe56d2f7356f7046027.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=49') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();
insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (50, '전통 명인이 빚어낸 3년 숙성 재래 된장', 26000, true, true, false, 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/medium/20261020/45d56b008020d7bd4842397af657ef0a.jpg', 'https://ecimg.cafe24img.com/pg3513b14253592095/axopenlab/web/product/big/20261020/439856877c3906573f7322302d5f5561.jpg', 'https://axopenlab.cafe24.com/product/detail.html?product_no=50') on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();

-- 상품별 지표 (가안)
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (11, '국내', '정육/축산', '{"trust":6,"rarity":5,"regional":4,"formality":6,"practicality":5,"craftsmanship":3}'::jsonb, array['thanks', 'birthday', 'longevity']::text[], array['family', 'senior', 'peer']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['한우', '차돌박이']::text[], '구이·국거리로 두루 쓰는 한우 차돌박이와 양지', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (12, '국내', '정육/축산', '{"trust":8,"rarity":8,"regional":4,"formality":10,"practicality":4,"craftsmanship":5}'::jsonb, array['promotion', 'longevity', 'wedding', 'thanks']::text[], array['senior', 'business']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{"longevity":"어르신 상차림의 으뜸으로 꼽히는 귀한 선물"}'::jsonb, array['1++등급', '한우등심']::text[], '최상급 1++ 등급 한우 등심 선물세트', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (13, '국내', '정육/축산', '{"trust":6,"rarity":6,"regional":4,"formality":7,"practicality":6,"craftsmanship":7}'::jsonb, array['longevity', 'thanks', 'promotion', 'birthday']::text[], array['senior', 'family', 'business']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['수제양념', '한우갈비']::text[], '전통 명가에서 직접 양념한 수제 한우 갈비', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (14, '지리산', '정육/축산', '{"trust":7,"rarity":7,"regional":6,"formality":8,"practicality":4,"craftsmanship":4}'::jsonb, array['promotion', 'longevity', 'thanks', 'wedding']::text[], array['senior', 'business', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['한우안심', '지리산']::text[], '지리산 청정 지역에서 키운 한우 안심', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (15, '국내', '정육/축산', '{"trust":7,"rarity":2,"regional":2,"formality":2,"practicality":6,"craftsmanship":2}'::jsonb, array['birthday']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['무항생제', '한돈']::text[], '무항생제 한돈 삼겹살 구이용', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (16, '국내', '정육/축산', '{"trust":5,"rarity":2,"regional":2,"formality":3,"practicality":6,"craftsmanship":2}'::jsonb, array['birthday', 'thanks']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['한돈', '목살']::text[], '육즙이 풍부한 한돈 목살', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (17, '국내', '정육/축산', '{"trust":4,"rarity":3,"regional":2,"formality":2,"practicality":6,"craftsmanship":6}'::jsonb, array['birthday', 'opening']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['수제', '족발보쌈']::text[], '전통 방식으로 삶아낸 수제 족발과 보쌈', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (18, '국내', '정육/축산', '{"trust":8,"rarity":8,"regional":4,"formality":8,"practicality":4,"craftsmanship":5}'::jsonb, array['promotion', 'longevity', 'thanks', 'wedding']::text[], array['senior', 'business']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['1++등급', '특수부위']::text[], '1++ 한우 특수부위 모둠', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (19, '제주', '정육/축산', '{"trust":5,"rarity":5,"regional":7,"formality":4,"practicality":5,"craftsmanship":3}'::jsonb, array['birthday', 'thanks']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['제주흑돼지']::text[], '제주 토종 흑돼지 등갈비', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (20, '완도', '수산/해산물', '{"trust":6,"rarity":7,"regional":8,"formality":7,"practicality":4,"craftsmanship":4}'::jsonb, array['longevity', 'birth', 'thanks', 'promotion']::text[], array['senior', 'business', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{"birth":"산모의 몸을 보하는 대표 보양식","longevity":"귀한 보양식으로 건강과 장수를 기원하는 마음"}'::jsonb, array['완도', '활전복']::text[], '완도 청정 바다에서 키운 활전복', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (21, '국내', '수산/해산물', '{"trust":5,"rarity":3,"regional":4,"formality":3,"practicality":5,"craftsmanship":2}'::jsonb, array['thanks']::text[], array['family', 'peer']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['생물', '고등어삼치']::text[], '생물 고등어와 삼치 세트', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (22, '국내', '정육/축산', '{"trust":8,"rarity":3,"regional":2,"formality":2,"practicality":7,"craftsmanship":2}'::jsonb, array['birth', 'birthday']::text[], array['family', 'peer']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{"birth":"새 생명의 탄생을 축하하는 의미"}'::jsonb, array['동물복지', '자연방사']::text[], '자연방사 동물복지 유정란', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (23, '영광', '수산/해산물', '{"trust":7,"rarity":8,"regional":10,"formality":10,"practicality":6,"craftsmanship":8}'::jsonb, array['longevity', 'promotion', 'thanks', 'wedding', 'opening']::text[], array['senior', 'business']::text[], '[]'::jsonb, '{"longevity":"임금님께 올리던 진상품으로 귀한 어른께 드리는 예","promotion":"''굴하지 않는다''는 뜻을 담은 굴비로 새 자리에서의 기개를 응원하는 마음"}'::jsonb, array['법성포', '진상품']::text[], '임금님 진상품으로 알려진 영광 법성포 굴비', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (24, '국내', '정육/축산', '{"trust":6,"rarity":5,"regional":4,"formality":3,"practicality":5,"craftsmanship":3}'::jsonb, array['birth', 'birthday', 'thanks']::text[], array['family', 'peer']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{"birth":"산후 몸조리를 돕는 전통 보양식"}'::jsonb, array['방목', '토종닭']::text[], '방목해 키운 재래 토종닭', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (25, '지리산', '정육/축산', '{"trust":6,"rarity":6,"regional":6,"formality":4,"practicality":5,"craftsmanship":5}'::jsonb, array['thanks', 'birthday']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['유황오리', '지리산']::text[], '지리산 유황오리 로스', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (26, '제주', '수산/해산물', '{"trust":6,"rarity":7,"regional":7,"formality":7,"practicality":5,"craftsmanship":3}'::jsonb, array['thanks', 'longevity', 'promotion']::text[], array['senior', 'business', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['제주', '은갈치']::text[], '제주 바다 은갈치 특대형', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (27, '남해', '수산/해산물', '{"trust":7,"rarity":8,"regional":9,"formality":7,"practicality":8,"craftsmanship":8}'::jsonb, array['funeral', 'thanks', 'longevity', 'wedding']::text[], array['senior', 'business', 'family']::text[], '[]'::jsonb, '{}'::jsonb, array['죽방렴', '자연건조']::text[], '남해 전통 죽방렴으로 잡아 자연 건조한 멸치', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (28, '동해', '수산/해산물', '{"trust":6,"rarity":8,"regional":7,"formality":7,"practicality":3,"craftsmanship":3}'::jsonb, array['promotion', 'thanks', 'longevity', 'birthday']::text[], array['senior', 'business', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['자연산', '대게']::text[], '동해안 자연산 대게', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (29, '독도', '수산/해산물', '{"trust":6,"rarity":9,"regional":9,"formality":5,"practicality":3,"craftsmanship":3}'::jsonb, array['birthday', 'thanks']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['독도', '자연산']::text[], '독도 자연산 새우와 딱새우', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (30, '울릉도', '수산/해산물', '{"trust":6,"rarity":7,"regional":8,"formality":4,"practicality":6,"craftsmanship":4}'::jsonb, array['thanks', 'birthday']::text[], array['peer', 'family']::text[], '[{"event":"funeral","reason":"신선·냉장 상품이라 다수에게 대량 발송하는 장례 답례에 부적합"}]'::jsonb, '{}'::jsonb, array['울릉도', '반건조']::text[], '울릉도 청정 바다 반건조 오징어', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (31, '제주', '과일/과채', '{"trust":6,"rarity":6,"regional":7,"formality":6,"practicality":6,"craftsmanship":3}'::jsonb, array['thanks', 'birthday', 'longevity']::text[], array['family', 'peer', 'business']::text[], '[]'::jsonb, '{}'::jsonb, array['제주', '만감류']::text[], '제주 황금향과 한라봉 세트', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (32, '완도', '수산/해산물', '{"trust":7,"rarity":5,"regional":7,"formality":6,"practicality":9,"craftsmanship":5}'::jsonb, array['birth', 'funeral', 'thanks']::text[], array['family', 'senior', 'peer']::text[], '[]'::jsonb, '{"birth":"미역은 산모의 회복을 바라는 전통 출산 선물"}'::jsonb, array['완도', '재래김', '미역']::text[], '완도 재래김과 미역, 참기름 세트', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (33, '청송', '과일/과채', '{"trust":7,"rarity":6,"regional":8,"formality":7,"practicality":6,"craftsmanship":4}'::jsonb, array['thanks', 'longevity', 'wedding', 'promotion']::text[], array['senior', 'business', 'family', 'peer']::text[], '[]'::jsonb, '{"wedding":"평안과 화목을 뜻하는 사과로 새 가정을 축하하는 마음"}'::jsonb, array['청송', '고당도']::text[], '경북 청송 고당도 꿀사과', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (34, '나주', '과일/과채', '{"trust":5,"rarity":5,"regional":9,"formality":8,"practicality":6,"craftsmanship":5}'::jsonb, array['thanks', 'longevity', 'opening', 'promotion', 'birthday']::text[], array['senior', 'business', 'family']::text[], '[{"event":"funeral","reason":"신선 과일 특성상 상온 보관 및 대량 발송이 필요한 장례 답례로 부적합"}]'::jsonb, '{}'::jsonb, array['나주배', '명품배', '전통명품']::text[], '나주 전통 명품 배 세트로 많은 고객이 명절에 차례에 많이 올린다.', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (35, '음성·이천', '과일/과채', '{"trust":6,"rarity":6,"regional":7,"formality":5,"practicality":4,"craftsmanship":3}'::jsonb, array['thanks', 'birthday']::text[], array['family', 'peer']::text[], '[{"event":"funeral","reason":"복숭아는 제례·상례에 쓰지 않는 관습"}]'::jsonb, '{}'::jsonb, array['햇사레']::text[], '과즙이 풍부한 햇사레 복숭아', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (36, '국내', '과일/과채', '{"trust":6,"rarity":5,"regional":3,"formality":6,"practicality":6,"craftsmanship":3}'::jsonb, array['birthday', 'thanks', 'promotion']::text[], array['peer', 'family', 'business']::text[], '[]'::jsonb, '{}'::jsonb, array['샤인머스캣', '고당도']::text[], '고당도 샤인머스캣', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (37, '국내', '쌀/잡곡', '{"trust":9,"rarity":5,"regional":4,"formality":6,"practicality":9,"craftsmanship":5}'::jsonb, array['funeral', 'wedding', 'birth', 'thanks']::text[], array['family', 'business', 'senior']::text[], '[]'::jsonb, '{"birth":"유기농 쌀로 산모와 아기의 건강을 바라는 마음","funeral":"쌀은 정성과 감사를 담는 가장 기본의 답례"}'::jsonb, array['유기농', '우렁이농법']::text[], '우렁이 농법으로 키운 유기농 쌀', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (38, '철원', '쌀/잡곡', '{"trust":7,"rarity":6,"regional":7,"formality":6,"practicality":9,"craftsmanship":4}'::jsonb, array['funeral', 'wedding', 'thanks', 'opening']::text[], array['senior', 'business', 'peer', 'family']::text[], '[]'::jsonb, '{"funeral":"쌀은 정성과 감사를 담는 가장 기본의 답례","opening":"곳간이 가득 차듯 번창을 기원하는 쌀"}'::jsonb, array['철원', '오대쌀', '신곡']::text[], '철원 오대쌀 신곡', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (39, '상주', '전통다과/한과', '{"trust":7,"rarity":6,"regional":8,"formality":7,"practicality":7,"craftsmanship":7}'::jsonb, array['longevity', 'thanks', 'funeral', 'promotion']::text[], array['senior', 'business', 'family']::text[], '[]'::jsonb, '{}'::jsonb, array['상주', '자연건조', '반건시']::text[], '전통 방식으로 자연 건조한 상주 반건시 곶감', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (40, '공주', '과일/과채', '{"trust":6,"rarity":5,"regional":7,"formality":5,"practicality":6,"craftsmanship":3}'::jsonb, array['thanks', 'longevity', 'birthday', 'wedding']::text[], array['family', 'peer', 'senior']::text[], '[]'::jsonb, '{"wedding":"폐백의 밤처럼 자손의 번창을 기원하는 마음"}'::jsonb, array['공주', '알밤']::text[], '충남 공주 알밤 선물용 큰 사이즈', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (41, '국내', '쌀/잡곡', '{"trust":6,"rarity":6,"regional":5,"formality":6,"practicality":9,"craftsmanship":4}'::jsonb, array['funeral', 'wedding', 'thanks', 'opening', 'longevity']::text[], array['senior', 'business', 'peer', 'family']::text[], '[]'::jsonb, '{"funeral":"쌀은 정성과 감사를 담는 가장 기본의 답례","opening":"곳간이 가득 차듯 번창을 기원하는 쌀"}'::jsonb, array['향미', '골든퀸']::text[], '향이 고소한 골든퀸 향미 쌀', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (42, '국내', '과일/과채', '{"trust":6,"rarity":5,"regional":3,"formality":5,"practicality":5,"craftsmanship":3}'::jsonb, array['birthday', 'thanks', 'birth']::text[], array['peer', 'family']::text[], '[]'::jsonb, '{}'::jsonb, array['머스크멜론']::text[], '하우스 재배 머스크멜론', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (43, '국내', '쌀/잡곡', '{"trust":7,"rarity":3,"regional":3,"formality":4,"practicality":9,"craftsmanship":3}'::jsonb, array['funeral', 'thanks', 'birth']::text[], array['family', 'peer']::text[], '[]'::jsonb, '{}'::jsonb, array['15곡', '혼합잡곡']::text[], '15곡 프리미엄 혼합잡곡', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (44, '국내', '쌀/잡곡', '{"trust":6,"rarity":3,"regional":3,"formality":3,"practicality":8,"craftsmanship":5}'::jsonb, array['thanks', 'birthday']::text[], array['peer', 'family']::text[], '[]'::jsonb, '{}'::jsonb, array['가마솥', '미숫가루']::text[], '가마솥 방식으로 볶은 미숫가루', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (45, '순창', '전통장/발효식품', '{"trust":7,"rarity":5,"regional":9,"formality":6,"practicality":9,"craftsmanship":8}'::jsonb, array['funeral', 'thanks', 'wedding']::text[], array['senior', 'family', 'business']::text[], '[]'::jsonb, '{"wedding":"오래 익을수록 깊어지는 장맛처럼 깊어질 인연을 축하하는 마음"}'::jsonb, array['순창', '태양초']::text[], '순창 태양초 고추장 명가의 전통 고추장', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (46, '신안', '오일/조미료', '{"trust":7,"rarity":7,"regional":8,"formality":5,"practicality":9,"craftsmanship":6}'::jsonb, array['funeral', 'opening', 'thanks']::text[], array['business', 'peer', 'family']::text[], '[]'::jsonb, '{"opening":"소금은 나쁜 기운을 막고 새 출발을 지켜준다는 의미"}'::jsonb, array['신안', '토판염']::text[], '청정 신안 토판에서 생산한 천일염', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (47, '국내', '오일/조미료', '{"trust":7,"rarity":5,"regional":5,"formality":7,"practicality":9,"craftsmanship":7}'::jsonb, array['funeral', 'wedding', 'thanks', 'birth', 'opening']::text[], array['senior', 'business', 'family']::text[], '[]'::jsonb, '{"wedding":"''깨가 쏟아지는'' 신혼을 바라는 고소한 마음"}'::jsonb, array['저온압착', '참기름', '들기름']::text[], '전통 저온 압착 참기름과 들기름 세트', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (48, '하동', '다도/천연꿀', '{"trust":5,"rarity":7,"regional":8,"formality":7,"practicality":7,"craftsmanship":7}'::jsonb, array['thanks', 'promotion', 'longevity', 'birthday']::text[], array['senior', 'business', 'family', 'peer']::text[], '[]'::jsonb, '{}'::jsonb, array['하동', '우전녹차', '수제', '전통차밭']::text[], '하동 전통 차밭에서 딴 수제 우전 녹차', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (49, '지리산', '다도/천연꿀', '{"trust":7,"rarity":7,"regional":8,"formality":8,"practicality":8,"craftsmanship":6}'::jsonb, array['longevity', 'thanks', 'funeral', 'wedding', 'promotion', 'birth']::text[], array['senior', 'business', 'family', 'peer']::text[], '[]'::jsonb, '{"wedding":"달콤한 새 출발을 바라는 마음","longevity":"건강하고 달콤한 날들을 기원하는 마음"}'::jsonb, array['지리산', '야생화꿀']::text[], '지리산 야생화로 채밀한 자연산 벌꿀', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();
insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (50, '국내', '전통장/발효식품', '{"trust":7,"rarity":6,"regional":6,"formality":6,"practicality":9,"craftsmanship":9}'::jsonb, array['funeral', 'wedding', 'thanks', 'opening', 'longevity']::text[], array['senior', 'business', 'family']::text[], '[]'::jsonb, '{"wedding":"오래 익을수록 깊어지는 장맛처럼 깊어질 인연을 축하하는 마음"}'::jsonb, array['3년숙성', '명인']::text[], '전통 명인이 3년 숙성한 재래 된장', false) on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();

-- 엔진 설정
insert into public.engine_config (id, config) values ('active', '{"_note":"온답 격식지수 가안 v0.1 (개발 측 자체 모델). 심이사 관리자 시안의 4개 지표에 회의·결과 화면에서 나온 요소(위생·신뢰, 실용성, 선물의 의미, 소멸위기지역 상생, 격식 단계)를 더했다. 특허 자료가 오면 비교해 교체하거나 병행한다.","modelVersion":"v0.1","indicators":[{"id":"rarity","name":"희소성","description":"지역 한정, 소량 생산일수록 높음","max":10,"mode":"higher","reasonPhrase":"쉽게 구하기 어려운 귀한 상품"},{"id":"craftsmanship","name":"장인·전통성","description":"명인, 대가, 전통 기법, 가업일수록 높음","max":10,"mode":"higher","reasonPhrase":"장인의 손길과 전통 방식이 담긴 상품"},{"id":"regional","name":"지역 가치","description":"산지의 이야기, 역사성, 지역 대표성","max":10,"mode":"higher","reasonPhrase":"산지의 이야기가 담긴 지역 대표 상품"},{"id":"trust","name":"신뢰·안전","description":"인증(유기농·무항생제·등급), 위생, 생산 이력","max":10,"mode":"higher","reasonPhrase":"믿고 드릴 수 있는 안심 상품"},{"id":"practicality","name":"실용성","description":"보관이 쉽고 받는 분이 두루 쓰기 좋은 정도","max":10,"mode":"higher","reasonPhrase":"받는 분이 두루 쓰기 좋은 실속 상품"},{"id":"formality","name":"격식 적합도","description":"품격, 가격대, 포장. 상황별 목표 수준에 가까울수록 좋음","max":10,"mode":"target","reasonPhrase":"자리의 격식에 꼭 맞는 상품"}],"events":{"funeral":{"name":"장례","formalityTarget":7,"weights":{"rarity":0.5,"craftsmanship":1.5,"regional":1,"trust":1.5,"practicality":2,"formality":3}},"wedding":{"name":"결혼","formalityTarget":7,"weights":{"rarity":1.5,"craftsmanship":1.5,"regional":1,"trust":1,"practicality":1,"formality":2}},"longevity":{"name":"회갑/칠순","formalityTarget":8,"weights":{"rarity":1,"craftsmanship":2,"regional":1.5,"trust":1.5,"practicality":0.5,"formality":2.5}},"birth":{"name":"출산","formalityTarget":5,"weights":{"rarity":0.5,"craftsmanship":1,"regional":1,"trust":2.5,"practicality":1.5,"formality":1}},"promotion":{"name":"승진/이직","formalityTarget":8,"weights":{"rarity":2,"craftsmanship":1.5,"regional":1,"trust":1,"practicality":0.5,"formality":2}},"opening":{"name":"신축/개업","formalityTarget":6,"weights":{"rarity":1.5,"craftsmanship":1,"regional":1.5,"trust":1,"practicality":1,"formality":1.5}},"thanks":{"name":"감사선물","formalityTarget":6,"weights":{"rarity":1.5,"craftsmanship":1.5,"regional":2,"trust":1,"practicality":1,"formality":1.5}},"birthday":{"name":"생일","formalityTarget":4,"weights":{"rarity":2,"craftsmanship":1,"regional":1,"trust":0.5,"practicality":1,"formality":1}}},"relations":{"senior":{"name":"상급자/어르신","formalityShift":1.5,"multipliers":{"craftsmanship":1.2,"trust":1.2,"formality":1.5}},"business":{"name":"거래처/공식","formalityShift":1,"multipliers":{"regional":1.2,"trust":1.2,"formality":1.4}},"peer":{"name":"동료/친구","formalityShift":-1,"multipliers":{"rarity":1.2,"practicality":1.2}},"family":{"name":"가족/친밀","formalityShift":-1.5,"multipliers":{"trust":1.2,"practicality":1.3}}},"targetSlope":1.5,"bonus":{"eventFit":6,"eventMiss":-12,"relationFit":4,"meaning":6,"depopulation":3},"depopulationAreas":["영광","신안","완도","하동","남해","상주","청송","순창","울릉도","독도","철원","공주"],"_depopulationNote":"행정안전부 2021년 인구감소지역 지정 기준으로 개발 측이 정리. 공식 목록과 대조 필요.","tiers":[{"minFormality":8,"label":"격을 갖춘 선택"},{"minFormality":6,"label":"실속 있는 정성"},{"minFormality":0,"label":"가벼운 안부의 예의"}],"diversity":{"maxPerCategory":1},"budgetRelaxRatio":1.3,"resultCount":3}'::jsonb) on conflict (id) do update set config = excluded.config, updated_at = now();

commit;

-- ==================== 관리자 등록 (직접 실행) ====================
-- Authentication > Users > Add user(Auto Confirm User 체크)로 관리자 계정을 만든 뒤, 이메일을 바꿔 아래 한 줄만 따로 실행:
-- insert into public.admins (user_id) select id from auth.users where lower(email) = lower('관리자 이메일') returning user_id;
