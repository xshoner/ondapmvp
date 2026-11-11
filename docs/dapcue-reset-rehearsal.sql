-- 리허설 전용: 복제/격리 DB에서만 실행. 실제 운영 DB에는 실행하지 않는다.
-- 전체 복구 가능한 백업과 쓰기 중지, 사용자 실행 요청이 선행되어야 한다.
-- 이 파일은 기본적으로 ROLLBACK하며 스토리지 파일과 공통 설정은 건드리지 않는다.
begin;

lock table public.products, public.product_attributes, public.product_evidence,
  public.product_attributes_history, public.scenario_expectations, public.designs,
  public.approval_drafts, public.recommendation_logs, public.recommendation_feedback,
  public.cafe24_payment_events in access exclusive mode;

do $$
begin
  if current_setting('ondap.rehearsal', true) is distinct from 'isolated-dapcue' then
    raise exception '격리 DB 리허설 확인값이 없습니다.';
  end if;
  if not exists (select 1 from public.products)
     or exists (select 1 from public.products where url !~ '^https://axopenlab\.cafe24\.com/') then
    raise exception '기존 상품 출처가 예상과 달라 중단합니다.';
  end if;
end $$;

delete from public.cafe24_payment_events;
delete from public.approval_drafts;
delete from public.designs;
delete from public.recommendation_feedback;
delete from public.recommendation_logs;
delete from public.scenario_expectations;
delete from public.product_evidence;
delete from public.product_attributes;
-- 상품 지표 DELETE 트리거가 이력을 추가하므로 지표 삭제 이후 정리한다.
delete from public.product_attributes_history;
delete from public.products;

-- 리허설 후 원본 복원. 실제 전환용 SQL로 바로 사용하지 않는다.
rollback;
