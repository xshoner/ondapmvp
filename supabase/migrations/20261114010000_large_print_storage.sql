-- 대용량 카드 및 스티커 인쇄 파일 저장을 위한 세션 표 및 저장소 한도 확장
-- 1. design-files 저장소 버킷 한도: 3MB -> 10MB (10485760 바이트)
update storage.buckets
set file_size_limit = 10485760
where id = 'design-files';

-- 2. 업로드 세션 표 (임시 업로드의 단기 권한·무결성 검증·중복 방지·응답 유실 복구)
create table if not exists public.design_upload_sessions (
  id text primary key,
  code text not null unique,
  secret_hash text not null,
  meta jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'expired')),
  files_expected jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists design_upload_sessions_status_expires_idx
  on public.design_upload_sessions (status, expires_at);

-- RLS: 일반 사용자 및 외부 접근 완전 차단, 서버(service_role)만 접근 허용
alter table public.design_upload_sessions enable row level security;
revoke all on public.design_upload_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.design_upload_sessions to service_role;
