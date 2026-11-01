import type { RecommendationResponse } from '../../recommendation/contracts.ts';

export function CoreNoticeBanner({ response }: { response: RecommendationResponse }) {
  if (!response.items.length || response.items.length >= 3) return null;
  return <p role="status" style={{ padding: '10px 14px', background: '#FFFBEB', borderRadius: 6, fontSize: 13 }}>
    조건에 맞는 상품 {response.items.length}개를 찾았습니다.
  </p>;
}
