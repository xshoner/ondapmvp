-- 카페24 주문 검증을 수행한 서버만 주문 연결 함수를 호출할 수 있다.
revoke all on function public.link_design_to_order(text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.link_design_to_order(text,text,integer,integer,integer) to service_role;
