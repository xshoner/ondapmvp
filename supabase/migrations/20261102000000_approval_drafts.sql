-- 20261102000000_approval_drafts.sql
-- 온답 결재 문서 초안 및 비공개 자산 저장소
-- 주의: setup.sql을 기존 운영 DB에 실행하지 마세요. 이 파일만 SQL Editor에서 실행합니다.

-- 1. 결재 문서 초안 테이블
create table if not exists public.approval_drafts (
  id uuid primary key,
  revision integer not null default 1 check (revision > 0),
  creator_token_hash text not null check (length(creator_token_hash) = 64),
  data jsonb not null check (pg_column_size(data) < 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS 활성화: 공개(anon) 접근은 일절 차단되며, 서버 서비스 역할 및 관리자만 조회 가능
alter table public.approval_drafts enable row level security;

create policy "관리자 결재 초안 읽기" on public.approval_drafts
  for select to authenticated
  using ((select private.is_admin()));

create policy "관리자 결재 초안 관리" on public.approval_drafts
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.approval_drafts to authenticated;
grant all on public.approval_drafts to service_role;

-- 2. 비공개 저장소 버킷 (공개 버킷에 작성자·기관·문서 내용 미노출)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('approval-assets', 'approval-assets', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "서비스 역할 결재 자산 읽기" on storage.objects
  for select to service_role
  using (bucket_id = 'approval-assets');

create policy "서비스 역할 결재 자산 쓰기" on storage.objects
  for insert to service_role
  with check (bucket_id = 'approval-assets');

create policy "서비스 역할 결재 자산 삭제" on storage.objects
  for delete to service_role
  using (bucket_id = 'approval-assets');

-- 3. 백업 함수 export_application_snapshot에 approval_drafts 포함
create or replace function public.export_application_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare output jsonb := '{}'::jsonb; table_name text; rows jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception '서버 백업 작업만 실행할 수 있습니다.' using errcode='42501'; end if;
  foreach table_name in array array['products','product_attributes','engine_config','scenario_expectations','packaging_styles','design_images','design_texts','designs','recommendation_logs','recommendation_feedback','product_attributes_history','product_evidence','formality_policies','approval_drafts'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',table_name) into rows;
    output := output || jsonb_build_object(table_name,rows);
  end loop;
  return jsonb_build_object('schemaVersion','20261102','capturedAt',now(),'tables',output);
end; $$;
revoke all on function public.export_application_snapshot() from public;
grant execute on function public.export_application_snapshot() to service_role;
