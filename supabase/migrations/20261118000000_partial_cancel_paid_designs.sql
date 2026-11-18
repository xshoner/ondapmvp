-- 주문 취소/부분 취소 반영 RPC 갱신:
-- p_code가 null이면 해당 주문(p_order_no)의 전체 디자인 취소/경고 처리
-- p_code가 지정되면 해당 디자인(p_code)만 취소/경고 처리하고 동일 주문의 다른 유효 품목은 온전히 유지
-- 중요: 주문번호가 일치하는 건(order_no = p_order_no)만 변경하고,
-- 주문번호 없는 pending(order_no is null and status = 'pending')은 메모에 해당 주문번호가 확인될 때만 대기 안내를 변경한다.
-- 다른 주문이나 주문 미연결 접수는 철저히 보호한다.
create or replace function public.cancel_paid_designs(
  p_order_no text,
  p_code text default null,
  p_note text default '카페24 주문 취소/환불 확인'
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  row_rec public.designs%rowtype;
  has_produced boolean := false;
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
    where (
      (p_code is null and (order_no = p_order_no or (order_no is null and status = 'pending' and strpos(coalesce(memo, ''), p_order_no) > 0)))
      or (p_code is not null and code = p_code and (order_no = p_order_no or (order_no is null and status = 'pending' and strpos(coalesce(memo, ''), p_order_no) > 0)))
    )
    for update
  loop
    if row_rec.order_no = p_order_no then
      if row_rec.status in ('printed', 'completed') then
        has_produced := true;
        update public.designs set cafe24_canceled = true, updated_at = now() where code = row_rec.code;
        if note_text is not null and strpos(coalesce(row_rec.memo, ''), p_order_no || ' 취소/환불 알림') = 0 then
          update public.designs
          set memo = left(concat_ws(E'\n', nullif(trim(memo), ''), '[주의: 주문 ' || p_order_no || ' 취소/환불 알림 — 제작/완료 건 확인 필요]'), 500),
              updated_at = now()
          where code = row_rec.code;
        end if;
      elsif row_rec.status in ('order_confirmed', 'received') then
        canceled_count := canceled_count + 1;
        update public.designs
        set status = 'canceled',
            cafe24_canceled = true,
            memo = case
              when note_text is not null and strpos(coalesce(memo, ''), note_text) = 0
                then left(concat_ws(E'\n', nullif(trim(memo), ''), note_text), 500)
              else memo
            end,
            updated_at = now()
        where code = row_rec.code;
      elsif row_rec.status = 'pending' and strpos(coalesce(row_rec.memo, ''), p_order_no) > 0 then
        update public.designs
        set memo = left(replace(memo, '(무통장 입금 대기)', '(주문 취소)'), 500),
            cafe24_canceled = true,
            updated_at = now()
        where code = row_rec.code;
        canceled_count := canceled_count + 1;
      end if;
    elsif row_rec.order_no is null and row_rec.status = 'pending' and strpos(coalesce(row_rec.memo, ''), p_order_no) > 0 then
      update public.designs
      set memo = left(replace(memo, '(무통장 입금 대기)', '(주문 취소)'), 500),
          cafe24_canceled = true,
          updated_at = now()
      where code = row_rec.code;
      canceled_count := canceled_count + 1;
    end if;
  end loop;

  if has_produced then
    return 'printed_conflict';
  end if;
  if canceled_count > 0 then
    return 'canceled';
  end if;

  return 'noop';
end;
$$;
revoke all on function public.cancel_paid_designs(text, text, text) from public, anon, authenticated;
grant execute on function public.cancel_paid_designs(text, text, text) to service_role;
