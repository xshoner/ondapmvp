-- 고객 '내 디자인 다시 보기': 디자인 코드로 접수 요약을 조회한다
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만)
--
-- designs 표는 관리자만 읽을 수 있으므로, 코드가 정확히 맞는 한 건의 요약만 돌려주는 함수를 따로 연다.
-- 코드는 32글자 × 8자리(약 1조 가지)라 추측으로 찾기 어렵고, 서버에서 조회 횟수도 제한한다.
-- 취소된 접수와 편집 내용(draft)·인쇄 파일 경로·주문번호·메모는 돌려주지 않는다.

create or replace function public.lookup_design(p_code text)
returns table (
  code text,
  created_at timestamptz,
  product_no integer,
  product_name text,
  quantity integer,
  style_name text,
  sticker jsonb,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.code, d.created_at, d.product_no, d.product_name, d.quantity, d.style_name, d.sticker, d.status
  from public.designs d
  where d.code = upper(trim(p_code)) and d.status <> 'canceled';
$$;

revoke all on function public.lookup_design(text) from public;
grant execute on function public.lookup_design(text) to anon, authenticated;
