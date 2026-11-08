import type { ScoredProduct } from '../../engine/types.ts';
import type { RecommendationItem } from '../../recommendation/contracts.ts';

// 격식지수 및 핵심 추천 세부 점수 분해 컴포넌트
export function ScoreBreakdown({ item }: { item: ScoredProduct | RecommendationItem }) {
  // core-contract-v1 (새 추천 엔진 항목)
  if ('recommendationScore' in item) {
    const isLegacy = item.assessmentMethod === 'legacy-level';
    const isMixed = item.assessmentMethod === 'mixed';

    return (
      <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper-deep, #F6F4EF)', padding: '6px 10px', borderRadius: 6 }}>
          <span style={{ color: 'var(--ink-soft, #555)' }}>종합 추천점수 (S)</span>
          <b style={{ color: 'var(--pine, #2D5A43)', fontSize: 16 }}>{item.recommendationScore.toFixed(1)}점</b>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, fontSize: 12 }}>
          <div style={{ padding: '6px 8px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 4 }}>
            <span style={{ color: 'var(--muted, #777)' }}>행사 적합도(E)</span>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.eventFitScore.toFixed(1)}점</div>
          </div>
          <div style={{ padding: '6px 8px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 4 }}>
            <span style={{ color: 'var(--muted, #777)' }}>가격 실속(V)</span>
            <div style={{ fontWeight: 600, fontSize: 14, color: item.priceValueScore === null ? 'var(--muted, #888)' : 'inherit' }}>
              {item.priceValueScore !== null ? `${item.priceValueScore.toFixed(1)}점` : '미평가(예산 미입력)'}
            </div>
          </div>
          <div style={{ padding: '6px 8px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 4 }}>
            <span style={{ color: 'var(--muted, #777)' }}>상품 희소도(R)</span>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.rarityValue.toFixed(1)}점</div>
          </div>
          <div style={{ padding: '6px 8px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 4 }}>
            <span style={{ color: 'var(--muted, #777)' }}>검토 항목 수</span>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.evidenceCount} / 5개</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
          <span style={{ color: 'var(--muted, #888)' }}>평가 방식:</span>
          {isLegacy ? (
            <span style={{ padding: '1px 6px', background: '#FFFBEB', color: '#B45309', borderRadius: 4, fontWeight: 500 }}>
              과거 방식 평가 (low/medium/high)
            </span>
          ) : isMixed ? (
            <span style={{ padding: '1px 6px', background: '#F3E8FF', color: '#7E22CE', borderRadius: 4, fontWeight: 500 }}>
              혼합 평가
            </span>
          ) : (
            <span style={{ padding: '1px 6px', background: '#ECFDF5', color: '#047857', borderRadius: 4 }}>
              신규 수치형 평가
            </span>
          )}
          {item.rubricVersions?.length > 0 && (
            <span style={{ color: 'var(--muted, #888)', marginLeft: 'auto' }}>
              기준: {item.rubricVersions.join(', ')}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 레거시 ScoredProduct
  if (item.model === 'v2') {
    return <p className="small muted">상품 추천점수 {item.baseIndex}점. 행사 기준과 예산을 충족한 상품을 추천점수 순으로 표시합니다.</p>;
  }
  const bonusTotal = item.bonuses.reduce((s, b) => s + b.points, 0);
  const maxPoints = Math.max(...item.indicators.map((c) => c.points), 1);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="small muted">
        {item.model === 'v2' ? '추천 점수' : '격식지수'} <b style={{ color: 'var(--ink)' }}>{item.matchScore}</b>{item.model !== 'v2' && ` = 지표 ${item.formalityIndex} + 보너스 ${bonusTotal}`}
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
