'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type {
  RecommendationRequest,
  RecommendationResponse,
  RecommendationServices,
} from '../../recommendation/contracts.ts';
import { recommendationResultHref } from '../../recommendation/query.ts';
import { parseResultQuery } from '../../lib/result-query.ts';
import { RememberQuery, FeedbackBox } from '../result/client-bits.tsx';
import { CoreFinderForm } from './finder-form.tsx';
import { CoreNoticeBanner } from './notice-banner.tsx';
import { CoreMainPick, CoreOtherPick } from './pick-cards.tsx';
import { CoreCompareTable } from './compare-table.tsx';
import { EVENT_NAMES, RELATION_NAMES, won } from './types.ts';

export interface CustomerRecommendationViewProps {
  services: Pick<RecommendationServices, 'recommend'>;
  initialRequest?: RecommendationRequest;
  initialResponse?: RecommendationResponse;
  approvalEnabled?: boolean;
}

export function CustomerRecommendationView({
  services,
  initialRequest,
  initialResponse,
  approvalEnabled = false,
}: CustomerRecommendationViewProps) {
  const defaultRequest: RecommendationRequest = initialRequest ?? {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'per_item', amount: 50000 },
    excludedProductNos: [],
    sender: 'unknown',
    purpose: 'unknown',
  };

  // 사용자 폼 입력 초안 (draft)과 마지막으로 성공한 응답 (activeResponse) 분리
  const [draftRequest, setDraftRequest] = useState<RecommendationRequest>(defaultRequest);
  const [activeResponse, setActiveResponse] = useState<RecommendationResponse | null>(initialResponse ?? null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<RecommendationRequest | null>(null);
  const [pending, startTransition] = useTransition();

  // 비동기 응답 순서 역전(race condition) 방어용 generation counter
  const requestIdRef = useRef(0);

  const fetchRecommendations = (req: RecommendationRequest) => {
    const currentReqId = ++requestIdRef.current;
    setPendingRequest(req);
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const res = await services.recommend(req);
        // 더 최신 요청이 발생했으면 이전 응답은 즉시 폐기
        if (currentReqId !== requestIdRef.current) {
          return;
        }
        setPendingRequest(null);
        if (!res.ok) {
          setErrorMessage(res.error.message);
        } else {
          setActiveResponse(res.data);
          setDraftRequest(res.data.request);
        }
      } catch (err) {
        if (currentReqId !== requestIdRef.current) return;
        setPendingRequest(null);
        setErrorMessage(err instanceof Error ? err.message : '추천 통신 오류가 발생했습니다.');
      }
    });
  };

  useEffect(() => {
    if (!initialResponse) {
      fetchRecommendations(draftRequest);
    }
  }, []);

  const handleFormSubmit = (newReq: RecommendationRequest) => {
    setDraftRequest(newReq);
    setShowEditForm(false);
    fetchRecommendations(newReq);
  };

  const handleExclude = (productNo: number) => {
    if (!activeResponse) return;
    const nextExcluded = [...new Set([...activeResponse.request.excludedProductNos, productNo])];
    const nextReq: RecommendationRequest = {
      ...activeResponse.request,
      excludedProductNos: nextExcluded,
    };
    setDraftRequest(nextReq);
    fetchRecommendations(nextReq);
  };

  const handleResetExcluded = () => {
    if (!activeResponse) return;
    const nextReq: RecommendationRequest = {
      ...activeResponse.request,
      excludedProductNos: [],
    };
    setDraftRequest(nextReq);
    fetchRecommendations(nextReq);
  };

  // 포장 링크: 반드시 성공한 activeResponse.request의 조건으로 생성하며, 전체 예산 메타데이터를 유지
  const getPackagingHref = (productNo: number) => {
    if (!activeResponse) return '';
    const req = activeResponse.request;
    const p = new URLSearchParams({
      product: String(productNo),
      qty: String(req.quantity),
      event: req.event,
      relation: req.relation,
    });
    if (req.budget.mode === 'total') {
      p.set('budgetMode', 'total');
      p.set('totalBudget', String(req.budget.amount));
      p.set('budget', String(Math.floor(req.budget.amount / req.quantity)));
    } else if (req.budget.mode === 'per_item') {
      p.set('budgetMode', 'per_item');
      p.set('budget', String(req.budget.amount));
    } else {
      p.set('budgetMode', 'none');
    }
    if (req.excludedProductNos.length) p.set('exclude', req.excludedProductNos.join(','));
    if (req.sender && req.sender !== 'unknown') p.set('sender', req.sender);
    if (req.purpose && req.purpose !== 'unknown') p.set('purpose', req.purpose);
    return `/packaging?${p.toString()}`;
  };

  // 공유 링크: Codex query 도우미로 성공 응답의 정확한 조건 직렬화
  const shareHref = activeResponse ? recommendationResultHref(activeResponse.request) : '';

  const successfulQuery = activeResponse ? parseResultQuery(Object.fromEntries(new URLSearchParams(shareHref.split('?')[1]))) : null;
  const successfulReq = activeResponse?.request;
  const items = activeResponse?.items ?? [];
  const mainPick = items[0];
  const otherPicks = items.slice(1);

  const budgetSummary = successfulReq
    ? successfulReq.budget.mode === 'none'
      ? '예산 없음'
      : successfulReq.budget.mode === 'total'
      ? `전체 ${won(successfulReq.budget.amount)}`
      : `1개당 ${won(successfulReq.budget.amount)} 이하`
    : '';

  return (
    <div className="customer-recommendation-view" style={{ maxWidth: 640, margin: '0 auto', padding: '16px 12px' }}>
      {successfulQuery && <RememberQuery query={successfulQuery} />}
      {/* 헤더 & 조건 요약 바 */}
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--ink, #222)' }}>
            {successfulReq ? `${EVENT_NAMES[successfulReq.event]} 자리에 맞춘 답례품` : '답례품 추천'}
          </h1>
          <button
            type="button"
            onClick={() => setShowEditForm(!showEditForm)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--line, #E6E1D8)',
              background: showEditForm ? 'var(--paper-deep, #F6F4EF)' : '#FFF',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {showEditForm ? '접기 ✕' : '조건 바꾸기 ✎'}
          </button>
        </div>

        {/* 현재 성공 결과 조건 요약 바: 성공 응답 기준 */}
        {successfulReq && (
          <div
            data-testid="condition-bar"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              padding: '10px 14px',
              background: 'var(--paper-deep, #F6F4EF)',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--ink-soft, #555)',
            }}
          >
            <span><b>행사:</b> {EVENT_NAMES[successfulReq.event]}</span>
            <span>·</span>
            <span><b>받는 분:</b> {RELATION_NAMES[successfulReq.relation]}</span>
            <span>·</span>
            <span><b>예산:</b> {budgetSummary}</span>
            <span>·</span>
            <span><b>수량:</b> {successfulReq.quantity.toLocaleString('ko-KR')}개</span>
          </div>
        )}

        {/* 제외된 상품 복구 바 */}
        {successfulReq && successfulReq.excludedProductNos.length > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: '#FFFBEB',
              borderRadius: 6,
              border: '1px solid #FDE68A',
              fontSize: 12,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>제외해 둔 상품이 {successfulReq.excludedProductNos.length}개 있습니다.</span>
            <button
              type="button"
              onClick={handleResetExcluded}
              style={{
                background: 'none',
                border: 'none',
                color: '#B45309',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              모두 되돌리기
            </button>
          </div>
        )}
      </header>

      {/* 조건 수정 인라인 폼 */}
      {showEditForm && (
        <CoreFinderForm
          initialRequest={draftRequest}
          onSubmit={handleFormSubmit}
          loading={pending}
        />
      )}

      {/* 요청 중 상태 안내 (새 조건과 이전 결과 혼동 방지) */}
      {pending && (
        <div
          data-testid="request-loading"
          style={{
            padding: '12px 16px',
            background: '#F0F9FF',
            border: '1px solid #BAE6FD',
            borderRadius: 8,
            color: '#0369A1',
            fontSize: 14,
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          새 조건(수량 {pendingRequest?.quantity}개)으로 추천을 계산하는 중입니다…
        </div>
      )}

      {/* 요청 실패 안내 및 입력을 보존한 재시도 제공 */}
      {errorMessage && (
        <div
          data-testid="request-error"
          style={{
            padding: '14px 16px',
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 8,
            color: '#DC2626',
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>추천 요청에 실패했습니다</div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{errorMessage}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => fetchRecommendations(draftRequest)}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                background: '#DC2626',
                color: '#FFF',
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
            <span style={{ fontSize: 12, color: 'var(--ink-soft, #666)' }}>
              입력하신 조건(수량 {draftRequest.quantity}개)은 그대로 보존되어 있습니다.
            </span>
          </div>
        </div>
      )}

      {/* 알림 및 제외 사유 배너 */}
      {activeResponse && activeResponse.items.length > 0 && <CoreNoticeBanner response={activeResponse} />}

      {/* 추천 상품 결과 영역 (요청 중일 때는 투명도 조절로 이전 결과임을 시각적으로 분리) */}
      <div style={{ opacity: pending ? 0.4 : 1, transition: 'opacity 0.2s ease', pointerEvents: pending ? 'none' : 'auto' }}>
        {mainPick ? (
          <main>
            {/* 1위 대표 추천 카드 */}
            <CoreMainPick
              item={mainPick}
              quantity={successfulReq!.quantity}
              packagingHref={getPackagingHref(mainPick.productNo)}
              onExclude={handleExclude}
            />

            {/* 대안 추천 카드 (2위, 3위) */}
            {otherPicks.length > 0 && (
              <section style={{ marginTop: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>
                  함께 비교할 만한 대안 추천 ({otherPicks.length}개)
                </h2>
                {otherPicks.map((item) => (
                  <CoreOtherPick
                    key={item.productNo}
                    item={item}
                    quantity={successfulReq!.quantity}
                    packagingHref={getPackagingHref(item.productNo)}
                    onExclude={handleExclude}
                  />
                ))}
              </section>
            )}

            {/* 비교표 (2개 이상 추천 시) */}
            {items.length > 1 && (
              <CoreCompareTable items={items} quantity={successfulReq!.quantity} />
            )}

            {/* 부가 기능 (공유 기능) */}
            <section
              style={{
                marginTop: 24,
                padding: '14px 16px',
                background: '#FFF',
                border: '1px solid var(--line, #E6E1D8)',
                borderRadius: 8,
                display: 'grid',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--muted, #666)' }}>추천 결과 공유</span>
                <button
                  type="button"
                  data-testid="share-button"
                  onClick={() => {
                    const fullUrl = `${window.location.origin}${shareHref}`;
                    if (typeof navigator !== 'undefined' && navigator.clipboard) {
                      navigator.clipboard.writeText(fullUrl);
                      alert('성공 조건이 담긴 추천 결과 링크가 복사되었습니다.');
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #E6E1D8)',
                    background: '#FFF',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  결과 링크 복사
                </button>
              </div>
            </section>
          </main>
        ) : activeResponse && (
          /* 추천 결과가 0개일 때 */
          <section
            className="card"
            style={{
              padding: 24,
              textAlign: 'center',
              background: '#FFF',
              border: '1px solid var(--line, #E6E1D8)',
              borderRadius: 8,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>
              조건에 맞는 추천 상품이 없습니다
            </h2>
            <p style={{ fontSize: 14, color: 'var(--muted, #666)', margin: '0 0 16px' }}>
              예산이나 행사 조건을 바꾸어 다시 찾아보세요.
            </p>
            {successfulReq && successfulReq.excludedProductNos.length > 0 && (
              <button
                type="button"
                onClick={handleResetExcluded}
                style={{
                  padding: '10px 16px',
                  borderRadius: 6,
                  background: 'var(--pine, #2D5A43)',
                  color: '#FFF',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginRight: 8,
                }}
              >
                제외 상품 되돌리기 ({successfulReq.excludedProductNos.length}개)
              </button>
            )}
          </section>
        )}
      </div>
      {successfulQuery && items.length > 0 && <FeedbackBox query={successfulQuery} productNos={items.map((item) => item.productNo)} />}
    </div>
  );
}
