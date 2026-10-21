-- 포장 디자인 보강 (코드 검토 반영)
-- 실행: Supabase 대시보드 > SQL Editor에 붙여넣고 Run (한 번만). 20261021000000_packaging.sql 다음에 실행.
--
-- 고객 저장은 로그인 없이 공개 키로 들어오므로, 누군가 서버를 거치지 않고 API로 직접 넣어도
-- 이상한 값이 들어가거나 접수가 폭주하지 않도록 DB에서 한 번 더 막는다.

-- 스티커 규격은 원형·사각 × 4·6cm만
alter table public.designs add constraint designs_sticker_spec check (
  sticker is null or (
    jsonb_typeof(sticker) = 'object'
    and sticker ->> 'shape' in ('circle', 'square')
    and sticker ->> 'sizeCm' in ('4', '6')
  )
);

-- 인쇄 파일 이름은 반드시 '코드.png'
alter table public.designs add constraint designs_print_path_matches_code check (print_path is null or print_path = code || '.png');

-- 접수 폭주 방지: 최근 10분 접수가 300건을 넘으면 새 접수를 거절 (평소 사용량의 수십 배)
create or replace function private.designs_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.designs where created_at > now() - interval '10 minutes') >= 300 then
    raise exception '디자인 접수가 너무 많습니다. 잠시 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.designs_throttle() from public;

create trigger designs_throttle
  before insert on public.designs
  for each row execute function private.designs_throttle();
