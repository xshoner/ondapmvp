-- 카드(엽서) 포장 디자인 지원 (74x50mm, 148x100mm)
-- 스티커와 카드를 독립적 또는 동시 선택 가능

-- 1. designs 표에 카드 관련 컬럼 추가
alter table public.designs add column if not exists card jsonb;
alter table public.designs add column if not exists card_draft jsonb check (card_draft is null or pg_column_size(card_draft) < 65536);
alter table public.designs add column if not exists card_print_path text check (card_print_path is null or char_length(card_print_path) <= 100);

-- 2. 카드 규격 제약: 74x50, 148x100만 허용
alter table public.designs drop constraint if exists designs_card_spec;
alter table public.designs add constraint designs_card_spec check (
  card is null or (
    jsonb_typeof(card) = 'object'
    and card ->> 'sizeMm' in ('74x50', '148x100')
  )
);

-- 3. 카드 인쇄 파일 이름은 반드시 '코드-card.png'
alter table public.designs drop constraint if exists designs_card_print_path_matches_code;
alter table public.designs add constraint designs_card_print_path_matches_code check (
  card_print_path is null or card_print_path = code || '-card.png'
);

-- 4. 원본 연결(source_code)이 있으면 직접 인쇄 파일을 갖지 않는다
alter table public.designs drop constraint if exists designs_one_print_file;
alter table public.designs add constraint designs_one_print_file check (
  (print_path is null and card_print_path is null) or source_code is null
);

-- 5. 저장소 정책: 스티커(.png) 및 카드(-card.png) 모두 업로드 허용
drop policy if exists "누구나 인쇄 파일 올리기" on storage.objects;
create policy "누구나 인쇄 파일 올리기" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'design-files' and name ~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}(-card)?\.png$');

-- 6. 고객 조회: 카드 규격 포함
drop function if exists public.lookup_design(text);
create function public.lookup_design(p_code text)
returns table (
  code text,
  created_at timestamptz,
  product_no integer,
  product_name text,
  quantity integer,
  style_name text,
  sticker jsonb,
  card jsonb,
  status text,
  status_changed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.code, d.created_at, d.product_no, d.product_name, d.quantity, d.style_name, d.sticker, d.card, d.status, d.status_changed_at
  from public.designs d
  where d.code = upper(trim(p_code));
$$;

revoke all on function public.lookup_design(text) from public;
grant execute on function public.lookup_design(text) to anon, authenticated;

-- 7. 같은 디자인으로 다시 주문: 카드 정보 및 인쇄 파일 참조 보존
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
  insert into public.designs (
    code, product_no, product_name, quantity, event, style_id, style_name,
    sticker, draft, print_path,
    card, card_draft, card_print_path,
    source_code
  )
  values (
    p_new_code, src.product_no, src.product_name, p_quantity, src.event, src.style_id, src.style_name,
    src.sticker, src.draft, null,
    src.card, src.card_draft, null,
    case when (src.print_path is not null or src.card_print_path is not null) then src.code else src.source_code end
  );
  return p_new_code;
end;
$$;

revoke all on function public.reorder_design(text, text, integer) from public;
grant execute on function public.reorder_design(text, text, integer) to anon, authenticated;
