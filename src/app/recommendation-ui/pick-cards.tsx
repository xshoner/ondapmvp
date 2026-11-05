'use client';

import type { RecommendationItem } from '../../recommendation/contracts.ts';
import { SavePickButton } from '../result/client-bits.tsx';
import { CoreScoreBreakdown } from './score-breakdown.tsx';
import { shippingFee } from '../../lib/result-query.ts';
import { won } from './types.ts';
import { PACKAGING_PRICE_PER_ITEM } from '../../packaging/pricing.ts';

export interface PickCardProps {
  item: RecommendationItem;
  quantity: number;
  packagingHref: string;
  excludeHref?: string | null;
  onExclude?: (productNo: number) => void;
  preview?: boolean;
}

export function CoreMainPick({
  item,
  quantity,
  packagingHref,
  excludeHref,
  onExclude,
  preview = false,
}: PickCardProps) {
  const subtotal = item.itemSubtotal;
  const shipping = shippingFee(subtotal);
  const total = subtotal + shipping;

  return (
    <article className="card pick-card" data-product-no={item.productNo} style={{ overflow: 'hidden', marginBottom: 20 }}>
      {/* 카드 미디어 영역 */}
      <div style={{ position: 'relative', width: '100%', background: '#F0ECE1', aspectRatio: '16 / 9', overflow: 'hidden' }}>
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted, #888)',
              fontSize: 14,
            }}
          >
            이미지 준비 중
          </div>
        )}

        {/* 도장/배지 형태의 추천점수 S */}
        <div
          className="seal"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'rgba(255, 255, 255, 0.95)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            borderRadius: 8,
            padding: '6px 10px',
            textAlign: 'center',
            minWidth: 64,
          }}
          aria-label={`추천점수 ${item.recommendationScore.toFixed(1)}점`}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted, #666)' }}>추천점수</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--pine, #2D5A43)' }}>
            {item.recommendationScore.toFixed(1)}
          </div>
        </div>
      </div>

      {/* 본문 영역 */}
      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--paper-deep, #F6F4EF)',
              color: 'var(--pine, #2D5A43)',
            }}
          >
            {item.slot === 'standard' ? "표준안 · ONDAP'S PICK" : '1위 대표 추천'}
          </span>
        </div>

        {/* 제목 및 우상단 찜 버튼 [Requirement 2] */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.35, flex: 1, wordBreak: 'keep-all' }}>
            {item.name}
          </h2>
          {!preview && (
            <div style={{ flexShrink: 0 }}>
              <SavePickButton variant="inline" pick={{ productNo: item.productNo, name: item.name, price: item.unitPrice, image: item.imageUrl, url: item.productUrl }} />
            </div>
          )}
        </div>
        {item.slot && <p className="small muted">{item.reasons[0]}</p>}

        {/* 가격 정보 테이블 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            rowGap: 6,
            columnGap: 16,
            fontSize: 14,
            padding: '12px 14px',
            background: 'var(--paper-light, #FAF9F6)',
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <span style={{ color: 'var(--muted, #666)' }}>1개 단가</span>
          <span style={{ textAlign: 'right', fontWeight: 500 }}>{won(item.unitPrice)}</span>

          <span style={{ color: 'var(--muted, #666)' }}>
            {quantity.toLocaleString('ko-KR')}개 상품 합계
          </span>
          <span style={{ textAlign: 'right', fontWeight: 600 }} data-testid="item-subtotal">
            {won(subtotal)}
          </span>

          <span style={{ color: 'var(--muted, #666)' }}>예상 배송비 (단일 배송지)</span>
          <span style={{ textAlign: 'right' }}>{shipping === 0 ? '무료' : won(shipping)}</span>

          <div
            style={{
              gridColumn: '1 / -1',
              height: 1,
              background: 'var(--line, #E6E1D8)',
              margin: '4px 0',
            }}
          />

          <span style={{ fontWeight: 600 }}>예상 합계 (배송비 포함)</span>
          <span
            style={{
              textAlign: 'right',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--pine, #2D5A43)',
            }}
            data-testid="item-total"
          >
            {won(total)}
          </span>
        </div>

        {/* 상세 점수 확인 */}
        <details className="disclosure" style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: 'var(--ink, #333)' }}>
            추천 점수 자세히 보기
          </summary>
          <div style={{ marginTop: 12 }}>
            <CoreScoreBreakdown item={item} customer />
          </div>
        </details>

        {/* 버튼 액션 */}
        <div style={{ display: 'grid', gap: 8 }}>
          <a
            className="btn block"
            href={packagingHref}
            data-testid="packaging-link"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '12px 16px',
              borderRadius: 6,
              background: 'var(--pine, #2D5A43)',
              color: '#FFF',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            포장·스티커 꾸미기 <span style={{ fontSize: 12, opacity: 0.85, marginLeft: 4 }}>{won(PACKAGING_PRICE_PER_ITEM)}/개</span>
          </a>

          <a
            className="btn ghost block"
            href={item.productUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '10px 16px',
              borderRadius: 6,
              border: '1px solid var(--line, #D0C9B8)',
              color: 'var(--ink, #333)',
              fontWeight: 500,
              textDecoration: 'none',
              background: '#FFF',
            }}
          >
            상품 상세 보기 및 주문 ↗
          </a>

          {!preview && (excludeHref || onExclude) && (
            <div style={{ textAlign: 'center', marginTop: 4 }}>
              {onExclude ? (
                <button
                  type="button"
                  onClick={() => onExclude(item.productNo)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted, #888)',
                    fontSize: 13,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  이 상품은 추천에서 제외하기
                </button>
              ) : (
                <a
                  href={excludeHref!}
                  style={{
                    color: 'var(--muted, #888)',
                    fontSize: 13,
                    textDecoration: 'underline',
                  }}
                >
                  이 상품은 추천에서 제외하기
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function CoreOtherPick({
  item,
  quantity,
  packagingHref,
  excludeHref,
  onExclude,
  preview = false,
}: PickCardProps) {
  const subtotal = item.itemSubtotal;
  const shipping = shippingFee(subtotal);
  const total = subtotal + shipping;

  return (
    <article
      className="card pick-card"
      data-product-no={item.productNo}
      style={{
        overflow: 'hidden',
        marginBottom: 16,
        border: '1px solid var(--line, #E6E1D8)',
      }}
    >
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          {/* 2·3위 카드 상품 썸네일 [Requirement 2] */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 6,
              overflow: 'hidden',
              background: '#F0ECE1',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--line, #E6E1D8)',
            }}
          >
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.name}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.innerHTML = '<span style="font-size:11px;color:#888;text-align:center;padding:4px;">이미지 준비 중</span>';
                  }
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--muted, #888)',
                  fontSize: 11,
                  textAlign: 'center',
                  padding: 4,
                }}
              >
                이미지 준비 중
              </div>
            )}
          </div>

          {/* 상품 정보 영역 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 4,
                  backgroundColor: 'var(--paper-deep, #F6F4EF)',
                  color: 'var(--ink-soft, #555)',
                }}
              >
                {item.slot === 'practical' ? '실속안 · 낮은 단가' : item.slot === 'formal' ? '격식안 · 높은 희소값' : `${item.rank}위 대안 추천`}
              </span>

              {/* 작은 추천점수 배지 */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  background: 'var(--paper-deep, #F6F4EF)',
                  borderRadius: 4,
                  fontSize: 11,
                }}
                aria-label={`추천점수 ${item.recommendationScore.toFixed(1)}점`}
              >
                <span style={{ color: 'var(--muted, #666)' }}>추천점수</span>
                <b style={{ color: 'var(--pine, #2D5A43)', fontSize: 13 }}>{item.recommendationScore.toFixed(1)}</b>
              </div>
            </div>

            {/* 상품 제목 및 우상단 찜 버튼 [Requirement 2] */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, lineHeight: 1.35, flex: 1, wordBreak: 'keep-all' }}>
                {item.name}
              </h3>
              {!preview && (
                <div style={{ flexShrink: 0 }}>
                  <SavePickButton variant="inline" pick={{ productNo: item.productNo, name: item.name, price: item.unitPrice, image: item.imageUrl, url: item.productUrl }} />
                </div>
              )}
            </div>

            <div style={{ fontSize: 13, color: 'var(--ink, #333)' }}>
              1개 {won(item.unitPrice)} · {quantity}개 합계 <b data-testid="item-subtotal">{won(subtotal)}</b>
            </div>
            {item.slot && <p className="small muted">{item.reasons[0]}</p>}
          </div>
        </div>

        {/* 상세 점수 확인 */}
        <details className="disclosure" style={{ marginTop: 12, marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--ink-soft, #555)' }}>
            추천 점수 자세히 보기
          </summary>
          <div style={{ marginTop: 10 }}>
            <CoreScoreBreakdown item={item} customer />
          </div>
        </details>

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            className="btn small"
            href={packagingHref}
            data-testid="packaging-link"
            style={{
              flex: 1,
              minWidth: 120,
              textAlign: 'center',
              padding: '8px 12px',
              borderRadius: 6,
              background: 'var(--pine, #2D5A43)',
              color: '#FFF',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            포장·스티커 꾸미기 ({won(PACKAGING_PRICE_PER_ITEM)}/개)
          </a>
          <a
            className="btn ghost small"
            href={item.productUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--line, #D0C9B8)',
              color: 'var(--ink, #333)',
              fontSize: 13,
              textDecoration: 'none',
              background: '#FFF',
            }}
          >
            상품 상세 보기 및 주문 ↗
          </a>
          {!preview && (excludeHref || onExclude) && (
            <div style={{ width: '100%', textAlign: 'right', marginTop: 2 }}>
              {onExclude ? (
                <button
                  type="button"
                  onClick={() => onExclude(item.productNo)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted, #888)',
                    fontSize: 12,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  이 상품은 추천에서 제외하기
                </button>
              ) : (
                <a
                  href={excludeHref!}
                  style={{ color: 'var(--muted, #888)', fontSize: 12, textDecoration: 'underline' }}
                >
                  이 상품은 추천에서 제외하기
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
