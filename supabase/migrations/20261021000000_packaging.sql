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
