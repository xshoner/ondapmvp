import type { ScoredProduct } from '@/engine/types.ts';

// 격식지수가 어떻게 나왔는지: 지표별 기여 점수 + 보너스
export function ScoreBreakdown({ item }: { item: ScoredProduct }) {
  const bonusTotal = item.bonuses.reduce((s, b) => s + b.points, 0);
  const maxPoints = Math.max(...item.indicators.map((c) => c.points), 1);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="small muted">
        격식지수 <b style={{ color: 'var(--ink)' }}>{item.matchScore}</b> = 지표 {item.formalityIndex} + 보너스 {bonusTotal}
      </div>
      {item.indicators.map((c) => (
        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '88px 1fr 56px', gap: 8, alignItems: 'center' }}>
          <span className="small">{c.name}</span>
          <div className="bar" title={`점수 ${c.score}/10 × 가중치 ${c.weight}`}>
            <span style={{ width: `${(c.points / maxPoints) * 100}%` }} />
          </div>
          <span className="small right">{c.points}</span>
          <span />
          <span className="small muted" style={{ gridColumn: '2 / 4', marginTop: -6 }}>
            {c.score}/10
            {c.target !== null && ` · 목표 ${c.target} → 실효 ${c.effective}`} · 가중치 {c.weight}
          </span>
        </div>
      ))}
      {item.bonuses.map((b) => (
        <div key={b.reason} className="spread small">
          <span className="muted">{b.reason}</span>
          <b style={{ color: b.points < 0 ? 'var(--red)' : 'var(--green)' }}>{b.points > 0 ? `+${b.points}` : b.points}</b>
        </div>
      ))}
    </div>
  );
}
