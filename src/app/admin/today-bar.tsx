import { getDesignTodo } from '@/data/packaging-repository.ts';
import { LATE_DAYS, lateSince } from '@/packaging/design-filter.ts';

// 관리자 화면 맨 위 '오늘 할 일': 주문 확인 대기, 인쇄 대기, 늦어지는 건. 누르면 그 목록으로 간다
export async function TodayBar() {
  let todo;
  try {
    todo = await getDesignTodo(lateSince(Date.now()));
  } catch {
    return null; // 포장 표가 아직 없거나 읽기 실패: 다른 관리자 화면은 그대로 쓰게 숨긴다
  }
  const late = todo.staleReceived + todo.lateConfirmed;
  const list = '/admin/packaging?tab=designs';
  return (
    <nav className="today-bar" aria-label="오늘 할 일">
      <b>오늘 할 일</b>
      <a href={`${list}&status=received`}>주문 확인 대기 <b className="num">{todo.received}</b></a>
      <a href={`${list}&status=order_confirmed`}>인쇄 대기 <b className="num">{todo.confirmed}</b></a>
      <a href={`${list}&late=1`} className={late ? 'warn' : undefined} title={`접수 ${LATE_DAYS.received}일, 주문 확인 ${LATE_DAYS.order_confirmed}일이 지난 건`}>
        늦어지는 건 <b className="num">{late}</b>
      </a>
      {todo.received + todo.confirmed === 0 && <span className="muted">밀린 접수가 없습니다</span>}
      <a href="/admin/scan" className="today-scan">QR로 완료 처리</a>
    </nav>
  );
}
