-- 즉시 처리와 충돌하지 않도록 미처리 이벤트는 3분 후 재시도한다.
-- 미입금은 새 이벤트를 기다리면서 알림 누락에 대비해 1시간 후 재확인한다.
alter table public.cafe24_payment_events
  add column if not exists event_revision uuid not null default gen_random_uuid();

create or replace function public.claim_payment_events(p_limit integer default 10)
returns setof public.cafe24_payment_events language plpgsql security definer set search_path = '' as $$
begin
  return query
  with target as (
    select shop_no, order_no
    from public.cafe24_payment_events
    where attempts < 10 and (
      (status = 'pending' and received_at < now() - interval '3 minutes') or
      (status = 'waiting_payment' and updated_at < now() - interval '1 hour') or
      (status = 'processing' and locked_at < now() - interval '3 minutes')
    )
    order by received_at asc
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  update public.cafe24_payment_events e
  set status = 'processing', attempts = e.attempts + 1, locked_at = now(), updated_at = now()
  from target
  where e.shop_no = target.shop_no and e.order_no = target.order_no
  returning e.*;
end; $$;

revoke all on function public.claim_payment_events(integer) from public, anon, authenticated;
grant execute on function public.claim_payment_events(integer) to service_role;

create or replace function public.cancel_paid_designs(
  p_order_no text,
  p_code text default null,
  p_note text default '카페24 주문 취소/환불 확인'
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  row_rec public.designs%rowtype;
  has_printed boolean := false;
  canceled_count integer := 0;
  note_text text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_order_no is null or p_order_no !~ '^20[0-9]{6}-[0-9]{7}$' then
    raise exception '주문번호 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if p_code is not null and p_code !~ '^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
    raise exception '디자인 코드 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;

  for row_rec in
    select * from public.designs
    where order_no = p_order_no
    for update
  loop
    if row_rec.status = 'printed' then
      has_printed := true;
      if note_text is not null and strpos(coalesce(row_rec.memo, ''), p_order_no || ' 취소/환불 알림') = 0 then
        update public.designs
        set memo = left(concat_ws(E'\n', nullif(trim(memo), ''), '[주의: 주문 ' || p_order_no || ' 취소/환불 알림 — 인쇄 완료 건 확인 필요]'), 500),
            updated_at = now()
        where code = row_rec.code;
      end if;
    elsif row_rec.status in ('order_confirmed', 'received') then
      canceled_count := canceled_count + 1;
      update public.designs
      set status = 'canceled',
          memo = case
            when note_text is not null and strpos(coalesce(memo, ''), note_text) = 0
              then left(concat_ws(E'\n', nullif(trim(memo), ''), note_text), 500)
            else memo
          end,
          updated_at = now()
      where code = row_rec.code;
    end if;
  end loop;

  if has_printed then
    return 'printed_conflict';
  end if;
  if canceled_count > 0 then
    return 'canceled';
  end if;

  if p_code is not null then
    update public.designs
    set memo = left(replace(memo, '(무통장 입금 대기)', '(주문 취소)'), 500),
        updated_at = now()
    where code = p_code
      and status = 'pending'
      and order_no is null
      and strpos(coalesce(memo, ''), p_order_no) > 0
      and strpos(coalesce(memo, ''), '(무통장 입금 대기)') > 0;
    if found then
      return 'pending_updated';
    end if;
  end if;

  return 'noop';
end; $$;

revoke all on function public.cancel_paid_designs(text, text, text) from public, anon, authenticated;
grant execute on function public.cancel_paid_designs(text, text, text) to service_role;
