-- OD-08/13/21/26/30. 기존 자료를 유지하는 추가 변경. 운영 적용 순서는 docs/INTEGRATED-ROLLOUT.md.
alter table public.recommendation_feedback add column request_id uuid unique;
alter table public.packaging_styles add column targeting jsonb not null default '{}'::jsonb check (pg_column_size(targeting) < 4096);
alter table public.design_images add column targeting jsonb not null default '{}'::jsonb check (pg_column_size(targeting) < 4096);
alter table public.design_texts add column targeting jsonb not null default '{}'::jsonb check (pg_column_size(targeting) < 4096);

create table public.operation_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  operation text not null check (operation in ('catalog_sync','catalog_read','recommendation_log','feedback_save','design_save','design_lookup','print_export','health_check')),
  outcome text not null check (outcome in ('ok','error')),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  duration_ms integer not null check (duration_ms between 0 and 3600000)
);
create index operation_events_created_at_idx on public.operation_events (created_at desc);
alter table public.operation_events enable row level security;
create policy "관리자 운영 기록 읽기" on public.operation_events for select to authenticated using ((select private.is_admin()));
create policy "관리자 운영 기록 추가" on public.operation_events for insert to authenticated with check ((select private.is_admin()));
grant select, insert on public.operation_events to authenticated;
grant select, insert, delete on public.operation_events to service_role;
grant usage, select on sequence public.operation_events_id_seq to authenticated, service_role;

