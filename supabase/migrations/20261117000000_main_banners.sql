-- 메인 배너 관리 기능
-- 카페24 PC·모바일 메인의 .ondap-cta 영역에 노출되는 배너를 관리자가 선택·적용한다.
-- 단일 트랜잭션 RPC와 동시성 제약으로 배너 활성 상태의 정합성(언제나 정확히 1개 활성)을 보장한다.
-- 보안: banner-assets 전용 버킷으로 엄격 격리하며 기존 packaging-assets 정책 및 데이터는 일체 변경하지 않는다.

create table if not exists public.main_banners (
  id text primary key,
  title text not null check (char_length(title) between 1 and 60),
  image_url text not null default '' check (char_length(image_url) <= 500),
  link_url text not null default 'https://dapcue.vercel.app/' check (char_length(link_url) <= 500),
  alt_text text not null default '' check (char_length(alt_text) <= 200),
  is_active boolean not null default false,
  season_type text not null default 'default' check (season_type in ('default', 'chuseok', 'christmas', 'custom')),
  badge_text text not null default '답례큐 AI 추천 큐레이션' check (char_length(badge_text) <= 50),
  headline text not null default '자리에 맞는 답례, 답례큐가 추천드려요.' check (char_length(headline) <= 100),
  sub_text text not null default '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.' check (char_length(sub_text) <= 200),
  button_text text not null default '답례품 추천받기' check (char_length(button_text) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 동시성 제약: 활성(is_active = true) 배너는 시스템 전체에서 오직 하나만 존재 가능 (유니크 인덱스)
create unique index if not exists main_banners_one_active
  on public.main_banners (is_active)
  where (is_active = true);

alter table public.main_banners enable row level security;

-- 테이블 RLS 권한
drop policy if exists "누구나 활성 배너 읽기" on public.main_banners;
create policy "누구나 활성 배너 읽기" on public.main_banners
  for select to anon, authenticated using (is_active = true or (select private.is_admin()));

drop policy if exists "관리자 메인 배너 추가" on public.main_banners;
create policy "관리자 메인 배너 추가" on public.main_banners
  for insert to authenticated with check ((select private.is_admin()));

drop policy if exists "관리자 메인 배너 수정" on public.main_banners;
create policy "관리자 메인 배너 수정" on public.main_banners
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "관리자 메인 배너 삭제" on public.main_banners;
create policy "관리자 메인 배너 삭제" on public.main_banners
  for delete to authenticated using ((select private.is_admin()));

grant select on public.main_banners to anon;
grant select, insert, update, delete on public.main_banners to authenticated;

-- ---------- 단일 트랜잭션 RPC: 활성 배너 원자적 전환 ----------
-- 관리자 권한을 직접 검증하며, 없는 ID인 경우 예외를 발생시켜 기존 상태를 100% 보존한다.
create or replace function public.set_active_main_banner(p_banner_id text)
returns public.main_banners
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_banner public.main_banners;
  v_exists boolean;
begin
  -- 1. 관리자 권한 엄격 검증
  if not (select private.is_admin()) then
    raise exception '관리자 권한이 없습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(20261117, 1);

  -- 2. 대상 배너 존재 여부 확인 (없으면 기존 상태 보존하고 에러)
  select exists(select 1 from public.main_banners where id = p_banner_id) into v_exists;
  if not v_exists then
    raise exception '존재하지 않는 배너 ID입니다: %', p_banner_id;
  end if;

  -- 3. 원자적 단일 트랜잭션으로 기존 활성 배너 끄고 대상 활성화
  update public.main_banners
  set is_active = false, updated_at = now()
  where is_active = true;

  update public.main_banners
  set is_active = true, updated_at = now()
  where id = p_banner_id
  returning * into v_banner;

  return v_banner;
end;
$$;

revoke all on function public.set_active_main_banner(text) from public, anon;
grant execute on function public.set_active_main_banner(text) to authenticated;

-- ---------- 공개 배너 전용 스토리지 버킷 (banner-assets) 격리 ----------
-- packaging-assets 등 기존 고객 버킷은 일체 손대지 않으며 오직 banner-assets만 관리한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('banner-assets', 'banner-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true;

-- 누구나 공개 배너 이미지 읽기 허용 (오직 banner-assets 버킷만 허용)
drop policy if exists "누구나 배너 자산 읽기" on storage.objects;
create policy "누구나 배너 자산 읽기" on storage.objects
  for select to anon, authenticated using (bucket_id = 'banner-assets');

-- 관리자만 banner-assets 업로드/수정/삭제 허용
drop policy if exists "관리자 배너 자산 올리기" on storage.objects;
create policy "관리자 배너 자산 올리기" on storage.objects
  for insert to authenticated with check (bucket_id = 'banner-assets' and (select private.is_admin()));

drop policy if exists "관리자 배너 자산 수정" on storage.objects;
create policy "관리자 배너 자산 수정" on storage.objects
  for update to authenticated using (bucket_id = 'banner-assets' and (select private.is_admin()))
  with check (bucket_id = 'banner-assets' and (select private.is_admin()));

drop policy if exists "관리자 배너 자산 삭제" on storage.objects;
create policy "관리자 배너 자산 삭제" on storage.objects
  for delete to authenticated using (bucket_id = 'banner-assets' and (select private.is_admin()));

-- ---------- 초기 기본 배너 3종 (기본형, 추석, 크리스마스) 시드 ----------
insert into public.main_banners (id, title, image_url, link_url, alt_text, is_active, season_type, badge_text, headline, sub_text, button_text)
values
  ('banner-default', '기본형 배너 (AI 격식지수 추천)', '', 'https://dapcue.vercel.app/', '답례큐 AI 추천 큐레이션 메인 배너', true, 'default', '답례큐 AI 추천 큐레이션', '자리에 맞는 답례, 답례큐가 추천드려요.', '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.', '답례품 추천받기'),
  ('banner-chuseok', '추석 명절 시즌 배너', '/banners/chuseok.webp', 'https://dapcue.vercel.app/', '답례큐 한가위 추석 선물 큐레이션 메인 배너', false, 'chuseok', '답례큐 추석 특별 큐레이션', '마음을 전하는 한가위 답례, 답례큐가 추천드려요.', '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.', '추석 답례품 추천받기'),
  ('banner-christmas', '크리스마스 연말 시즌 배너', '/banners/christmas.webp', 'https://dapcue.vercel.app/', '답례큐 크리스마스 연말 선물 큐레이션 메인 배너', false, 'christmas', '답례큐 연말·성탄 특별 큐레이션', '따뜻한 마음을 담은 연말 답례, 답례큐가 추천드려요.', '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.', '연말 답례품 추천받기')
on conflict (id) do nothing;
