import type { Metadata } from 'next';

export const metadata: Metadata = { title: '추천 기준 | 온답', description: '행사와 받는 분에 맞는 답례품을 고르는 기준을 소개합니다.' };

export default function FormalityPage() {
  return <main className="mobile" style={{ paddingBottom: 56 }}>
    <header className="topbar"><a className="back" href="/">‹ 처음으로</a><a className="brand" href="/" style={{ fontSize: 18 }}><span className="brand-mark" aria-hidden />온답</a><span style={{ width: 72 }} /></header>
    <section style={{ marginTop: 24 }}><h1>온답의 추천 기준</h1><p className="lead">행사와 받는 분에 맞는 답례품을 찾습니다.</p></section>
    <section className="step"><h2 className="step-label">추천 순서</h2><ol className="formality-steps">
      <li><b>상품 확인</b><span>판매 중이며 관리자가 상품 근거를 검토한 상품을 살펴봅니다.</span></li>
      <li><b>행사에 맞는 상품 선별</b><span>행사와 받는 분에 맞는 희소 기준과 예산을 확인합니다.</span></li>
      <li><b>추천 순위</b><span>예산, 신뢰·안전, 실용성을 기준으로 비교하고 여러 종류의 상품을 보여 드립니다.</span></li>
    </ol><p className="small muted">조건에 맞는 상품이 적으면 추천 상품이 세 개보다 적을 수 있습니다.</p></section>
  </main>;
}
