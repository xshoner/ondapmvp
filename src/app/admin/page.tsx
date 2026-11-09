import { getCatalog } from '@/data/repository.ts';
import { getDesignTodo } from '@/data/packaging-repository.ts';
import { getStats, validStatsPeriod } from '@/stats/repository.ts';
import { FEEDBACK_REASONS } from '@/lib/feedback.ts';
import { kstLabel } from '@/lib/kst.ts';
import { LATE_DAYS, lateSince } from '@/packaging/design-filter.ts';
import { kstDate } from '@/stats/summary.ts';
import { DailyColumns, PrintButton, RankBars } from './stats/charts.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERIODS = [
  { id: '7', label: '최근 7일', days: 7 },
  { id: '30', label: '최근 30일', days: 30 },
  { id: '90', label: '최근 90일', days: 90 },
] as const;

const num = (n: number) => n.toLocaleString('ko-KR');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const today = kstDate(new Date().toISOString());
  const custom =
    typeof sp.from === 'string' &&
    DATE.test(sp.from) &&
    typeof sp.to === 'string' &&
    DATE.test(sp.to) &&
    sp.from <= sp.to;
  const period = PERIODS.find((p) => p.id === sp.period) ?? PERIODS[1];
  const from = custom
    ? (sp.from as string)
    : kstDate(new Date(Date.parse(`${today}T00:00:00+09:00`) - (period.days - 1) * 86400000).toISOString());
  const to = custom ? (sp.to as string) : today;

  if (!validStatsPeriod(from, to)) {
    return (
      <section className="panel" role="alert">
        <h1>조회 기간을 확인해 주세요</h1>
        <p>올바른 날짜로 최대 400일까지 조회할 수 있습니다.</p>
        <a href="/admin?period=30" className="btn small">최근 30일 보기</a>
      </section>
    );
  }

  const catalog = await getCatalog();
  const [statsResult, todoResult] = await Promise.allSettled([
    getStats(from, to),
    getDesignTodo(lateSince(Date.now())),
  ]);

  if (statsResult.status === 'rejected') {
    return (
      <section className="panel" role="alert">
        <h1>전체 실적을 확인할 수 없습니다</h1>
        <p>일부 자료를 전체 합계로 표시하지 않았습니다. DB 연결과 마이그레이션 적용 상태를 확인해 주세요.</p>
        <a href="/admin/health" className="btn small">운영 상태 확인</a>
      </section>
    );
  }

  const stats = statsResult.value;
  const todo = todoResult.status === 'fulfilled' ? todoResult.value : null;
  const late = todo ? todo.staleReceived + todo.lateConfirmed : 0;
  const packagingListUrl = '/admin/packaging?tab=designs';

  const s = stats.summary;
  const { config } = catalog;
  const productName = new Map(catalog.products.map((p) => [p.productNo, p.name]));
  const share = (a: number, b: number, of: string) =>
    b ? `${of}의 ${Math.round((a / b) * 100)}%` : `${of} 기록 없음`;
  const eventName = (id: string) => config.events[id as keyof typeof config.events]?.name ?? id;
  const relationName = (id: string) => config.relations[id as keyof typeof config.relations]?.name ?? id;
  const unmet = stats.unmet;
  const fb = stats.feedback;

  return (
    <div className="admin-dashboard">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>대시보드</h1>
        <p>
          답례큐 추천 엔진 현황과 주문·인쇄 작업 및 기간별 실적 지표를 한눈에 확인합니다.
          지원사업 실적과 결과보고 자료로 쓸 수 있도록 CSV로 내려받거나 A4로 인쇄할 수 있습니다.
        </p>
        <p className="print-only small">
          답례큐 대시보드 실적 보고 · {from} ~ {to} · {kstLabel(new Date().toISOString())} 출력
        </p>
      </header>

      {/* 1. 상단 관리자 관점 오늘 할 일 */}
      <section className="today-todo-section" aria-label="관리자 오늘 할 일">
        <div className="today-todo-header">
          <div className="today-todo-title">
            <span>오늘 할 일</span>
            <span className="small muted">포장 디자인 및 인쇄 주문 현황</span>
          </div>
          <a href="/admin/scan" className="btn ghost small no-print">
            QR로 완료 처리
          </a>
        </div>

        {todo ? (
          <>
            <div className="today-todo-grid">
              <a
                href={`${packagingListUrl}&status=received`}
                className="today-card"
                title="고객이 디자인 접수를 마친 후 주문번호를 확인해야 하는 건"
              >
                <div className="today-card-top">
                  <span className="today-card-label">주문 확인 대기</span>
                  <span className="today-card-badge">
                    {todo.received > 0 ? `${todo.received}건 처리 필요` : '대기 없음'}
                  </span>
                </div>
                <div className="today-card-value num">{num(todo.received)}</div>
                <div className="today-card-desc">고객 접수 완료 후 카페24 주문 대조 대기</div>
                <span className="today-card-arrow">접수 목록 바로가기 →</span>
              </a>

              <a
                href={`${packagingListUrl}&status=order_confirmed`}
                className="today-card"
                title="주문 확인 후 스티커 라벨 및 포장 안내문 인쇄 대기 건"
              >
                <div className="today-card-top">
                  <span className="today-card-label">인쇄 대기</span>
                  <span className="today-card-badge">
                    {todo.confirmed > 0 ? `${todo.confirmed}건 인쇄 필요` : '대기 없음'}
                  </span>
                </div>
                <div className="today-card-value num">{num(todo.confirmed)}</div>
                <div className="today-card-desc">주문 확인 완료 후 스티커·안내문 인쇄 대기</div>
                <span className="today-card-arrow">인쇄 대기 목록 바로가기 →</span>
              </a>

              <a
                href={`${packagingListUrl}&late=1`}
                className={`today-card ${late > 0 ? 'warn' : ''}`}
                title={`접수 ${LATE_DAYS.received}일, 주문 확인 ${LATE_DAYS.order_confirmed}일 경과 건`}
              >
                <div className="today-card-top">
                  <span className="today-card-label">지연 건</span>
                  <span className="today-card-badge">
                    {late > 0 ? `주의 ${late}건` : '지연 없음'}
                  </span>
                </div>
                <div className="today-card-value num">{num(late)}</div>
                <div className="today-card-desc">
                  접수 {LATE_DAYS.received}일, 주문 확인 {LATE_DAYS.order_confirmed}일 초과
                </div>
                <span className="today-card-arrow">지연 목록 바로가기 →</span>
              </a>
            </div>
            {todo.received + todo.confirmed === 0 && (
              <p className="small muted" style={{ margin: '14px 0 0', textAlign: 'center' }}>
                현재 밀린 접수나 지연된 건이 없습니다. 모든 주문 확인 및 인쇄 작업이 정상 완료되었습니다.
              </p>
            )}
          </>
        ) : (
          <div className="notice" style={{ margin: 0 }}>
            오늘 할 일 목록을 불러오지 못했습니다. DB 연결 또는 포장 디자인 테이블 상태를 확인해 주세요.
          </div>
        )}
      </section>

      {/* 2. 기간 선택 및 보고용 도구 */}
      <form className="panel filter-bar no-print" method="get" action="/admin">
        <div className="chips" style={{ alignSelf: 'end' }}>
          {PERIODS.map((p) => (
            <a
              key={p.id}
              className="chip"
              href={`/admin?period=${p.id}`}
              aria-pressed={!custom && p.id === period.id}
              style={{ textDecoration: 'none' }}
            >
              {p.label}
            </a>
          ))}
        </div>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">시작일</span>
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">종료일</span>
          <input type="date" name="to" defaultValue={to} max={today} />
        </label>
        <div className="row" style={{ gap: 8, alignSelf: 'end' }}>
          <button type="submit" className="btn small">기간 적용</button>
          <a className="btn ghost small" href={`/admin/stats/export?from=${from}&to=${to}`}>
            일별 CSV 내려받기
          </a>
          <PrintButton />
        </div>
      </form>

      {/* 3. 핵심 지표 (KPI) */}
      <section className="dashboard-kpi-row" aria-label="핵심 실적 지표">
        <div className="dashboard-kpi">
          <div className="kpi-head">
            <span className="kpi-label">추천 결과 조회 수</span>
            <span className="kpi-badge">엔진 조회</span>
          </div>
          <b className="kpi-value num">
            {num(s.totals.recommendations)}
            <small className="kpi-unit">회</small>
          </b>
          <span className="kpi-note">고객이 조건에 맞춰 추천 결과를 조회한 횟수</span>
        </div>

        <div className="dashboard-kpi">
          <div className="kpi-head">
            <span className="kpi-label">포장 디자인 접수</span>
            <span className="kpi-badge">정상 접수</span>
          </div>
          <b className="kpi-value num">
            {num(s.totals.designs)}
            <small className="kpi-unit">건</small>
          </b>
          <span className="kpi-note">
            스티커 포함 {num(s.totals.withSticker)}건 (취소·미결제 제외)
          </span>
          <span className="kpi-subnote">미결제 임시저장 및 취소 건을 제외한 정상 접수 건수</span>
        </div>

        <div className="dashboard-kpi">
          <div className="kpi-head">
            <span className="kpi-label">주문 연결 접수</span>
            <span className="kpi-badge">주문 대조</span>
          </div>
          <b className="kpi-value num">
            {num(s.totals.ordered)}
            <small className="kpi-unit">건</small>
          </b>
          <span className="kpi-note">{share(s.totals.ordered, s.totals.designs, '디자인 접수')}</span>
          <span className="kpi-subnote">
            카페24 주문번호 입력 또는 관리자 주문 확인 건 (실제 결제는 카페24 연동 기준)
          </span>
        </div>

        <div className="dashboard-kpi">
          <div className="kpi-head">
            <span className="kpi-label">인쇄 완료</span>
            <span className="kpi-badge">작업 완료</span>
          </div>
          <b className="kpi-value num">
            {num(s.totals.printed)}
            <small className="kpi-unit">건</small>
          </b>
          <span className="kpi-note">{share(s.totals.printed, s.totals.ordered, '주문 연결')}</span>
          <span className="kpi-subnote">스티커 라벨 및 포장 안내 인쇄가 완료된 건수</span>
        </div>
      </section>

      {/* 4. 기간별 추이와 행사별 수요 */}
      <div className="stats-grid">
        <section className="panel">
          <h2 className="panel-title">날짜별 추천 결과 조회 수</h2>
          <DailyColumns
            days={s.days.map((d) => ({ date: d.date, value: d.recommendations }))}
            unit="회"
            label="날짜별 추천 결과 조회 수"
          />
        </section>

        <section className="panel">
          <h2 className="panel-title">날짜별 포장 디자인 접수 건수</h2>
          <DailyColumns
            days={s.days.map((d) => ({ date: d.date, value: d.designs }))}
            unit="건"
            label="날짜별 포장 디자인 접수 건수"
          />
        </section>

        <section className="panel" style={{ gridColumn: 'span 2' }}>
          <h2 className="panel-title">행사별 추천 수요</h2>
          <p className="small muted" style={{ margin: '-6px 0 14px' }}>
            고객이 선택한 행사별 추천 조회 분포입니다. 높은 수요의 행사를 중심으로 상품 기획과 포장 구성을 준비할 수 있습니다.
          </p>
          <RankBars
            unit="회"
            rows={s.byEvent.map((r) => ({ label: eventName(r.id), value: r.count }))}
          />
        </section>
      </div>

      {/* 날짜별 수치 대체 표 (접기/펼치기) */}
      <details className="dashboard-details no-print">
        <summary>날짜별 상세 수치 표로 보기 ({s.days.length}일)</summary>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="data designs-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>날짜</th>
                <th className="right">추천 결과 조회 수</th>
                <th className="right">포장 디자인 접수 건수</th>
              </tr>
            </thead>
            <tbody>
              {s.days.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="right num">{num(d.recommendations)}</td>
                  <td className="right num">{num(d.designs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* 5. 의사결정 정보: 많이 추천된 상품 & 추천 결과 부족 조건 */}
      <div className="stats-grid">
        <section className="panel">
          <h2 className="panel-title">많이 추천된 상품</h2>
          <p className="small muted" style={{ margin: '-6px 0 12px' }}>
            알고리즘이 1위 또는 상위 3위 안에 가장 자주 추천한 상품입니다.
          </p>
          {s.topProducts.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>이 기간에 추천 기록이 없습니다.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data designs-table">
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>상품명</th>
                    <th className="right">1위 추천</th>
                    <th className="right">3위 안 추천</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topProducts.map((p, i) => (
                    <tr key={p.productNo}>
                      <td>{i + 1}</td>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={productName.get(p.productNo) ?? `상품번호 ${p.productNo}`}>
                        {productName.get(p.productNo) ?? `상품번호 ${p.productNo}`}
                      </td>
                      <td className="right num">{num(p.first)}</td>
                      <td className="right num">{num(p.top3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">추천 결과 부족 조건 (찾았지만 없던 것)</h2>
          <p className="small muted" style={{ margin: '-6px 0 10px' }}>
            추천을 {config.resultCount}개 채우지 못했거나, 현재 상품 가격 기준으로 예산을 넘는 조건입니다.
            과거 상품 가격 변경 전의 정확한 초과 여부와는 다를 수 있습니다.
          </p>
          {unmet.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              이 기간에는 모든 조건을 예산 안에서 충분히 채웠습니다.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data designs-table">
                <thead>
                  <tr>
                    <th>조건</th>
                    <th className="right">찾은 횟수</th>
                    <th className="right">결과 부족</th>
                    <th className="right">예산 초과</th>
                  </tr>
                </thead>
                <tbody>
                  {unmet.map((u) => (
                    <tr key={`${u.event}|${u.relation}|${u.band}`}>
                      <td>{eventName(u.event)} · {relationName(u.relation)} · {u.band}</td>
                      <td className="right num">{num(u.total)}</td>
                      <td className="right num">{num(u.short)}</td>
                      <td className="right num">{num(u.relaxed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 6. 고객 의견 & 보조 지표 (관계별 추천) */}
      <div className="stats-grid">
        <section className="panel">
          <h2 className="panel-title">고객 목소리</h2>
          {fb === null ? (
            <p className="small muted" style={{ margin: 0 }}>
              의견을 담을 표가 아직 없습니다. Supabase SQL Editor에서 <code>20261026000000_feedback_hardening.sql</code>을 실행하면 쌓이기 시작합니다.
            </p>
          ) : fb.total === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              이 기간에 받은 의견이 없습니다. 결과 화면 끝 &lsquo;이 추천이 도움이 됐나요?&rsquo;에서 수집됩니다.
            </p>
          ) : fb.total < 5 ? (
            <>
              <p style={{ margin: '0 0 12px' }}>
                <b className="num" style={{ fontSize: 20 }}>{num(fb.helpful)} / {num(fb.total)}건</b>
                <span className="small muted"> 도움 됐어요</span>
              </p>
              <p className="small muted" style={{ margin: '0 0 10px' }}>
                ※ 수집된 의견 표본({fb.total}건)이 적어 비율 왜곡을 방지하기 위해 실제 건수로 표시합니다.
              </p>
              {fb.reasons.length > 0 && (
                <RankBars
                  unit="건"
                  wide
                  rows={fb.reasons.map((r) => ({ label: FEEDBACK_REASONS[r.id] ?? r.id, value: r.count }))}
                />
              )}
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 12px' }}>
                <b className="num" style={{ fontSize: 24, color: 'var(--pine)' }}>
                  {Math.round((fb.helpful / fb.total) * 100)}%
                </b>
                <span className="small muted"> 도움 됐어요 ({num(fb.helpful)} / {num(fb.total)}건)</span>
              </p>
              {fb.reasons.length > 0 && (
                <RankBars
                  unit="건"
                  wide
                  rows={fb.reasons.map((r) => ({ label: FEEDBACK_REASONS[r.id] ?? r.id, value: r.count }))}
                />
              )}
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                행사별 도움 됐어요:{' '}
                {fb.byEvent
                  .map((e) => `${eventName(e.id)} ${e.total > 0 ? Math.round((e.helpful / e.total) * 100) : 0}%(${e.total}건)`)
                  .join(' · ')}
              </p>
            </>
          )}
        </section>

        <section className="panel">
          <details className="dashboard-subpanel" style={{ padding: 0, border: 'none', boxShadow: 'none' }} open>
            <summary className="panel-title dashboard-subpanel-summary">
              관계별 추천 수요 (보조 지표)
            </summary>
            <p className="small muted" style={{ margin: '-6px 0 12px' }}>
              관계별 추천은 행사별 수요에 비해 상품 소싱이나 포장 자재 준비 등 운영 조치로 즉각 연결되기 어려운 보조 지표이므로, 메인 화면의 집중도를 위해 보조 정보로 제공합니다.
            </p>
            <RankBars
              unit="회"
              rows={s.byRelation.map((r) => ({ label: relationName(r.id), value: r.count }))}
            />
          </details>
        </section>
      </div>
    </div>
  );
}
