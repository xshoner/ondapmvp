// 추천 결과 카드: 결과 화면과 관리자 '고객 카드 미리보기'가 같은 모양을 쓴다
import type { ScoredProduct } from '@/engine/types.ts';
import { shippingFee, won } from '@/lib/result-query.ts';
import { ScoreBreakdown } from '../components/score-breakdown.tsx';
import { SavePickButton } from './client-bits.tsx';

// preview: 관리자 '고객 카드 미리보기' (찜·빼기 없이 모양만)
export function MainPick({ item, quantity, packagingHref, excludeHref, preview = false }: { item: ScoredProduct; quantity: number; packagingHref: string; excludeHref: string | null; preview?: boolean }) {
  const { product, attributes } = item;
  const image = product.detailImage ?? product.image;
  const subtotal = product.price * quantity;
  const shipping = shippingFee(subtotal);
  return (
    <article className="pick">
      <div className="pick-media">
        {image ? <img src={image} alt={product.name} /> : <div style={{ aspectRatio: '4 / 3' }} />}
        {!preview && <SavePickButton variant="overlay" pick={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image, url: product.url }} />}
        <a className="seal" href="/formality" aria-label={`격식지수 ${Math.round(item.matchScore)}점, 격식지수 설명 보기`} style={{ textDecoration: 'none' }}>
          <div>
            <div className="seal-label">격식지수</div>
            <div className="seal-score num">{Math.round(item.matchScore)}</div>
          </div>
        </a>
      </div>

      <div className="pick-body">
        <div className="tier">{item.tier}</div>
        <h2 className="pick-name">
          {attributes.region !== '국내' && !product.name.includes(attributes.region) && `[${attributes.region}] `}
          {product.name}
        </h2>
        {attributes.story && attributes.story !== product.name && <p className="pick-story">{attributes.story}</p>}

        <div className="price-table num">
          <span className="muted">1개</span>
          <span>{won(product.price)}</span>
          <span className="muted">{quantity.toLocaleString('ko-KR')}개 합계</span>
          <span>{won(subtotal)}</span>
          <span className="muted">배송비</span>
          <span>{shipping ? won(shipping) : '무료'}</span>
          <span className="muted" style={{ alignSelf: 'center' }}>예상 결제 금액</span>
          <span className="total">{won(subtotal + shipping)}</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>한 곳으로 받을 때 기준이에요. 산간·도서 지역은 배송비가 더 들 수 있어요.</p>

        <div className="reason">
          <div className="label">고른 이유</div>
          <p>{item.reason}</p>
          {attributes.tags.length > 0 && <div className="tags">{attributes.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
        </div>

        <details className="disclosure">
          <summary>격식지수 계산 보기</summary>
          <div style={{ marginTop: 12 }}><ScoreBreakdown item={item} /></div>
          <p className="small" style={{ margin: '12px 0 0' }}><a className="text-link" href="/formality">격식지수는 어떻게 매기나요?</a></p>
        </details>

        <div className="pick-actions">
          <a className="btn block" href={product.url} target="_blank" rel="noreferrer">이 상품 보러 가기</a>
          <a className="btn ghost block" href={packagingHref}>포장·스티커 꾸미기 <span className="small" style={{ fontWeight: 500, color: 'var(--muted)' }}>무료</span></a>
          {excludeHref && <a className="text-link small exclude-link" href={excludeHref}>이 상품은 빼고 다시 보기</a>}
        </div>
      </div>
    </article>
  );
}

export function OtherPick({ item, packagingHref, excludeHref }: { item: ScoredProduct; packagingHref: string; excludeHref: string | null }) {
  const { product } = item;
  return (
    <article className="alt">
      <a href={product.url} target="_blank" rel="noreferrer" aria-label={`${product.name} 보러 가기`}>
        {product.image ? <img src={product.image} alt="" /> : <span className="ph" />}
      </a>
      <div style={{ minWidth: 0 }}>
        <div className="tier" style={{ fontSize: 12 }}>{item.tier}</div>
        <a className="alt-name" href={product.url} target="_blank" rel="noreferrer">{product.name}</a>
        <div className="alt-meta num">
          <span>{won(product.price)}</span>
          <span className="score">격식지수 {Math.round(item.matchScore)}</span>
        </div>
        <div className="alt-actions">
          <a className="btn ghost small" href={packagingHref}>포장 꾸미기</a>
          <SavePickButton variant="inline" pick={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image, url: product.url }} />
          {excludeHref && <a className="btn ghost small" style={{ border: 'none' }} href={excludeHref} aria-label={`${product.name} 빼고 다시 보기`}>빼기</a>}
        </div>
      </div>
    </article>
  );
}
