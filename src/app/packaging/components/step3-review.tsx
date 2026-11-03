'use client';

import Image from 'next/image';
import { won } from '@/lib/result-query.ts';
import type { DesignDraft, PackagingStyle, StickerShape, StickerSizeCm, TextLayer } from '@/packaging/types.ts';
import type { EditorLayer } from '../editor-types.ts';

interface Props {
  product: {
    productNo: number;
    name: string;
    price: number;
    image: string | null;
  };
  quantity: number;
  style: PackagingStyle | undefined;
  withSticker: boolean;
  shape: StickerShape;
  sizeCm: StickerSizeCm;
  layers?: EditorLayer[];
  namesUsed: boolean;
  namesChecked: boolean;
  setNamesChecked: (v: boolean) => void;
  uploadsCount: number;
  consent: boolean;
  setConsent: (v: boolean) => void;
  overflowBoxes: unknown[];
  overlapBoxes: unknown[];
  saving: boolean;
  error: string | null;
  onGoStep: (step: 1 | 2 | 3) => void;
  onSave: () => void;
  onOpenRealSize: () => void;
}

export function Step3Review(props: Props) {
  const {
    product,
    quantity,
    style,
    withSticker,
    shape,
    sizeCm,
    layers = [],
    namesUsed,
    namesChecked,
    setNamesChecked,
    uploadsCount,
    consent,
    setConsent,
    overflowBoxes,
    overlapBoxes,
    saving,
    error,
    onGoStep,
    onSave,
    onOpenRealSize,
  } = props;

  const productTotal = product.price * quantity;
  const textLayers = layers.filter((l): l is TextLayer => l.type === 'text');

  return (
    <div className="pkg-step-content">
      <div className="pkg-step-intro">
        <h2 className="pkg-step-heading">
          <span className="pkg-step-num">STEP 3</span>
          최종 확인 및 디자인 완료
        </h2>
        <p className="pkg-step-desc">
          선택하신 포장지와 스티커 내역을 확인해 주세요. 우측에서 완성된 포장 모습을 확인할 수 있습니다.
        </p>
      </div>

      {/* 요약 명세서 카드 */}
      <div className="pkg-review-summary card">
        <div className="pkg-section-header">
          <span className="pkg-section-title">포장 및 주문 요약</span>
          <span className="pill green">포장 서비스</span>
        </div>

        {/* 1. 상품 정보 */}
        <div className="pkg-review-row">
          <span className="pkg-review-label">주문 상품</span>
          <div className="pkg-review-value">
            <div style={{ fontWeight: 600 }}>{product.name}</div>
            <div className="small muted num">
              {won(product.price)} × {quantity}개 = <b>{won(productTotal)}</b>
            </div>
          </div>
          <button
            type="button"
            className="link-btn small"
            onClick={() => onGoStep(1)}
          >
            수량 변경
          </button>
        </div>

        {/* 2. 포장지 정보 */}
        <div className="pkg-review-row">
          <span className="pkg-review-label">포장 디자인</span>
          <div className="pkg-review-value">
            <div style={{ fontWeight: 600 }}>{style?.name ?? '선택한 포장지'}</div>
            <div className="small muted">
              {style?.description ? style.description : '온답 맞춤 선물 포장'} (무료 제공)
            </div>
          </div>
          <button
            type="button"
            className="link-btn small"
            onClick={() => onGoStep(1)}
          >
            변경
          </button>
        </div>

        {/* 3. 스티커 정보 */}
        <div className="pkg-review-row">
          <span className="pkg-review-label">메시지 스티커</span>
          <div className="pkg-review-value">
            {withSticker ? (
              <>
                <div style={{ fontWeight: 600 }}>
                  {shape === 'circle' ? '원형' : '사각'} {sizeCm}×{sizeCm}cm 스티커
                </div>
                {textLayers.length > 0 ? (
                  textLayers.map((l) => {
                    let label = '문구';
                    if (l.id === 'role-recipient') label = '받는 분';
                    else if (l.id === 'role-main') label = '메인 문구';
                    else if (l.id === 'role-sender') label = '보내는 사람';
                    else if (l.id === 'role-date') label = '날짜';
                    return (
                      <div key={l.id} className="small muted" style={{ marginTop: 2 }}>
                        {label}: &ldquo;{l.text.replace(/\n/g, ' ')}&rdquo;
                      </div>
                    );
                  })
                ) : (
                  <div className="small muted" style={{ marginTop: 2 }}>
                    인쇄 문구 없음 (사진/이미지 스티커)
                  </div>
                )}
              </>
            ) : (
              <div className="muted">인쇄물 없음 (포장지만 단정하게 적용)</div>
            )}
          </div>
          <button
            type="button"
            className="link-btn small"
            onClick={() => onGoStep(2)}
          >
            수정
          </button>
        </div>

        {/* 4. 추가 비용 및 총 결제 예상 금액 */}
        <div className="pkg-price-breakdown">
          <div className="spread small" style={{ marginBottom: 6 }}>
            <span>상품 금액 ({quantity}개)</span>
            <span className="num">{won(productTotal)}</span>
          </div>
          <div className="spread small" style={{ marginBottom: 6 }}>
            <span>포장 서비스 및 맞춤 스티커</span>
            <span className="num" style={{ color: 'var(--green)' }}>0원 (기본 제공)</span>
          </div>
          <div className="spread" style={{ fontWeight: 700, fontSize: 17, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <span>주문 상품 합계</span>
            <span className="num" style={{ color: 'var(--pine)' }}>{won(productTotal)}</span>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            ※ 쇼핑몰 최종 결제 시 배송비 및 상품 옵션 추가금 등이 주문서에서 확정됩니다.
          </p>
        </div>
      </div>

      {/* 품질 및 확인 체크리스트 */}
      <div className="pkg-check-section card">
        <span className="pkg-section-title" style={{ fontSize: 14 }}>제작 전 확인 사항</span>

        {overflowBoxes.length > 0 && (
          <div className="pkg-alert-box danger" style={{ marginTop: 8 }}>
            <span className="pkg-alert-icon">⚠️</span>
            <div className="small">
              글자가 자르는 선에 걸려 잘릴 위험이 있습니다. 그대로 인쇄를 진행하시겠습니까?
            </div>
          </div>
        )}

        {overlapBoxes.length > 0 && (
          <div className="pkg-alert-box warning" style={{ marginTop: 8 }}>
            <span className="pkg-alert-icon">⚠️</span>
            <div className="small">
              문구가 서로 겹쳐 인쇄될 수 있습니다.
            </div>
          </div>
        )}

        <div className="pkg-checklist-items" style={{ marginTop: 10 }}>
          {namesUsed && (
            <label className="pkg-check-label">
              <input
                type="checkbox"
                checked={namesChecked}
                onChange={(e) => setNamesChecked(e.target.checked)}
              />
              <span>이름과 날짜 철자를 꼼꼼히 확인했습니다.</span>
            </label>
          )}

          {uploadsCount > 0 && (
            <label className="pkg-check-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>올린 사진은 직접 촬영했거나 사용 권한이 있음을 확인했습니다.</span>
            </label>
          )}

          {withSticker && (
            <div className="spread" style={{ marginTop: 6 }}>
              <span className="small muted">인쇄 전 실제 크기가 궁금하신가요?</span>
              <button
                type="button"
                className="link-btn small"
                onClick={onOpenRealSize}
              >
                신용카드로 실제 크기 확인하기 ›
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="pkg-alert-box danger card" role="alert">
          <span className="pkg-alert-icon">❌</span>
          <div className="small">{error}</div>
        </div>
      )}

      {/* 하단 완료 액션 */}
      <div className="pkg-step-actions spread">
        <button type="button" className="btn ghost large" onClick={() => onGoStep(2)}>
          ‹ 이전: 인쇄물 수정
        </button>
        <button
          type="button"
          className="btn block large"
          style={{ flex: 1, maxWidth: 300 }}
          disabled={saving || (namesUsed && !namesChecked) || (uploadsCount > 0 && !consent)}
          onClick={onSave}
        >
          {saving ? '디자인 저장하는 중…' : '디자인 완료하고 코드 받기'}
        </button>
      </div>

      <p className="small muted" style={{ textAlign: 'center', margin: '10px 0 0', lineHeight: 1.5 }}>
        디자인 완료 후 발급되는 코드로 카페24 쇼핑몰 주문서에서 자동 연동을 시도합니다. (주문서의 &lsquo;온답 포장 디자인 코드&rsquo; 칸에 코드가 들어갔는지 확인해 주시고, 비어 있거나 비회원 주문 시에는 코드를 직접 복사하여 붙여넣으실 수 있습니다.)
      </p>
    </div>
  );
}
