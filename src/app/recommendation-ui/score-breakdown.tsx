import type { RecommendationItem } from '../../recommendation/contracts.ts';

export function CoreScoreBreakdown({ item, customer = false }: { item: RecommendationItem; customer?: boolean }) {
  if (customer) return <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
    <div>추천점수: <b>{item.recommendationScore.toFixed(1)}점</b></div>
    <div>행사 적합도: {item.eventFitScore.toFixed(1)}점</div>
    <div>예산 대비 가격: {item.priceValueScore === null ? '예산 제한 없음' : `${item.priceValueScore.toFixed(1)}점`}</div>
    <div>상품 특성 점수: {item.rarityValue.toFixed(1)}점</div>
    <p style={{ margin: 0 }}>상품 특성 점수는 제작·지역·이력 등 확인된 특성을 바탕으로 합니다. 추천점수는 행사와 예산 조건도 함께 반영합니다.</p>
  </div>;
  const isLegacy = item.assessmentMethod === 'legacy-level';
  const isMixed = item.assessmentMethod === 'mixed';

  return (
    <div className="score-breakdown-box" style={{ display: 'grid', gap: 12 }}>
      {/* 대표 점수 요약 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--paper-deep, #F6F4EF)',
          borderRadius: 'var(--radius-sm, 6px)',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--ink-soft, #555)' }}>
          종합 추천점수 <b>S</b>
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--pine, #2D5A43)' }}>
          {item.recommendationScore.toFixed(1)}점
        </span>
      </div>

      {/* 4대 핵심 지표 (S / E / V / R / F) 그리드 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 8,
          fontSize: 13,
        }}
      >
        <div style={{ padding: '8px 10px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted, #777)', fontSize: 11 }}>행사 적합도 (E)</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>
            {item.eventFitScore.toFixed(1)}점
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            격식 요구 {item.eventFormality}점 대비
          </div>
        </div>

        <div style={{ padding: '8px 10px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted, #777)', fontSize: 11 }}>가격 실속 (V)</div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              marginTop: 2,
              color: item.priceValueScore === null ? 'var(--muted, #888)' : 'inherit',
            }}
          >
            {item.priceValueScore !== null ? `${item.priceValueScore.toFixed(1)}점` : '미평가(예산 제한 없음)'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            {item.priceValueScore !== null ? '예산 사용 비율에 따른 점수' : '예산 미지정으로 S=E'}
          </div>
        </div>

        <div style={{ padding: '8px 10px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted, #777)', fontSize: 11 }}>상품 희소값 (R)</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>
            {item.rarityValue.toFixed(1)}점
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            5대 속성 종합 평가
          </div>
        </div>

        <div style={{ padding: '8px 10px', border: '1px solid var(--line, #E6E1D8)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted, #777)', fontSize: 11 }}>유효 근거 수</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>
            {item.evidenceCount} / 5개
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            최소 충족 2개 이상
          </div>
        </div>
      </div>

      {/* 평가 방식 및 과거 데이터 안내 배지 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ color: 'var(--muted, #777)' }}>평가 방식:</span>
        {isLegacy && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: '#FFFBEB',
              color: '#B45309',
              border: '1px solid #FCD34D',
              fontWeight: 500,
            }}
          >
            과거 방식 평가 (low/medium/high 변환)
          </span>
        )}
        {isMixed && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: '#F3E8FF',
              color: '#7E22CE',
              border: '1px solid #D8B4FE',
              fontWeight: 500,
            }}
          >
            혼합 평가 (과거·신규 기준 병용)
          </span>
        )}
        {!isLegacy && !isMixed && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: '#ECFDF5',
              color: '#047857',
              border: '1px solid #A7F3D0',
              fontWeight: 500,
            }}
          >
            신규 수치형 평가 (0~10 정수)
          </span>
        )}

        {item.rubricVersions.length > 0 && (
          <span style={{ color: 'var(--muted, #888)', marginLeft: 'auto' }}>
            기준 버전: {item.rubricVersions.join(', ')}
          </span>
        )}
      </div>

      {/* 추천 이유 목록 */}
      {item.reasons && item.reasons.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #333)', marginBottom: 4 }}>
            추천 사유
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-soft, #555)', lineHeight: 1.5 }}>
            {item.reasons.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