-- 통신 응답을 잃고 재시도해도 한 건만. 고객은 이 함수를 통해 기존 행을 읽을 수 없다.
create or replace function public.submit_feedback(p_request_id uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_request_id is null or p_payload->>'event' not in ('funeral','wedding','longevity','birth','promotion','opening','thanks','birthday')
    or p_payload->>'relation' not in ('senior','business','peer','family') then raise exception '잘못된 의견 정보입니다.'; end if;
  if exists(select 1 from public.recommendation_feedback where request_id = p_request_id) then return true; end if;
  insert into public.recommendation_feedback(request_id,event,relation,budget_max,quantity,result_product_nos,helpful,reasons,model_version)
  values(p_request_id,p_payload->>'event',p_payload->>'relation',(p_payload->>'budget_max')::integer,(p_payload->>'quantity')::integer,
    array(select jsonb_array_elements_text(p_payload->'result_product_nos')::integer), (p_payload->>'helpful')::boolean,
    array(select jsonb_array_elements_text(p_payload->'reasons')),p_payload->>'model_version')
  on conflict (request_id) do nothing;
  return true;
end; $$;
revoke all on function public.submit_feedback(uuid,jsonb) from public;
grant execute on function public.submit_feedback(uuid,jsonb) to anon, authenticated;

-- 단일 트랜잭션, 버전 검사, 대량 누락 방어. 지표·기존 접수는 지우지 않는다.
create or replace function public.sync_product_snapshot(p_products jsonb, p_expected_synced_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; old_n integer; removed integer; current_version timestamptz;
begin
  if not private.is_admin() and coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception '관리자만 상품을 갱신할 수 있습니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(7823442);
  lock table public.products in share row exclusive mode;
  select max(synced_at), count(*) into current_version, old_n from public.products;
  if current_version is distinct from p_expected_synced_at then raise exception '다른 작업에서 상품이 갱신됐습니다. 다시 가져와 주세요.'; end if;
  if jsonb_typeof(p_products) is distinct from 'array' then raise exception '상품 목록 형식이 올바르지 않습니다.'; end if;
  n := jsonb_array_length(p_products);
  if n < 1 or n > 20000 then raise exception '빈 상품 목록 또는 허용 범위 초과입니다.'; end if;
  if (select count(distinct x.product_no) from jsonb_to_recordset(p_products) as x(product_no integer)) <> n then raise exception '중복되거나 잘못된 상품번호입니다.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_products) as x(product_no integer,name text,price integer,display boolean,selling boolean,sold_out boolean,url text)
    where x.product_no is null or x.product_no < 1 or x.price is null or x.price < 0 or nullif(trim(x.name),'') is null or x.display is null or x.selling is null or x.sold_out is null or x.url is null or x.url !~ '^https://') then raise exception '잘못된 상품 정보입니다.'; end if;
  select count(*) into removed from public.products p where not exists(select 1 from jsonb_to_recordset(p_products) as x(product_no integer) where x.product_no=p.product_no);
  if old_n > 0 and removed::numeric/old_n > 0.2 then raise exception '상품의 20%% 넘게 사라져 갱신을 중단했습니다.'; end if;
  insert into public.products(product_no,name,price,display,selling,sold_out,image,detail_image,url,synced_at)
  select x.product_no,x.name,x.price,x.display,x.selling,x.sold_out,x.image,x.detail_image,x.url,clock_timestamp()
  from jsonb_to_recordset(p_products) as x(product_no integer,name text,price integer,display boolean,selling boolean,sold_out boolean,image text,detail_image text,url text)
  on conflict(product_no) do update set name=excluded.name,price=excluded.price,display=excluded.display,selling=excluded.selling,sold_out=excluded.sold_out,
    image=excluded.image,detail_image=excluded.detail_image,url=excluded.url,synced_at=excluded.synced_at;
  delete from public.products p where not exists(select 1 from jsonb_to_recordset(p_products) as x(product_no integer) where x.product_no=p.product_no);
  insert into public.operation_events(operation,outcome,code,duration_ms) values('catalog_sync','ok','ok',0);
  return n;
end; $$;
revoke all on function public.sync_product_snapshot(jsonb,timestamptz) from public;
grant execute on function public.sync_product_snapshot(jsonb,timestamptz) to authenticated, service_role;

-- 실적은 원시 행 개수/HTTP 응답 상한과 무관하게 DB에서 집계한다. 고객은 실행 불가.
create or replace function public.admin_stats(p_from date, p_to date, p_result_count integer default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception '관리자만 실적을 읽을 수 있습니다.' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to-p_from > 399 or p_result_count is null or p_result_count not between 1 and 10 then raise exception '기간 또는 추천 개수가 올바르지 않습니다. 최대 400일입니다.'; end if;
  with rec as materialized (select * from public.recommendation_logs where created_at >= p_from::timestamp at time zone 'Asia/Seoul' and created_at < (p_to+1)::timestamp at time zone 'Asia/Seoul'),
  des as materialized (select * from public.designs where status <> 'canceled' and created_at >= p_from::timestamp at time zone 'Asia/Seoul' and created_at < (p_to+1)::timestamp at time zone 'Asia/Seoul'),
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
revoke all on function public.admin_stats(date,date,integer) from public;
grant execute on function public.admin_stats(date,date,integer) to authenticated;

create or replace function public.operational_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() and coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception '관리자만 상태를 읽을 수 있습니다.' using errcode='42501'; end if;
  if to_regprocedure('public.submit_feedback(uuid,jsonb)') is null
    or to_regprocedure('public.sync_product_snapshot(jsonb,timestamp with time zone)') is null
    or to_regprocedure('public.admin_stats(date,date,integer)') is null
    or to_regprocedure('public.export_application_snapshot()') is null
    or (select count(*) from information_schema.columns where table_schema='public' and
      ((table_name='recommendation_feedback' and column_name='request_id') or (table_name in ('packaging_styles','design_images','design_texts') and column_name='targeting'))) <> 4
  then raise exception '운영 DB 변경 일부가 누락됐습니다.'; end if;
  return jsonb_build_object('schemaVersion','20261027','lastSync',(select max(synced_at) from public.products),
    'productCount',(select count(*) from public.products),'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') from
      (select created_at,operation,outcome,code,duration_ms from public.operation_events where created_at>now()-interval '7 days' order by created_at desc limit 50) e),
    'errors24h',(select count(*) from public.operation_events where outcome='error' and created_at>now()-interval '1 day'));
end; $$;
revoke all on function public.operational_health() from public;
grant execute on function public.operational_health() to authenticated, service_role;

-- 애플리케이션 자료를 한 읽기 스냅샷으로 내보낸다. 파일은 별도로 SHA-256과 함께 보관한다.
-- 인증 사용자·키·관리자 계정은 Supabase 자체 백업/복구 절차의 대상이다.
create or replace function public.export_application_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare output jsonb := '{}'::jsonb; table_name text; rows jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception '서버 백업 작업만 실행할 수 있습니다.' using errcode='42501'; end if;
  foreach table_name in array array['products','product_attributes','engine_config','scenario_expectations','packaging_styles','design_images','design_texts','designs','recommendation_logs','recommendation_feedback','product_attributes_history'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',table_name) into rows;
    output := output || jsonb_build_object(table_name,rows);
  end loop;
  return jsonb_build_object('schemaVersion','20261027','capturedAt',now(),'tables',output);
end; $$;
revoke all on function public.export_application_snapshot() from public;
grant execute on function public.export_application_snapshot() to service_role;
