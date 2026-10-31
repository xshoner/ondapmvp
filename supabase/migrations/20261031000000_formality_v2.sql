-- 20261031000000_formality_v2.sql
-- 온답 격식지수 v2: 상품 근거(5대 희소 속성) 및 행사 격식 정책 테이블
-- 기존 운영 데이터(products, product_attributes, engine_config 등)와 완전 호환됩니다.
-- 주의: setup.sql을 기존 운영 DB에 실행하지 마세요. 이 파일만 SQL Editor에서 실행합니다.

-- 1. 상품별 5대 희소 속성 및 검수 근거 테이블
create table if not exists public.product_evidence (
  -- 상품 동기화에서 상품이 사라져도 근거를 보존한다.
  product_no integer primary key check (product_no > 0),
  reviewed boolean not null default false,
  rarity_score numeric(14,12),
  factors jsonb not null default '{}'::jsonb check (pg_column_size(factors) < 16384),
  description text not null default '' check (length(description) <= 12000),
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- RLS: 상품 근거는 관리자만 접근할 수 있어야 합니다 (공개 접근 차단)
alter table public.product_evidence enable row level security;

create policy "관리자 상품 근거 읽기" on public.product_evidence
  for select to authenticated
  using ((select private.is_admin()));

create policy "관리자 상품 근거 쓰기" on public.product_evidence
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.product_evidence to authenticated;
grant all on public.product_evidence to service_role;

-- 2. 격식지수 v2 정책 (행사 기본점수, 보정치, 구간표, 희소/순위 가중치)
create table if not exists public.formality_policies (
  version text primary key check (version ~ '^[a-zA-Z0-9_-]{1,80}$'),
  policy jsonb not null check (pg_column_size(policy) < 16384),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text
);

-- RLS: 미게시 정책은 관리자만 접근할 수 있어야 합니다
alter table public.formality_policies enable row level security;

create policy "관리자 정책 읽기" on public.formality_policies
  for select to authenticated
  using ((select private.is_admin()));

create policy "관리자 정책 쓰기" on public.formality_policies
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.formality_policies to authenticated;
grant all on public.formality_policies to service_role;

-- 기존 백업 형식에 새 상품 근거와 정책을 포함한다.
create or replace function public.export_application_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare output jsonb := '{}'::jsonb; table_name text; rows jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception '서버 백업 작업만 실행할 수 있습니다.' using errcode='42501'; end if;
  foreach table_name in array array['products','product_attributes','engine_config','scenario_expectations','packaging_styles','design_images','design_texts','designs','recommendation_logs','recommendation_feedback','product_attributes_history','product_evidence','formality_policies'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',table_name) into rows;
    output := output || jsonb_build_object(table_name,rows);
  end loop;
  return jsonb_build_object('schemaVersion','20261031','capturedAt',now(),'tables',output);
end; $$;
revoke all on function public.export_application_snapshot() from public;
grant execute on function public.export_application_snapshot() to service_role;
