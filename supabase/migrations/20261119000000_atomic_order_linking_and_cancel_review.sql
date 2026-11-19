-- 20261119000000_atomic_order_linking_and_cancel_review.sql
-- 1. 부분 취소 확인(정상 진행) 사건 상태 기록 컬럼 추가
alter table public.designs add column if not exists reviewed_cancel_state text;

-- 2. 관리자 디자인 수동 연결 원자적 처리 및 주문 수량 초과 방지 RPC
create or replace function public.link_design_to_order(
  p_code text,
  p_order_no text,
  p_product_no integer,
  p_quantity integer,
  p_max_quantity integer
) returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.designs%rowtype;
  v_allocated integer;
begin
  if p_code is null or p_code !~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'
     or p_order_no is null or p_order_no !~ '^20[0-9]{6}-[0-9]{7}$'
     or p_product_no is null or p_product_no < 1
     or p_quantity is null or p_quantity < 1
     or p_max_quantity is null or p_max_quantity < p_quantity then
    raise exception '주문 연결 정보가 올바르지 않습니다.' using errcode = '22023';
  end if;

  -- 주문번호와 상품번호 단위의 원자적 트랜잭션 자문 잠금(advisory lock)
  perform pg_advisory_xact_lock(hashtext('ondap_order_prod:' || p_order_no || ':' || p_product_no::text));

  select * into d from public.designs where code = p_code for update;
  if not found or d.product_no <> p_product_no or d.quantity <> p_quantity then
    return 'mismatch';
  end if;

  if d.status = 'canceled' or d.cafe24_canceled then
    return 'canceled';
  end if;

  if d.status = 'pending' then
    return 'pending_not_allowed';
  end if;

  if d.order_no is not null and d.order_no <> p_order_no then
    return 'conflict';
  end if;

  if d.order_no = p_order_no then
    return 'already_linked';
  end if;

  select coalesce(sum(quantity), 0) into v_allocated
  from public.designs
  where order_no = p_order_no
    and product_no = p_product_no
    and code <> p_code
    and status <> 'canceled';

  if v_allocated + p_quantity > p_max_quantity then
    return 'exceeded';
  end if;

  update public.designs
  set order_no = p_order_no,
      updated_at = now()
  where code = p_code;

  return 'confirmed';
end;
$$;
revoke all on function public.link_design_to_order(text,text,integer,integer,integer) from public, anon;
grant execute on function public.link_design_to_order(text,text,integer,integer,integer) to service_role, authenticated;

-- 3. 자동 결제 확인 RPC 갱신: 동일한 자문 잠금 및 주문 수량 초과 방지 적용
create or replace function public.accept_paid_design(
  p_code text,
  p_order_no text,
  p_product_no integer,
  p_quantity integer,
  p_max_quantity integer default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.designs%rowtype;
  v_allocated integer;
  v_max integer;
begin
  if p_code is null or p_code !~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'
     or p_order_no is null or p_order_no !~ '^20[0-9]{6}-[0-9]{7}$'
     or p_product_no is null or p_product_no < 1
     or p_quantity is null or p_quantity < 1 then
    raise exception '결제 확인 정보가 올바르지 않습니다.' using errcode = '22023';
  end if;

  -- 주문번호와 상품번호 단위의 원자적 트랜잭션 자문 잠금
  perform pg_advisory_xact_lock(hashtext('ondap_order_prod:' || p_order_no || ':' || p_product_no::text));

  select * into d from public.designs where code = p_code for update;
  if not found or d.product_no <> p_product_no or d.quantity <> p_quantity then
    return 'mismatch';
  end if;
  if d.status in ('order_confirmed', 'printed', 'completed', 'no_packaging') and d.order_no = p_order_no then
    return 'already_confirmed';
  end if;
  if d.status not in ('pending', 'received') or (d.order_no is not null and d.order_no <> p_order_no) or d.cafe24_canceled then
    return 'conflict';
  end if;

  v_max := coalesce(p_max_quantity, p_quantity);

  select coalesce(sum(quantity), 0) into v_allocated
  from public.designs
  where order_no = p_order_no
    and product_no = p_product_no
    and code <> p_code
    and status <> 'canceled';

  if v_allocated + p_quantity > v_max then
    return 'exceeded';
  end if;

  update public.designs
  set status = 'order_confirmed',
      order_no = p_order_no,
      updated_at = now()
  where code = p_code;

  return 'confirmed';
end;
$$;
revoke all on function public.accept_paid_design(text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.accept_paid_design(text,text,integer,integer,integer) to service_role;
