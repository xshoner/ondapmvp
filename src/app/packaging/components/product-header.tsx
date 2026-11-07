'use client';

import Image from 'next/image';
import { won } from '@/lib/result-query.ts';
import type { PackagingOptionInfo } from '@/packaging/pricing.ts';
import type { GiftPurpose } from '@/packaging/types.ts';
import { QtyInput } from '../../components/qty-input.tsx';

interface Props {
  product: {
    productNo: number;
    name: string;
    price: number;
    image: string | null;
    url: string;
  };
  quantity: number;
  onQuantityChange: (qty: number) => void;
  purpose: GiftPurpose;
  onPurposeChange: (purpose: GiftPurpose) => void;
  eventName?: string | null;
  relationName?: string | null;
  backHref: string;
  backLabel: string;
  packagingOption?: PackagingOptionInfo | null;
}

export function ProductHeader(props: Props) {
  const {
    product,
    quantity,
    onQuantityChange,
    purpose,
    onPurposeChange,
    eventName,
    relationName,
    backHref,
    backLabel,
    packagingOption,
  } = props;

  return (
    <header className="pkg-product-header card">
      <div className="pkg-header-top-row">
        <a className="pkg-back-link" href={backHref}>
          {backLabel}
        </a>
        <div className="pkg-tag-badges">
          {eventName && <span className="pill green">{eventName}</span>}
          {relationName && <span className="pill gray">{relationName}</span>}
          {packagingOption?.status === 'loading' ? (
            <span className="pill gold">포장 요금 확인 중...</span>
          ) : packagingOption?.status === 'confirmed' && packagingOption.unitPrice !== null ? (
            <span className="pill gold">포장·스티커 {won(packagingOption.unitPrice)}/개</span>
          ) : (
            <span className="pill gold">포장·스티커 요금: 쇼핑몰 확인</span>
          )}
        </div>
      </div>

      <div className="pkg-product-content">
        {product.image && (
          <div className="pkg-product-thumb">
            <Image
              src={product.image}
              alt={product.name}
              width={76}
              height={76}
              priority
              style={{ objectFit: 'cover' }}
            />
          </div>
        )}

        <div className="pkg-product-info">
          <div className="pkg-product-title-row">
            <h1 className="pkg-product-title">{product.name}</h1>
          </div>

          <div className="pkg-product-meta-row">
            <span className="pkg-product-price num">
              {won(product.price)}
              <span className="pkg-unit-text"> / 1개</span>
            </span>

            <div className="pkg-qty-box">
              <span className="small muted">수량</span>
              <QtyInput
                className="qty-input"
                value={quantity}
                onValue={onQuantityChange}
                aria-label="주문 수량"
              />
              <span className="small muted">개</span>
              <span className="pkg-total-preview num">
                (합계 {won(product.price * quantity)})
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="pkg-purpose-row">
        <span className="small muted" style={{ fontWeight: 600 }}>선물 목적</span>
        <div className="chips" role="group" aria-label="선물 목적 선택">
          <button
            type="button"
            className="chip"
            aria-pressed={purpose === 'return'}
            onClick={() => onPurposeChange('return')}
          >
            감사 답례
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={purpose === 'celebration'}
            onClick={() => onPurposeChange('celebration')}
          >
            축하·위로 선물
          </button>
        </div>
        <span className="small muted pkg-purpose-hint">
          {purpose === 'return' ? '함께해 주신 분께 전하는 정중한 감사' : '축하와 응원의 마음을 전하는 선물'}
        </span>
      </div>
    </header>
  );
}
