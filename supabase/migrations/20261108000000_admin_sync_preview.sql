-- 20261108000000_admin_sync_preview.sql
-- 관리자 검토 후 카페24 상품 수동 동기화 안전 적용 함수
-- 기존 sync_product_snapshot(jsonb, timestamptz)는 20% 보호 및 권한을 그대로 유지하며,
-- 관리자 명시적 수동 동기화는 서버(requireAdmin) 검증 후 service_role만 실행 가능한 전용 함수로 처리합니다.

create or replace function public.apply_admin_product_sync(
  p_products jsonb,
  p_expected_synced_at timestamptz,
  p_preview_token text default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  old_n integer;
  current_version timestamptz;
begin
  -- 1. 오직 service_role만 실행 가능 (authenticated 직접 호출 차단)
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception '관리자 서버 액션(service_role)만 수동 동기화를 적용할 수 있습니다.' using errcode='42501';
  end if;

  -- 2. 동시 수정 방지용 advisory lock 및 테이블 배타 잠금
  perform pg_advisory_xact_lock(7823442);
  lock table public.products in share row exclusive mode;

  -- 3. 스냅샷 시점(버전) 일치 검사 (동시 수정 방어)
  select max(synced_at), count(*) into current_version, old_n from public.products;
  if current_version is distinct from p_expected_synced_at then
    raise exception '다른 작업에서 상품이 갱신됐습니다. 최신 상태를 다시 확인해 주세요.';
  end if;

  -- 4. 빈/부분 응답 및 형식 유효성 검사
  if jsonb_typeof(p_products) is distinct from 'array' then
    raise exception '상품 목록 형식이 올바르지 않습니다.';
  end if;
  n := jsonb_array_length(p_products);
  if n < 1 or n > 20000 then
    raise exception '빈 상품 목록이거나 허용 범위를 벗어났습니다. 기존 목록을 유지합니다.';
  end if;

  -- 5. 중복 상품번호 검사
  if (select count(distinct x.product_no) from jsonb_to_recordset(p_products) as x(product_no integer)) <> n then
    raise exception '중복되거나 잘못된 상품번호입니다.';
  end if;

  -- 6. 개별 상품 필드 검증 (가격, 이름, 불리언 플래그, HTTPS URL)
  if exists (
    select 1 from jsonb_to_recordset(p_products) as x(
      product_no integer,
      name text,
      price integer,
      display boolean,
      selling boolean,
      sold_out boolean,
      url text
    )
    where x.product_no is null or x.product_no < 1
       or x.price is null or x.price < 0
       or nullif(trim(x.name), '') is null
       or x.display is null or x.selling is null or x.sold_out is null
       or x.url is null or x.url !~ '^https://'
  ) then
    raise exception '유효하지 않은 상품 정보가 포함되어 있습니다.';
  end if;

  -- 7. 상품 테이블 반영 (upsert)
  insert into public.products(product_no, name, price, display, selling, sold_out, image, detail_image, url, synced_at)
  select x.product_no, x.name, x.price, x.display, x.selling, x.sold_out, x.image, x.detail_image, x.url, clock_timestamp()
  from jsonb_to_recordset(p_products) as x(
    product_no integer,
    name text,
    price integer,
    display boolean,
    selling boolean,
    sold_out boolean,
    image text,
    detail_image text,
    url text
  )
  on conflict(product_no) do update set
    name = excluded.name,
    price = excluded.price,
    display = excluded.display,
    selling = excluded.selling,
    sold_out = excluded.sold_out,
    image = excluded.image,
    detail_image = excluded.detail_image,
    url = excluded.url,
    synced_at = excluded.synced_at;

  -- 8. 카페24 공개 목록에서 사라진 상품은 products 테이블에서만 삭제 (product_evidence, product_attributes는 보존)
  delete from public.products p
  where not exists (
    select 1 from jsonb_to_recordset(p_products) as x(product_no integer)
    where x.product_no = p.product_no
  );

  -- 9. 감사 로그 기록 (operation_events CHECK 제약조건: operation='catalog_sync', outcome='ok', code='admin_override')
  insert into public.operation_events(operation, outcome, code, duration_ms)
  values ('catalog_sync', 'ok', 'admin_override', 0);

  return n;
end; $$;

-- 권한: public, anon, authenticated 모두 차단하고 오직 service_role에만 부여
revoke all on function public.apply_admin_product_sync(jsonb, timestamptz, text) from public;
revoke all on function public.apply_admin_product_sync(jsonb, timestamptz, text) from anon, authenticated;
grant execute on function public.apply_admin_product_sync(jsonb, timestamptz, text) to service_role;
