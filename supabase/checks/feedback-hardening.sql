-- Supabase SQL Editor에서 실행. 조회만 수행하며 데이터를 변경하지 않습니다.
-- 모든 항목이 true이면 20261026000000_feedback_hardening.sql의 주요 구성요소가 있습니다.
select '고객 의견 표' as 항목,
       to_regclass('public.recommendation_feedback') is not null as 적용됨
union all
select '고객 의견 날짜 인덱스', to_regclass('public.recommendation_feedback_created_at_idx') is not null
union all
select '의견 횟수 제한 함수', to_regprocedure('private.feedback_throttle()') is not null
union all
select '접수 시각 고정 함수', to_regprocedure('private.pin_created_at()') is not null
union all
select '접수 상품명 고정 함수', to_regprocedure('private.designs_pin_insert()') is not null
union all
select '고객 의견 횟수 제한 트리거', exists (
  select 1 from pg_trigger where tgrelid = to_regclass('public.recommendation_feedback')
    and tgname = 'feedback_throttle' and tgenabled <> 'D' and not tgisinternal
)
union all
select '추천 기록 시각 고정 트리거', exists (
  select 1 from pg_trigger where tgrelid = to_regclass('public.recommendation_logs')
    and tgname = 'recommendation_logs_pin' and tgenabled <> 'D' and not tgisinternal
)
union all
select '고객 의견 시각 고정 트리거', exists (
  select 1 from pg_trigger where tgrelid = to_regclass('public.recommendation_feedback')
    and tgname = 'recommendation_feedback_pin' and tgenabled <> 'D' and not tgisinternal
)
union all
select '접수 정보 고정 트리거', exists (
  select 1 from pg_trigger where tgrelid = to_regclass('public.designs')
    and tgname = 'designs_pin_insert' and tgenabled <> 'D' and not tgisinternal
)
union all
select '고객 의견 행 접근 보호', exists (
  select 1 from pg_class where oid = to_regclass('public.recommendation_feedback') and relrowsecurity
)
union all
select '고객 의견 추가 정책', exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'recommendation_feedback'
    and policyname = '누구나 의견 남기기' and cmd = 'INSERT'
)
union all
select '관리자 의견 조회 정책', exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'recommendation_feedback'
    and policyname = '관리자 의견 읽기' and cmd = 'SELECT'
);
