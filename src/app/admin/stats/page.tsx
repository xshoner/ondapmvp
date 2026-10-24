import { getCatalog } from '@/data/repository.ts';
import { getStats, validStatsPeriod } from '@/stats/repository.ts';
import { FEEDBACK_REASONS, summarizeFeedback } from '@/lib/feedback.ts';
import { kstLabel } from '@/lib/kst.ts';
import { kstRange } from '@/packaging/design-filter.ts';
import { kstDate, summarize, unmetDemand } from '@/stats/summary.ts';
import { DailyColumns, PrintButton, RankBars } from './charts.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERIODS = [
  { id: '7', label: '최근 7일', days: 7 },
  { id: '30', label: '최근 30일', days: 30 },
  { id: '90', label: '최근 90일', days: 90 },
] as const;

const num = (n: number) => n.toLocaleString('ko-KR');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StatsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const today = kstDate(new Date().toISOString());
  const custom = typeof sp.from === 'string' && DATE.test(sp.from) && typeof sp.to === 'string' && DATE.test(sp.to) && sp.from <= sp.to;
  const period = PERIODS.find((p) => p.id === sp.period) ?? PERIODS[1];
  const from = custom ? (sp.from as string) : kstDate(new Date(Date.parse(`${today}T00:00:00+09:00`) - (period.days - 1) * 86400000).toISOString());
  const to = custom ? (sp.to as string) : today;
  const range = kstRange({ from, to });

  if (!validStatsPeriod(from, to)) return <section className="panel"><h1>조회 기간을 확인해 주세요</h1><p>올바른 날짜로 최대 400일까지 조회할 수 있습니다.</p><a href="/admin/stats">최근 30일 보기</a></section>;
  const catalog = await getCatalog();
  let stats;
  try { stats = await getStats(from, to); }
  catch { return <section className="panel" role="alert"><h1>전체 실적을 확인할 수 없습니다</h1><p>일부 자료를 전체 합계로 표시하지 않았습니다. DB 연결과 변경 적용 상태를 확인해 주세요.</p><a href="/admin/health">운영 상태 확인</a></section>; }
  const s = stats.summary;
  const { config } = catalog;
  const productName = new Map(catalog.products.map((p) => [p.productNo, p.name]));
  const share = (a: number, b: number, of: string) => (b ? `${of}의 ${Math.round((a / b) * 100)}%` : `${of} 기록 없음`);
  const eventName = (id: string) => config.events[id as keyof typeof config.events]?.name ?? id;
  const relationName = (id: string) => config.relations[id as keyof typeof config.relations]?.name ?? id;
  const unmet = stats.unmet;
  const fb = stats.feedback;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>실적</h1>
        <p>추천 사용과 포장 디자인 접수를 기간별로 봅니다. 결과보고와 지원사업 실적 자료로 쓸 수 있도록 CSV로 내려받거나 A4 한 장으로 인쇄할 수 있습니다.</p>
        <p className="print-only small">온답 실적 · {from} ~ {to} · {kstLabel(new Date().toISOString())} 출력</p>
      </header>

      <form className="panel filter-bar no-print" method="get" action="/admin/stats">
        <div className="chips" style={{ alignSelf: 'end' }}>
          {PERIODS.map((p) => (
            <a key={p.id} className="chip" href={`/admin/stats?period=${p.id}`} aria-pressed={!custom && p.id === period.id} style={{ textDecoration: 'none' }}>{p.label}</a>
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
          <a className="btn ghost small" href={`/admin/stats/export?from=${from}&to=${to}`}>일별 CSV 내려받기</a>
          <PrintButton />
        </div>
      </form>

      <section className="kpi-row">
        <div className="kpi"><span className="kpi-label">추천 사용</span><b className="kpi-value num">{num(s.totals.recommendations)}</b><span className="kpi-note">고객이 결과 화면을 연 횟수</span></div>
        <div className="kpi"><span className="kpi-label">포장 디자인 접수</span><b className="kpi-value num">{num(s.totals.designs)}</b><span className="kpi-note">스티커 포함 {num(s.totals.withSticker)}건, 취소 제외</span></div>
        <div className="kpi"><span className="kpi-label">주문으로 이어진 접수</span><b className="kpi-value num">{num(s.totals.ordered)}</b><span className="kpi-note">{share(s.totals.ordered, s.totals.designs, '접수')}</span></div>
        <div className="kpi"><span className="kpi-label">인쇄 완료</span><b className="kpi-value num">{num(s.totals.printed)}</b><span className="kpi-note">{share(s.totals.printed, s.totals.ordered, '주문')}</span></div>
      </section>

      <div className="stats-grid">
        <section className="panel">
          <h2 className="panel-title">날짜별 추천 사용</h2>
          <DailyColumns days={s.days.map((d) => ({ date: d.date, value: d.recommendations }))} unit="회" label="날짜별 추천 사용 횟수" />
        </section>
        <section className="panel">
          <h2 className="panel-title">날짜별 포장 디자인 접수</h2>
          <DailyColumns days={s.days.map((d) => ({ date: d.date, value: d.designs }))} unit="건" label="날짜별 포장 디자인 접수 건수" />
        </section>
        <section className="panel">
          <h2 className="panel-title">행사별 추천</h2>
          <RankBars unit="회" rows={s.byEvent.map((r) => ({ label: eventName(r.id), value: r.count }))} />
        </section>
        <section className="panel">
          <h2 className="panel-title">관계별 추천</h2>
          <RankBars unit="회" rows={s.byRelation.map((r) => ({ label: relationName(r.id), value: r.count }))} />
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">많이 추천된 상품</h2>
        {s.topProducts.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>이 기간에 추천 기록이 없습니다.</p>
        ) : (
          <table className="data designs-table">
            <thead>
              <tr><th>순위</th><th>상품</th><th className="right">1위로 추천</th><th className="right">3위 안에 추천</th></tr>
            </thead>
            <tbody>
              {s.topProducts.map((p, i) => (
                <tr key={p.productNo}>
                  <td>{i + 1}</td>
                  <td>{productName.get(p.productNo) ?? `상품번호 ${p.productNo}`}</td>
                  <td className="right">{num(p.first)}</td>
                  <td className="right">{num(p.top3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="stats-grid">
        <section className="panel">
          <h2 className="panel-title">고객 목소리</h2>
          {fb === null ? (
            <p className="small muted" style={{ margin: 0 }}>
              의견을 담을 표가 아직 없습니다. Supabase SQL Editor에서 <code>20261026000000_feedback_hardening.sql</code>을 실행하면 쌓이기 시작합니다.
            </p>
          ) : fb.total === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>이 기간에 받은 의견이 없습니다. 결과 화면 끝 &lsquo;이 추천이 도움이 됐나요?&rsquo;에서 모입니다.</p>
          ) : (
            <>
              <p style={{ margin: '0 0 12px' }}>
                <b className="num" style={{ fontSize: 22 }}>{Math.round((fb.helpful / fb.total) * 100)}%</b>
                <span className="small muted"> 도움 됐어요 ({num(fb.helpful)} / {num(fb.total)}건)</span>
              </p>
              {fb.reasons.length > 0 && <RankBars unit="건" wide rows={fb.reasons.map((r) => ({ label: FEEDBACK_REASONS[r.id], value: r.count }))} />}
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                행사별 도움 됐어요: {fb.byEvent.map((e) => `${eventName(e.id)} ${Math.round((e.helpful / e.total) * 100)}%(${e.total}건)`).join(' · ')}
              </p>
            </>
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title">찾았지만 없던 것</h2>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            추천을 {config.resultCount}개 채우지 못했거나, 현재 상품 가격 기준으로 예산을 넘는 조건입니다. 과거 가격 변경 전의 정확한 초과 여부와는 다를 수 있습니다.
          </p>
          {unmet.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>이 기간에는 모든 조건을 예산 안에서 채웠습니다.</p>
          ) : (
            <table className="data designs-table">
              <thead><tr><th>조건</th><th className="right">찾은 횟수</th><th className="right">못 채움</th><th className="right">예산 넘김</th></tr></thead>
              <tbody>
                {unmet.map((u) => (
                  <tr key={`${u.event}|${u.relation}|${u.band}`}>
                    <td>{eventName(u.event)} · {relationName(u.relation)} · {u.band}</td>
                    <td className="right">{num(u.total)}</td>
                    <td className="right">{num(u.short)}</td>
                    <td className="right">{num(u.relaxed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <details className="panel no-print">
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>날짜별 숫자 표로 보기</summary>
        <table className="data designs-table" style={{ marginTop: 12 }}>
          <thead><tr><th>날짜</th><th className="right">추천 사용</th><th className="right">포장 디자인 접수</th></tr></thead>
          <tbody>
            {s.days.map((d) => (
              <tr key={d.date}><td>{d.date}</td><td className="right">{num(d.recommendations)}</td><td className="right">{num(d.designs)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
