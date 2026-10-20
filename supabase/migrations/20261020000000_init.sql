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
