-- 1) 추천에 대한 고객 목소리: 결과 화면 끝 '도움 됐어요 / 아쉬워요' + 아쉬운 이유
-- 2) 보강: 공개 키로 API에 직접 넣어도 시각·이름을 위조할 수 없게
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만). 앞의 마이그레이션을 모두 실행한 상태여야 한다.
--
-- 이유는 정해진 보기에서 고르기만 한다(자유 입력 없음) → 개인정보를 받지 않는다.
-- 고객은 추가만, 관리자만 읽는다. 폭주를 막으려고 10분에 500건을 넘으면 거절한다.

create table public.recommendation_feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (char_length(event) <= 20),
  relation text not null check (char_length(relation) <= 20),
  budget_max integer check (budget_max between 0 and 100000000),
  quantity integer check (quantity between 1 and 100000),
  result_product_nos integer[] not null check (cardinality(result_product_nos) <= 10),
  helpful boolean not null,
  reasons text[] not null default '{}'
    check (reasons <@ array['price', 'formality', 'kind', 'quantity', 'other']::text[] and cardinality(reasons) <= 5),
  model_version text check (char_length(model_version) <= 20)
);
create index recommendation_feedback_created_at_idx on public.recommendation_feedback (created_at desc);

create or replace function private.feedback_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.recommendation_feedback where created_at > now() - interval '10 minutes') >= 500 then
    raise exception '의견이 너무 많이 들어오고 있습니다. 잠시 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.feedback_throttle() from public;

create trigger feedback_throttle
  before insert on public.recommendation_feedback
  for each row execute function private.feedback_throttle();

alter table public.recommendation_feedback enable row level security;
create policy "누구나 의견 남기기" on public.recommendation_feedback
  for insert to anon, authenticated with check (true);
create policy "관리자 의견 읽기" on public.recommendation_feedback
  for select to authenticated using ((select private.is_admin()));
grant insert on public.recommendation_feedback to anon, authenticated;
grant select on public.recommendation_feedback to authenticated;

-- ---------- 보강: 고객이 넣는 행의 시각은 DB가 찍는다 ----------
-- 접수 시각을 미래로 넣어 '최근 10분 n건' 제한을 영구히 막거나, 실적 기간을 속이는 것을 막는다
create or replace function private.pin_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

revoke all on function private.pin_created_at() from public;

create trigger recommendation_logs_pin
  before insert on public.recommendation_logs
  for each row execute function private.pin_created_at();
create trigger recommendation_feedback_pin
  before insert on public.recommendation_feedback
  for each row execute function private.pin_created_at();

-- 디자인 접수: 시각을 찍고, 상품명·포장 이름은 DB에 있는 값으로 채운다. 없는 상품이면 거절
-- (트리거는 이름 순서로 돈다: designs_pin_insert → designs_status_changed → designs_throttle)
create or replace function private.designs_pin_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pname text;
  sname text;
begin
  new.created_at := now();
  new.updated_at := now();
  select p.name into pname from public.products p where p.product_no = new.product_no;
  if pname is null then
    raise exception '없는 상품입니다.' using errcode = '23503';
  end if;
  new.product_name := left(pname, 200);
  if new.style_id is not null then
    select s.name into sname from public.packaging_styles s where s.id = new.style_id;
    if sname is not null then
      new.style_name := sname;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.designs_pin_insert() from public;

create trigger designs_pin_insert
  before insert on public.designs
  for each row execute function private.designs_pin_insert();
