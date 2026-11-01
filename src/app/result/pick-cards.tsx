// 추천 결과 카드: 결과 화면과 관리자 '고객 카드 미리보기'가 같은 모양을 쓴다
import type { ScoredProduct } from '@/engine/types.ts';
import { ProductImage } from '../components/product-image.tsx';
import { productOrderUrl } from '@/lib/order-link.ts';
import { shippingFee, won } from '@/lib/result-query.ts';
import { ScoreBreakdown } from '../components/score-breakdown.tsx';
import { SavePickButton } from './client-bits.tsx';

// preview: 관리자 '고객 카드 미리보기' (찜·빼기 없이 모양만)
export function MainPick({ item, quantity, packagingHref, excludeHref, preview = false, mobile = false }: { item: ScoredProduct; quantity: number; packagingHref: string; excludeHref: string | null; preview?: boolean; mobile?: boolean }) {
  const { product, attributes } = item;
  const image = product.detailImage ?? product.image;
  const subtotal = product.price * quantity;
  const shipping = shippingFee(subtotal);
  return (
    <article className="pick">
      <div className="pick-media">
        {image ? <ProductImage src={image} alt={product.name} main /> : <div style={{ aspectRatio: '4 / 3' }} />}
        {!preview && <SavePickButton variant="overlay" pick={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image, url: product.url }} />}
        <a className="seal" href="/formality" aria-label={`${item.model === 'v2' ? '추천 점수' : '격식지수'} ${Math.round(item.matchScore)}점, 추천 기준 설명 보기`} style={{ textDecoration: 'none' }}>
          <div>
            <div className="seal-label">{item.model === 'v2' ? '추천 점수' : '격식지수'}</div>
            <div className="seal-score num">{Math.round(item.matchScore)}</div>
          </div>
        </a>
      </div>

      <div className="pick-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 4, backgroundColor: 'var(--paper-deep)', color: 'var(--pine)' }}>
            1위 대표 추천
          </span>
          <span className="tier">{item.tier}</span>
        </div>
        <h2 className="pick-name">
          {attributes.region !== '국내' && !product.name.includes(attributes.region) && `[${attributes.region}] `}
          {product.name}
        </h2>
        {attributes.story && attributes.story !== product.name && <p className="pick-story">{attributes.story}</p>}

        <div className="price-table num">
          <span className="muted">1개 단가</span>
          <span>{won(product.price)}</span>
          <span className="muted">{quantity.toLocaleString('ko-KR')}개 상품 합계</span>
          <span>{won(subtotal)}</span>
          <span className="muted">예상 배송비 (단일 배송지)</span>
          <span>{shipping ? won(shipping) : '무료'}</span>
          <span className="muted" style={{ alignSelf: 'center' }}>예상 합계 (배송비 포함)</span>
          <span className="total">{won(subtotal + shipping)}</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
          ※ 단일 배송지(5만 원 이상 무료 배송) 기준의 참고 예상 금액입니다. 상품별 배송 조건(개별 배송·묶음 배송)이나 쇼핑몰 옵션·도서산간 추가 배송비에 따라 실제 결제 금액은 다를 수 있습니다.
        </p>

        <div className="reason">
          <div className="label">추천 이유</div>
          <p>{item.reason}</p>
          {attributes.tags.length > 0 && <div className="tags">{attributes.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
        </div>

        <details className="disclosure">
          <summary>추천 기준 세부 점수 보기</summary>
          <div style={{ marginTop: 12 }}><ScoreBreakdown item={item} /></div>
          <p className="small" style={{ margin: '12px 0 0' }}><a className="text-link" href="/formality">어떤 기준으로 추천하나요?</a></p>
        </details>

        <div className="pick-actions">
          <a className="btn block" href={packagingHref}>
            포장·스티커 꾸미기 <span className="small" style={{ fontWeight: 500, color: 'rgba(255,255,255,0.85)', marginLeft: 4 }}>무료</span>
          </a>
          <a className="btn ghost block" href={productOrderUrl(product.url, quantity, null, mobile)} target="_blank" rel="noreferrer">
            상품 상세 보기 및 주문 ↗
          </a>
          {excludeHref && (
            <div style={{ textAlign: 'center', marginTop: 2 }}>
              <a className="text-link small exclude-link" href={excludeHref}>
                이 상품은 추천에서 제외하기
              </a>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function OtherPick({
  item,
  packagingHref,
  excludeHref,
  quantity = 1,
  mobile = false,
  rank = 2,
}: {
  item: ScoredProduct;
  packagingHref: string;
  excludeHref: string | null;
  quantity?: number;
  mobile?: boolean;
  rank?: number;
}) {
  const { product, attributes } = item;
  const subtotal = product.price * quantity;
  return (
    <article className="alt">
      <a href={productOrderUrl(product.url, quantity, null, mobile)} target="_blank" rel="noreferrer" aria-label={`${product.name} 보러 가기`}>
        {product.image ? <ProductImage src={product.image} alt="" /> : <span className="ph" />}
      </a>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4, backgroundColor: 'var(--paper-deep)', color: 'var(--pine)' }}>
              {rank}위 대안
            </span>
            <span className="tier" style={{ fontSize: 12 }}>{item.tier}</span>
          </div>
          <a className="alt-name" href={productOrderUrl(product.url, quantity, null, mobile)} target="_blank" rel="noreferrer">
            {attributes.region !== '국내' && !product.name.includes(attributes.region) && `[${attributes.region}] `}
            {product.name}
          </a>
          <div className="alt-meta num" style={{ marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{won(product.price)}</span>
            {quantity > 1 && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                ({quantity.toLocaleString('ko-KR')}개 합계 {won(subtotal)})
              </span>
            )}
          </div>
          {item.reason && (
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {item.reason}
            </p>
          )}
        </div>
        <div className="alt-actions" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <a className="btn ghost small" href={packagingHref}>포장 꾸미기</a>
          <a className="btn ghost small" href={productOrderUrl(product.url, quantity, null, mobile)} target="_blank" rel="noreferrer">상세보기 ↗</a>
          <SavePickButton variant="inline" pick={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image, url: product.url }} />
          {excludeHref && <a className="btn ghost small" style={{ border: 'none', color: 'var(--muted)' }} href={excludeHref} aria-label={`${product.name} 빼고 다시 보기`}>제외</a>}
        </div>
      </div>
    </article>
  );
}
