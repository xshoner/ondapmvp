import { getOperationalHealth } from '@/data/operations-repository.ts';
import { kstLabel } from '@/lib/kst.ts';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HealthPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const oauthStatus = typeof sp.oauth === 'string' ? sp.oauth : null;
  const oauthMsg = typeof sp.msg === 'string' ? decodeURIComponent(sp.msg) : null;

  let health;
  try {
    health = await getOperationalHealth();
  } catch {
    return (
      <section className="panel" role="alert">
        <h1>운영 상태를 확인할 수 없습니다</h1>
        <p>DB 연결과 20261027000000_integrated_improvements.sql 적용을 확인해 주세요. 이 상태를 정상으로 판단하지 않았습니다.</p>
        <a href="/admin/health">다시 확인</a>
      </section>
    );
  }

  const stale = !health.lastSync || Date.now() - Date.parse(health.lastSync) > 36 * 3600000;
  const ready = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32 && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const c24 = health.cafe24;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <header className="page-head">
        <h1>운영 상태</h1>
        <p>상품 갱신, 카페24 결제 접수 연동 및 예약 작업의 설정 상태를 확인합니다.</p>
      </header>

      {oauthStatus === 'connected' && (
        <div className="notice" style={{ background: '#eefbf3', borderColor: '#2e7d32', color: '#1b5e20' }}>
          카페24 관리자 OAuth 계정이 성공적으로 연동되었습니다.
        </div>
      )}
      {oauthStatus === 'error' && (
        <div className="notice" style={{ background: '#fdf2f2', borderColor: '#d32f2f', color: '#c62828' }}>
          카페24 연동 실패: {oauthMsg || '오류가 발생했습니다. 다시 시도해 주세요.'}
        </div>
      )}

      <section className="panel">
        <h2>카페24 결제 접수 연동</h2>
        <p>
          쇼핑몰 연동 대상: <b>{c24?.mallId || process.env.CAFE24_MALL_ID || '미설정'}</b>
        </p>
        <p>
          OAuth 인증 상태:{' '}
          {c24?.connected ? (
            c24.isExpired ? (
              <span style={{ color: '#d32f2f' }}>만료됨 (리프레시 또는 재연동 필요)</span>
            ) : (
              <span style={{ color: '#2e7d32' }}>정상 연결됨 (만료: {c24.expiresAt ? kstLabel(c24.expiresAt) : '확인중'})</span>
            )
          ) : (
            <span style={{ color: '#f57c00' }}>미연동 (연동 버튼을 눌러 인증을 완료해 주세요)</span>
          )}
        </p>
        <p>
          결제 대기열 현황: 처리 대기 <b>{c24?.pendingCount ?? 0}</b>건 · 입금 대기 <b>{c24?.waitingPaymentCount ?? 0}</b>건 · 확인 실패{' '}
          <b>{c24?.failedCount ?? 0}</b>건
        </p>
        <div style={{ marginTop: 12 }}>
          <a className="btn" href="/api/cafe24/authorize">
            {c24?.connected ? '카페24 관리자 계정 재연동' : '카페24 관리자 계정 연동하기'}
          </a>
        </div>
      </section>

      <section className="panel">
        <h2>연결과 갱신</h2>
        <p>
          DB 버전: {health.schemaVersion} · 상품 {health.productCount}개
        </p>
        <p>
          최근 갱신: {health.lastSync ? kstLabel(health.lastSync) : '기록 없음'}{' '}
          {stale && <b> — 36시간 이상 지났습니다</b>}
        </p>
        <p>
          예약 작업 설정:{' '}
          {health.schemaVersion === 'local'
            ? '로컬 시험 모드'
            : ready
              ? '설정 있음 — 예약 실행 기록도 확인해 주세요'
              : '미설정 — CRON_SECRET와 서버 전용 키 필요'}
        </p>
        <p>최근 24시간 오류: {health.errors24h}건</p>
        <p className="small muted">
          설정 유무만으로 정상 실행을 보장하지 않습니다. 외부 점검과 백업 복구 시험은 배포 점검표에 따라 별도로 확인해 주세요.
        </p>
      </section>

      <section className="panel">
        <h2>최근 작업</h2>
        {health.events.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>시각</th>
                <th>작업</th>
                <th>결과</th>
                <th>분류</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              {health.events.map((e, i) => (
                <tr key={i}>
                  <td>{kstLabel(e.created_at)}</td>
                  <td>{e.operation}</td>
                  <td>{e.outcome === 'ok' ? '성공' : '확인 필요'}</td>
                  <td>{e.code}</td>
                  <td>{e.duration_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>저장된 작업 기록이 없습니다. 서버 로그의 ondap_operation도 확인해 주세요.</p>
        )}
      </section>
    </div>
  );
}
