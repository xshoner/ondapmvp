-- 메인 화면 '이번 달 답례 추천 n건' 한 줄: 이번 달(한국 시간) 추천 기록 건수만 돌려준다
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만)
-- recommendation_logs는 관리자만 읽을 수 있으므로, 숫자 하나만 내주는 함수를 따로 연다(개별 기록은 노출하지 않음).

create or replace function public.monthly_recommendation_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.recommendation_logs
  where created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
$$;

revoke all on function public.monthly_recommendation_count() from public;
grant execute on function public.monthly_recommendation_count() to anon, authenticated;
