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
