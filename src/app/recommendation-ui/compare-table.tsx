import type { RecommendationItem } from '../../recommendation/contracts.ts';
import { won } from './types.ts';

export function CoreCompareTable({
  items,
  quantity,
}: {
  items: RecommendationItem[];
  quantity: number;
}) {
  if (items.length === 0) return null;

  const rows: [string, (x: RecommendationItem) => React.ReactNode][] = [
    ['추천 순위', (x) => <b>{x.rank === 1 ? '1위 (대표)' : `${x.rank}위 대안`}</b>],
    ['1개 단가', (x) => won(x.unitPrice)],
    [`${quantity.toLocaleString('ko-KR')}개 합계`, (x) => <b>{won(x.itemSubtotal)}</b>],
    ['추천점수', (x) => <span style={{ color: 'var(--pine, #2D5A43)', fontWeight: 700 }}>{x.recommendationScore.toFixed(1)}점</span>],
    ['행사 적합도', (x) => `${x.eventFitScore.toFixed(1)}점`],
    ['예산 대비 가격', (x) => x.priceValueScore !== null ? `${x.priceValueScore.toFixed(1)}점` : '예산 미입력'],
    ['상품 특성 점수', (x) => `${x.rarityValue.toFixed(1)}점`],
  ];

  return (
    <details className="disclosure compare-details" style={{ marginTop: 20, marginBottom: 20 }}>
      <summary style={{ fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '10px 0' }}>
        {items.length}개 추천 상품 한눈에 비교하기
      </summary>
      <p style={{ margin: '4px 0', fontSize: 12 }}>← 좌우로 밀어서 비교하세요 →</p>
      <div tabIndex={0} aria-label="추천 상품 비교표, 좌우로 스크롤" style={{ overflowX: 'auto', marginTop: 10, WebkitOverflowScrolling: 'touch' }}>
        <table
          className="compare-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            minWidth: items.length > 2 ? 480 : 'auto',
          }}
        >
          <thead>
            <tr style={{ background: 'var(--paper-deep, #F6F4EF)', borderBottom: '1px solid var(--line, #E6E1D8)' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', width: 120 }}>구분</th>
              {items.map((x) => (
                <th key={x.productNo} scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>
                  <div style={{ fontSize: 11, color: 'var(--pine, #2D5A43)', fontWeight: 700 }}>
                    {x.rank === 1 ? '1위 추천' : `${x.rank}위 대안`}
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>{x.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label} style={{ borderBottom: '1px solid var(--line, #E6E1D8)' }}>
                <th scope="row" style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--ink-soft, #555)', fontWeight: 500 }}>
                  {label}
                </th>
                {items.map((x) => (
                  <td key={x.productNo} style={{ padding: '8px 10px' }}>
                    {cell(x)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
