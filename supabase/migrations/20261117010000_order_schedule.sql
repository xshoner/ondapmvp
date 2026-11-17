-- 행사일(event_date) 및 희망 수령일(desired_delivery_date) 컬럼 추가
alter table public.designs add column if not exists event_date text;
alter table public.designs add column if not exists desired_delivery_date text;

-- 희망 수령일 기준 빠른 조회를 위한 부분 인덱스
create index if not exists designs_desired_delivery_date_idx on public.designs (desired_delivery_date) where desired_delivery_date is not null;

-- 제작 상태 체크 제약조건 갱신: completed(포장 완료), no_packaging(포장 없음) 정식 추가
alter table public.designs drop constraint if exists designs_status_check;
alter table public.designs add constraint designs_status_check
  check (status in ('pending', 'received', 'order_confirmed', 'printed', 'completed', 'no_packaging', 'canceled'));

-- 업로드 세션 완료 RPC 갱신: eventDate와 desiredDeliveryDate 반영
create or replace function public.finish_design_upload(p_session_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.design_upload_sessions%rowtype;
begin
  select * into s from public.design_upload_sessions where id = p_session_id for update;
  if not found then raise exception '업로드 세션을 찾을 수 없습니다.'; end if;
  if s.status = 'completed' then return s.code; end if;
  if s.status <> 'pending' or s.expires_at <= now() then
    raise exception '업로드 세션이 만료되었거나 완료할 수 없습니다.';
  end if;
  insert into public.designs (
    code, product_no, product_name, quantity, event, style_id, style_name,
    sticker, draft, print_path, card, card_draft, card_print_path,
    event_date, desired_delivery_date
  )
  values (
    s.code, (s.meta->>'productNo')::integer, s.meta->>'productName', (s.meta->>'quantity')::integer,
    s.meta->>'event', nullif(s.meta->>'styleId', '')::uuid, s.meta->>'styleName',
    nullif(s.meta->'sticker', 'null'::jsonb), nullif(s.meta->'draft', 'null'::jsonb),
    case when s.files_expected ? 'sticker' then s.code || '.png' end,
    nullif(s.meta->'card', 'null'::jsonb), nullif(s.meta->'cardDraft', 'null'::jsonb),
    case when s.files_expected ? 'card' then s.code || '-card.png' end,
    nullif(s.meta->>'eventDate', ''),
    nullif(s.meta->>'desiredDeliveryDate', '')
  );
  update public.design_upload_sessions set status = 'completed' where id = s.id;
  return s.code;
end;
$$;
revoke all on function public.finish_design_upload(text) from public, anon, authenticated;
grant execute on function public.finish_design_upload(text) to service_role;

-- 다시 주문 RPC 갱신: 원본 디자인의 event_date, desired_delivery_date 보존
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
    source_code,
    event_date, desired_delivery_date
  )
  values (
    p_new_code, src.product_no, src.product_name, p_quantity, src.event, src.style_id, src.style_name,
    src.sticker, src.draft, null,
    src.card, src.card_draft, null,
    case when (src.print_path is not null or src.card_print_path is not null) then src.code else src.source_code end,
    src.event_date, src.desired_delivery_date
  );
  return p_new_code;
end;
$$;
revoke all on function public.reorder_design(text, text, integer) from public;
grant execute on function public.reorder_design(text, text, integer) to anon, authenticated;

-- 결제 승인 RPC 갱신: 이미 confirmed/printed/completed/no_packaging인 건에 대해 일관되게 already_confirmed 처리
create or replace function public.accept_paid_design(p_code text, p_order_no text, p_product_no integer, p_quantity integer)
returns text language plpgsql security definer set search_path = '' as $$
declare d public.designs%rowtype;
begin
  if p_code is null or p_code !~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'
     or p_order_no is null or p_order_no !~ '^20[0-9]{6}-[0-9]{7}$'
     or p_product_no is null or p_product_no < 1 or p_quantity is null or p_quantity < 1 then
    raise exception '결제 확인 정보가 올바르지 않습니다.' using errcode = '22023';
  end if;
  select * into d from public.designs where code = p_code for update;
  if not found or d.product_no <> p_product_no or d.quantity <> p_quantity then
    return 'mismatch';
  end if;
  if d.status in ('order_confirmed', 'printed', 'completed', 'no_packaging') and d.order_no = p_order_no then
    return 'already_confirmed';
  end if;
  if d.status not in ('pending', 'received') or d.order_no is not null then
    return 'conflict';
  end if;
  update public.designs set status = 'order_confirmed', order_no = p_order_no, updated_at = now()
  where code = p_code;
  return 'confirmed';
end;
$$;
revoke all on function public.accept_paid_design(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.accept_paid_design(text,text,integer,integer) to service_role;
