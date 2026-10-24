import { getOperationalHealth } from '@/data/operations-repository.ts';
import { kstLabel } from '@/lib/kst.ts';

export const dynamic = 'force-dynamic';
export default async function HealthPage() {
  let health;
  try { health = await getOperationalHealth(); }
  catch { return <section className="panel" role="alert"><h1>운영 상태를 확인할 수 없습니다</h1><p>DB 연결과 20261027000000_integrated_improvements.sql 적용을 확인해 주세요. 이 상태를 정상으로 판단하지 않았습니다.</p><a href="/admin/health">다시 확인</a></section>; }
  const stale = !health.lastSync || Date.now() - Date.parse(health.lastSync) > 36 * 3600000;
  const ready = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32 && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return <div style={{ display: 'grid', gap: 20 }}>
    <header className="page-head"><h1>운영 상태</h1><p>상품 갱신, 저장 실패와 예약 작업의 설정 상태를 확인합니다. 최근 50건과 최근 24시간 오류 수입니다.</p></header>
    <section className="panel"><h2>연결과 갱신</h2><p>DB 버전: {health.schemaVersion} · 상품 {health.productCount}개</p><p>최근 갱신: {health.lastSync ? kstLabel(health.lastSync) : '기록 없음'} {stale && <b> — 36시간 이상 지났습니다</b>}</p><p>예약 작업 설정: {health.schemaVersion === 'local' ? '로컬 시험 모드' : ready ? '설정 있음 — 예약 실행 기록도 확인해 주세요' : '미설정 — CRON_SECRET와 서버 전용 키 필요'}</p><p>최근 24시간 오류: {health.errors24h}건</p><p className="small muted">설정 유무만으로 정상 실행을 보장하지 않습니다. 외부 점검과 백업 복구 시험은 배포 점검표에 따라 별도로 확인해 주세요.</p></section>
    <section className="panel"><h2>최근 작업</h2>{health.events.length ? <table className="data"><thead><tr><th>시각</th><th>작업</th><th>결과</th><th>분류</th><th>시간</th></tr></thead><tbody>{health.events.map((e, i) => <tr key={i}><td>{kstLabel(e.created_at)}</td><td>{e.operation}</td><td>{e.outcome === 'ok' ? '성공' : '확인 필요'}</td><td>{e.code}</td><td>{e.duration_ms}ms</td></tr>)}</tbody></table> : <p>저장된 작업 기록이 없습니다. 서버 로그의 ondap_operation도 확인해 주세요.</p>}</section>
  </div>;
}
