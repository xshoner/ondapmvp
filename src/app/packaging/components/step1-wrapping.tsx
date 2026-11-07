'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import type { DesignCategory, GiftPurpose, PackagingStyle } from '@/packaging/types.ts';
import { matchesTarget } from '@/packaging/presets.ts';
import type { PackagingOptionInfo } from '@/packaging/pricing.ts';
import { won } from '@/lib/result-query.ts';

interface Props {
  styles: PackagingStyle[];
  styleId: string;
  onSelectStyle: (id: string) => void;
  productNo: number;
  event: DesignCategory | null;
  purpose: GiftPurpose;
  eventName?: string | null;
  packagingOption?: PackagingOptionInfo | null;
  onNext: () => void;
}

export function Step1Wrapping({
  styles,
  styleId,
  onSelectStyle,
  productNo,
  event,
  purpose,
  eventName,
  packagingOption,
  onNext,
}: Props) {
  // 사용 가능한 포장지 필터링 및 추천 순서 정렬
  const filteredStyles = useMemo(() => {
    const available = styles.filter(
      (s) => !s.targeting?.productNos?.length || s.targeting.productNos.includes(productNo),
    );

    // 추천 매칭되는 스타일을 우선 정렬
    return available.sort((a, b) => {
      const matchA = matchesTarget(a, event, purpose, productNo) ? 1 : 0;
      const matchB = matchesTarget(b, event, purpose, productNo) ? 1 : 0;
      return matchB - matchA || a.sort - b.sort;
    });
  }, [styles, event, purpose, productNo]);

  const selectedStyle = styles.find((s) => s.id === styleId);

  return (
    <div className="pkg-step-content">
      <div className="pkg-step-intro">
        <h2 className="pkg-step-heading">
          <span className="pkg-step-num">STEP 1</span>
          어울리는 포장지를 골라주세요
        </h2>
        <p className="pkg-step-desc">
          {eventName ? `${eventName} 행사에 어울리는 포장지를 먼저 추천해 드려요.` : '선물에 맞는 단아한 포장지를 골라보세요.'}
          {packagingOption?.status === 'loading'
            ? ' 포장·스티커 요금을 확인하고 있습니다.'
            : packagingOption?.status === 'confirmed' && packagingOption.unitPrice !== null
            ? ` 포장·스티커 서비스는 1개당 ${won(packagingOption.unitPrice)}이며, 쇼핑몰에서 옵션을 선택해 주세요.`
            : ' 포장·스티커 서비스 요금은 쇼핑몰 옵션에서 확인해 주세요.'}
        </p>
      </div>

      <div className="pkg-gallery-section">
        <div className="pkg-section-header">
          <span className="pkg-section-title">포장지 디자인 ({filteredStyles.length})</span>
          <span className="small muted">원하시는 포장지를 클릭하면 우측에서 실제 모습을 확인할 수 있어요</span>
        </div>

        {filteredStyles.length === 0 ? (
          <div className="pkg-alert-box danger card" role="alert" style={{ margin: '16px 0' }}>
            <span className="pkg-alert-icon">⚠️</span>
            <div>
              <b>선택하신 상품에 적용 가능한 포장 스타일이 없습니다.</b>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                해당 상품은 전용 규격 포장만 지원되거나 포장 서비스가 지원되지 않습니다. 관리자 또는 고객센터에 문의해 주세요.
              </p>
            </div>
          </div>
        ) : (
          <div className="pkg-style-grid">
            {filteredStyles.map((s) => {
              const isSelected = s.id === styleId;
              const isRecommended = matchesTarget(s, event, purpose, productNo);

              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pkg-style-card ${isSelected ? 'selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelectStyle(s.id)}
                >
                  <div className="pkg-style-thumb-wrap">
                    <Image
                      src={s.imageUrl}
                      alt={s.name}
                      width={280}
                      height={280}
                      sizes="(max-width: 640px) 45vw, 240px"
                      className="pkg-style-img"
                    />
                    {isRecommended && (
                      <span className="pkg-badge-recommend">온답 추천</span>
                    )}
                    {isSelected && (
                      <span className="pkg-badge-selected">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        선택됨
                      </span>
                    )}
                  </div>

                  <div className="pkg-style-meta">
                    <div className="pkg-style-name">{s.name}</div>
                    {s.description && (
                      <p className="pkg-style-desc small muted">{s.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedStyle && (
          <div className="pkg-selected-callout card">
            <div className="pkg-selected-callout-content">
              <span className="pkg-callout-icon">🎁</span>
              <div>
                <b>{selectedStyle.name} 포장지</b>가 선택되었습니다.
                {selectedStyle.description && (
                  <p className="small muted" style={{ margin: '2px 0 0' }}>{selectedStyle.description}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pkg-step-actions">
        <button
          type="button"
          className="btn block large"
          disabled={!styleId || filteredStyles.length === 0}
          onClick={onNext}
        >
          다음: 인쇄물 꾸미기 ›
        </button>
      </div>
    </div>
  );
}
