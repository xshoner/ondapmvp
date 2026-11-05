'use client';

import type { RecommendationResponse } from '../../recommendation/contracts.ts';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EVENT_NAMES, RELATION_NAMES, won } from './types.ts';

export function PrintReview({ response }: { response: RecommendationResponse }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { request, items } = response;
  const budget = request.budget.mode === 'none' ? '미입력' : `${request.budget.mode === 'total' ? '전체' : '개당'} ${won(request.budget.amount)}`;
  const labels = { standard: '표준안', practical: '실속안', formal: '격식안' } as const;
  const sender = { unknown: '미입력', personal: '개인', company: '기업', organization: '단체', public: '공공기관' };
  const purpose = { unknown: '미입력', return: '감사 답례', celebration: '축하', condolence: '위로', commemoration: '기념', promotion: '홍보' };
  return <>
    <button type="button" className="btn ghost small" onClick={() => window.print()}>선정 검토서 인쇄 / PDF 저장</button>
    {mounted && createPortal(<section className="print-review" aria-label="답례품 선정 검토서">
      <header><h1>답례품 선정 검토서</h1><table><tbody><tr><th>결재</th><th>담당</th><th>검토</th><th>승인</th></tr><tr><td></td><td></td><td></td><td></td></tr></tbody></table></header>
      <p>행사: {EVENT_NAMES[request.event]} · 대상: {RELATION_NAMES[request.relation]} · 수량: {request.quantity.toLocaleString('ko-KR')}개 · 예산: {budget}</p>
      <p>행사 격식 F: {items[0]?.eventFormality.toFixed(1)}점 · 주체: {sender[request.sender ?? 'unknown']} · 목적: {purpose[request.purpose ?? 'unknown']}</p>
      <table><thead><tr><th>구분</th><th>상품과 선정 이유</th><th>단가</th><th>상품비</th></tr></thead><tbody>{items.map((item) => <tr key={item.productNo}><td>{item.slot ? labels[item.slot] : `${item.rank}안`}</td><td><b>{item.name}</b><br />{item.reasons[0]}</td><td>{won(item.unitPrice)}</td><td>{won(item.itemSubtotal)}</td></tr>)}</tbody></table>
      {items.length < 3 && <p>조건을 충족한 상품은 {items.length}개입니다.</p>}
      <p>상품비는 판매가 기준입니다. 포장비·배송비 및 부가세 포함 여부는 주문 조건 확인 후 확정됩니다.</p>
      <p>□ 수신자와 직무 관련성 확인　□ 내부 가액 기준 확인　□ 관계 법령 및 배송 조건 확인</p>
      <p>추천 점수는 내부 비교 기준이며 법률 적합성이나 품질을 보증하지 않습니다.</p>
    </section>, document.body)}
  </>;
}
