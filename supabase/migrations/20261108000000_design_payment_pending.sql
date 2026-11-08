-- 기존 접수는 보존하고, 새 디자인은 결제 확인 전까지 접수로 취급하지 않는다.
alter table public.designs drop constraint designs_status_check;
alter table public.designs add constraint designs_status_check
  check (status in ('pending','received','order_confirmed','printed','canceled'));
alter table public.designs alter column status set default 'pending';

drop policy "누구나 디자인 접수" on public.designs;
create policy "누구나 디자인 접수" on public.designs
  for insert to anon, authenticated
  with check (status = 'pending' and order_no is null and memo = '' and source_code is null);

-- 결제·옵션을 서버가 검증한 다음에만 호출한다. 고객과 관리자 계정에는 실행 권한을 주지 않는다.
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
  if d.status in ('order_confirmed','printed') and d.order_no = p_order_no then
    return 'already_confirmed';
  end if;
  -- pending 뿐 아니라 이전 received 상태인 미연결 건도 정상 결제 확인 시 전환 허용
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
grant select, insert, update, delete on public.designs to service_role;

-- 카페24 관리자 OAuth 토큰 저장소: 서버(service_role)만 접근 허용
create table if not exists public.cafe24_tokens (
  mall_id text primary key,
  shop_no integer not null default 1 check (shop_no > 0),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  scope text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.cafe24_tokens enable row level security;
revoke all on public.cafe24_tokens from anon, authenticated;
grant select, insert, update, delete on public.cafe24_tokens to service_role;

-- 주문 조회 재시도를 위한 대기열: 주문자 개인정보는 저장하지 않는다.
create table if not exists public.cafe24_payment_events (
  shop_no integer not null check (shop_no > 0),
  order_no text not null check (order_no ~ '^20[0-9]{6}-[0-9]{7}$'),
  event_no integer not null default 90025,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'waiting_payment', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  locked_at timestamptz,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_no, order_no)
);
alter table public.cafe24_payment_events enable row level security;
revoke all on public.cafe24_payment_events from anon, authenticated;
grant select, insert, update, delete on public.cafe24_payment_events to service_role;

-- 동시성 충돌 없이 결제 이벤트를 가져와 처리할 수 있도록 원자적 잠금 배정
create or replace function public.claim_payment_events(p_limit integer default 10)
returns setof public.cafe24_payment_events language plpgsql security definer set search_path = '' as $$
begin
  return query
  with target as (
    select shop_no, order_no
    from public.cafe24_payment_events
    where (status in ('pending', 'waiting_payment') or (status = 'processing' and locked_at < now() - interval '3 minutes'))
      and attempts < 10
    order by received_at asc
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  update public.cafe24_payment_events e
  set status = 'processing', attempts = e.attempts + 1, locked_at = now(), updated_at = now()
  from target
  where e.shop_no = target.shop_no and e.order_no = target.order_no
  returning e.*;
end;
$$;
revoke all on function public.claim_payment_events(integer) from public, anon, authenticated;
grant execute on function public.claim_payment_events(integer) to service_role;

create or replace function public.admin_stats(p_from date, p_to date, p_result_count integer default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception '관리자만 실적을 읽을 수 있습니다.' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to-p_from > 399 or p_result_count is null or p_result_count not between 1 and 10 then raise exception '기간 또는 추천 개수가 올바르지 않습니다. 최대 400일입니다.'; end if;
  with rec as materialized (select * from public.recommendation_logs where created_at >= p_from::timestamp at time zone 'Asia/Seoul' and created_at < (p_to+1)::timestamp at time zone 'Asia/Seoul'),
  des as materialized (select * from public.designs where status not in ('canceled','pending') and created_at >= p_from::timestamp at time zone 'Asia/Seoul' and created_at < (p_to+1)::timestamp at time zone 'Asia/Seoul'),
  fb as materialized (select * from public.recommendation_feedback where created_at >= p_from::timestamp at time zone 'Asia/Seoul' and created_at < (p_to+1)::timestamp at time zone 'Asia/Seoul'),
  days as (select d::date as day from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d),
  rd as (select (created_at at time zone 'Asia/Seoul')::date as day,count(*) as n from rec group by 1),
  dd as (select (created_at at time zone 'Asia/Seoul')::date as day,count(*) as n from des group by 1),
  ranks as (select x.no as no,count(*) filter(where x.ord=1) as first,count(*) as top3 from rec cross join lateral unnest(result_product_nos) with ordinality x(no,ord) group by x.no),
  demand as (select event,relation,
    case when budget_max is null then '예산 상관없음' when budget_max<=30000 then '3만 원 이하' when budget_max<=50000 then '5만 원 이하' when budget_max<=100000 then '10만 원 이하' when budget_max<=200000 then '20만 원 이하' else '20만 원 넘게' end as band,
    count(*) as total, count(*) filter(where cardinality(result_product_nos)<p_result_count) as short,
    count(*) filter(where cardinality(result_product_nos)>=p_result_count and budget_max is not null and exists(select 1 from public.products p where p.product_no=any(result_product_nos) and p.price>budget_max)) as relaxed
    from rec group by 1,2,3)
  select jsonb_build_object('summary',jsonb_build_object(
    'days',(select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'recommendations',coalesce(rd.n,0),'designs',coalesce(dd.n,0)) order by d.day),'[]') from days d left join rd using(day) left join dd using(day)),
    'totals',jsonb_build_object('recommendations',(select count(*) from rec),'designs',(select count(*) from des),'ordered',(select count(*) from des where nullif(order_no,'') is not null or status in ('order_confirmed','printed')),'printed',(select count(*) from des where status='printed'),'withSticker',(select count(*) from des where sticker is not null)),
    'byEvent',(select coalesce(jsonb_agg(jsonb_build_object('id',event,'count',n) order by n desc,event),'[]') from (select event,count(*) n from rec group by event) a),
    'byRelation',(select coalesce(jsonb_agg(jsonb_build_object('id',relation,'count',n) order by n desc,relation),'[]') from (select relation,count(*) n from rec group by relation) a),
    'topProducts',(select coalesce(jsonb_agg(jsonb_build_object('productNo',no,'first',first,'top3',top3) order by first desc,top3 desc,no),'[]') from (select * from ranks order by first desc,top3 desc,no limit 10) a)),
    'feedback',jsonb_build_object('total',(select count(*) from fb),'helpful',(select count(*) from fb where helpful),
      'reasons',(select coalesce(jsonb_agg(jsonb_build_object('id',reason,'count',n) order by n desc,reason),'[]') from (select reason,count(*) n from fb cross join lateral unnest(reasons) reason where not helpful group by reason) a),
      'byEvent',(select coalesce(jsonb_agg(jsonb_build_object('id',event,'total',n,'helpful',yes) order by event),'[]') from (select event,count(*) n,count(*) filter(where helpful) yes from fb group by event) a)),
    'unmet',(select coalesce(jsonb_agg(jsonb_build_object('event',event,'relation',relation,'band',band,'total',total,'short',short,'relaxed',relaxed) order by short+relaxed desc,total desc,event,relation,band),'[]') from (select * from demand where short+relaxed>0 order by short+relaxed desc,total desc,event,relation,band limit 10) a)) into result;
  return result;
end; $$;
