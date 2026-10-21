import { getCatalog, getRecommendationLogs } from '@/data/repository.ts';
import { listDesigns } from '@/data/packaging-repository.ts';
import { kstRange } from '@/packaging/design-filter.ts';
import { kstDate, summarize } from '@/stats/summary.ts';
import { DailyColumns, RankBars } from './charts.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERIODS = [
  { id: '7', label: '최근 7일', days: 7 },
  { id: '30', label: '최근 30일', days: 30 },
  { id: '90', label: '최근 90일', days: 90 },
] as const;

const won = (n: number) => n.toLocaleString('ko-KR');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StatsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const today = kstDate(new Date().toISOString());
  const custom = typeof sp.from === 'string' && DATE.test(sp.from) && typeof sp.to === 'string' && DATE.test(sp.to) && sp.from <= sp.to;
  const period = PERIODS.find((p) => p.id === sp.period) ?? PERIODS[1];
  const from = custom ? (sp.from as string) : kstDate(new Date(Date.parse(`${today}T00:00:00+09:00`) - (period.days - 1) * 86400000).toISOString());
  const to = custom ? (sp.to as string) : today;
  const range = kstRange({ from, to });

  const [catalog, recs, designs] = await Promise.all([
    getCatalog(),
    getRecommendationLogs(range),
    listDesigns({ from, to, limit: 5000 }),
  ]);
  const s = summarize(
    recs,
    designs.map((d) => ({ createdAt: d.createdAt, status: d.status, orderNo: d.orderNo, hasSticker: Boolean(d.sticker) })),
    { from, to },
  );
  const { config } = catalog;
  const productName = new Map(catalog.products.map((p) => [p.productNo, p.name]));
  const share = (a: number, b: number, of: string) => (b ? `${of}의 ${Math.round((a / b) * 100)}%` : `${of} 기록 없음`);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>실적</h1>
        <p>추천 사용과 포장 디자인 접수를 기간별로 봅니다. 결과보고와 지원사업 실적 자료로 쓸 수 있도록 CSV로도 내려받을 수 있습니다.</p>
      </header>

      <form className="panel filter-bar" method="get" action="/admin/stats">
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
        </div>
      </form>

      <section className="kpi-row">
        <div className="kpi"><span className="kpi-label">추천 사용</span><b className="kpi-value num">{won(s.totals.recommendations)}</b><span className="kpi-note">고객이 결과 화면을 연 횟수</span></div>
        <div className="kpi"><span className="kpi-label">포장 디자인 접수</span><b className="kpi-value num">{won(s.totals.designs)}</b><span className="kpi-note">스티커 포함 {won(s.totals.withSticker)}건, 취소 제외</span></div>
        <div className="kpi"><span className="kpi-label">주문으로 이어진 접수</span><b className="kpi-value num">{won(s.totals.ordered)}</b><span className="kpi-note">{share(s.totals.ordered, s.totals.designs, '접수')}</span></div>
        <div className="kpi"><span className="kpi-label">인쇄 완료</span><b className="kpi-value num">{won(s.totals.printed)}</b><span className="kpi-note">{share(s.totals.printed, s.totals.ordered, '주문')}</span></div>
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
          <RankBars unit="회" rows={s.byEvent.map((r) => ({ label: config.events[r.id as keyof typeof config.events]?.name ?? r.id, value: r.count }))} />
        </section>
        <section className="panel">
          <h2 className="panel-title">관계별 추천</h2>
          <RankBars unit="회" rows={s.byRelation.map((r) => ({ label: config.relations[r.id as keyof typeof config.relations]?.name ?? r.id, value: r.count }))} />
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
                  <td className="right">{won(p.first)}</td>
                  <td className="right">{won(p.top3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <details className="panel">
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>날짜별 숫자 표로 보기</summary>
        <table className="data designs-table" style={{ marginTop: 12 }}>
          <thead><tr><th>날짜</th><th className="right">추천 사용</th><th className="right">포장 디자인 접수</th></tr></thead>
          <tbody>
            {s.days.map((d) => (
              <tr key={d.date}><td>{d.date}</td><td className="right">{won(d.recommendations)}</td><td className="right">{won(d.designs)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
