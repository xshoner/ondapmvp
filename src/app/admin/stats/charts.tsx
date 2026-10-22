'use client';

// 실적 대시보드 차트: 한 가지 값만 보여 주므로 한 색(--chart)만 쓴다. 숫자는 글자색, 막대는 차트색.
import { useState } from 'react';

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// 날짜별 세로 막대 + 마우스·키보드 위치 안내
export function DailyColumns({ days, unit, label }: { days: { date: string; value: number }[]; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.value));
  const top = Math.ceil(max / 5) * 5 || 5; // 눈금은 5 단위로 반올림
  const tickEvery = Math.max(1, Math.ceil(days.length / 6));
  const h = hover !== null ? days[hover] : null;

  return (
    <figure className="chart" aria-label={label}>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden>
          <span style={{ bottom: '100%' }}><i>{top.toLocaleString('ko-KR')}</i></span>
          <span style={{ bottom: '50%' }}>{top % 2 === 0 && <i>{(top / 2).toLocaleString('ko-KR')}</i>}</span>
          <span style={{ bottom: 0 }}><i>0</i></span>
        </div>
        <div className="chart-cols" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className="chart-col"
              aria-label={`${md(d.date)} ${d.value}${unit}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              data-active={hover === i || undefined}
            >
              <span className="bar" style={{ height: `${(d.value / top) * 100}%` }} />
            </button>
          ))}
        </div>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }} role="status">
            <b>{md(h.date)}</b> {h.value.toLocaleString('ko-KR')}{unit}
          </div>
        )}
      </div>
      <div className="chart-x" aria-hidden>
        {days.map((d, i) => <span key={d.date}>{i % tickEvery === 0 || i === days.length - 1 ? md(d.date) : ''}</span>)}
      </div>
    </figure>
  );
}

// 항목별 가로 막대 (많은 순). 값은 막대 끝 글자로 직접 표시
export function RankBars({ rows, unit, wide }: { rows: { label: string; value: number }[]; unit: string; wide?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="small muted" style={{ margin: 0 }}>기록이 없습니다.</p>;
  return (
    <ul className={wide ? 'rank-bars wide' : 'rank-bars'}>
      {rows.map((r) => (
        <li key={r.label} title={`${r.label} ${r.value}${unit}`}>
          <span className="rank-label">{r.label}</span>
          <span className="rank-track"><span className="bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="rank-value num">{r.value.toLocaleString('ko-KR')}</span>
        </li>
      ))}
    </ul>
  );
}

// 실적을 A4 한 장으로 (메뉴·필터는 인쇄 스타일에서 숨긴다)
export function PrintButton() {
  return <button type="button" className="btn ghost small" onClick={() => window.print()}>A4로 인쇄</button>;
}
