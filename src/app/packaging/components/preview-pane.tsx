'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import { CANVAS_UNITS, bleedUnits, cardCanvasUnits, type Box } from '@/packaging/rules.ts';
import type { CardSizeMm, PackagingStyle, StickerShape, StickerSizeCm } from '@/packaging/types.ts';
import type { CanvasApi, EditorLayer, TextRect } from '../editor-types.ts';

const StickerCanvas = dynamic(() => import('../sticker-canvas.tsx'), {
  ssr: false,
  loading: () => <div className="stage-loading">인쇄물 편집 화면을 불러오는 중…</div>,
});

interface Props {
  currentStep: 1 | 2 | 3;
  subStep?: 'sticker' | 'card';
  style: PackagingStyle | undefined;
  withSticker: boolean;
  shape: StickerShape;
  sizeCm: StickerSizeCm;
  background: string;
  layers: EditorLayer[];
  fontFamilies: Record<string, string>;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  onUpdateLayer: (id: string, patch: Partial<EditorLayer>) => void;
  apiRef: RefObject<CanvasApi | null>;
  onTextRects: (rects: Record<string, TextRect>) => void;
  warnBoxes: Box[];
  onOpenRealSize: (target?: 'sticker' | 'card') => void;

  withCard?: boolean;
  cardSizeMm?: CardSizeMm;
  cardBackground?: string;
  cardLayers?: EditorLayer[];
  cardSelectedId?: string | null;
  onSelectCardId?: (id: string | null) => void;
  onUpdateCardLayer?: (id: string, patch: Partial<EditorLayer>) => void;
  cardApiRef?: RefObject<CanvasApi | null>;
  onCardTextRects?: (rects: Record<string, TextRect>) => void;
  cardWarnBoxes?: Box[];
}

export function PreviewPane(props: Props) {
  const {
    currentStep,
    subStep = 'sticker',
    style,
    withSticker,
    shape,
    sizeCm,
    background,
    layers,
    fontFamilies,
    selectedId,
    onSelectId,
    onUpdateLayer,
    apiRef,
    onTextRects,
    warnBoxes,
    onOpenRealSize,
    withCard = false,
    cardSizeMm = '74x50',
    cardBackground = '#ffffff',
    cardLayers = [],
    cardSelectedId = null,
    onSelectCardId,
    onUpdateCardLayer,
    cardApiRef,
    onCardTextRects,
    cardWarnBoxes = [],
  } = props;

  const [viewMode, setViewMode] = useState<'mockup' | 'canvas'>('mockup');
  const [activeCanvas, setActiveCanvas] = useState<'sticker' | 'card'>(subStep);
  const [mockupPng, setMockupPng] = useState<string | null>(null);
  const [mockupCardPng, setMockupCardPng] = useState<string | null>(null);
  const [isRenderingMockup, setIsRenderingMockup] = useState(false);
  const [mockupError, setMockupError] = useState<string | null>(null);
  const [fontFallback, setFontFallback] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [cardCanvasReady, setCardCanvasReady] = useState(false);
  const mockupSeq = useRef(0);
  const paneRef = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState(380);

  // 단계 변경 시 기본 뷰 모드 동기화
  useEffect(() => {
    if (currentStep === 1) setViewMode('mockup');
    else if (currentStep === 2) setViewMode('canvas');
    else if (currentStep === 3) setViewMode('mockup');
  }, [currentStep]);

  // 부모의 subStep이 변경되면 캔버스 포커스 동기화
  useEffect(() => {
    if (subStep === 'card' && withCard) {
      setActiveCanvas('card');
    } else if (subStep === 'sticker' && withSticker) {
      setActiveCanvas('sticker');
    }
  }, [subStep, withSticker, withCard]);

  // 만약 현재 activeCanvas 인쇄물이 해제되었을 때 유효한 인쇄물로 자동 전환
  useEffect(() => {
    if (activeCanvas === 'sticker' && !withSticker && withCard) {
      setActiveCanvas('card');
    } else if (activeCanvas === 'card' && !withCard && withSticker) {
      setActiveCanvas('sticker');
    }
  }, [activeCanvas, withSticker, withCard]);

  // 인쇄물이 모두 없을 때는 항상 목업 뷰로 고정
  useEffect(() => {
    if (!withSticker && !withCard) {
      setViewMode('mockup');
    }
  }, [withSticker, withCard]);

  // 캔버스 디스플레이 크기 측정: 상위 패널 기준 안정적 계산 (패딩 32px 제외)
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const fit = (w: number) => {
      const usable = w - 32;
      if (usable > 0) setDisplaySize(Math.max(200, Math.floor(Math.min(usable, 420))));
    };
    fit(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 목업용 이미지 갱신 (스티커 및 카드)
  const refreshMockup = async () => {
    if (!withSticker && !withCard) {
      setMockupPng((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMockupCardPng((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const seq = ++mockupSeq.current;
    setIsRenderingMockup(true);
    setMockupError(null);
    try {
      if (withSticker) {
        if (apiRef.current) {
          const blob = await apiRef.current.exportPng(400);
          if (seq !== mockupSeq.current) return;
          const url = URL.createObjectURL(blob);
          setMockupPng((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        } else {
          // 캔버스 초기 마운트 대기 재시도
          setTimeout(() => {
            if (seq === mockupSeq.current) void refreshMockup();
          }, 120);
        }
      } else {
        setMockupPng((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }

      if (withCard) {
        if (cardApiRef?.current) {
          const cardUnits = cardCanvasUnits(cardSizeMm);
          const cardH = Math.round((400 * cardUnits.heightUnits) / cardUnits.widthUnits);
          const cardBlob = await cardApiRef.current.exportPng({ width: 400, height: cardH });
          if (seq !== mockupSeq.current) return;
          const cardUrl = URL.createObjectURL(cardBlob);
          setMockupCardPng((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return cardUrl;
          });
        } else {
          setTimeout(() => {
            if (seq === mockupSeq.current) void refreshMockup();
          }, 120);
        }
      } else {
        setMockupCardPng((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
      setMockupError(null);
    } catch {
      if (seq !== mockupSeq.current) return;
      setMockupError('인쇄물 미리보기를 생성하지 못했습니다.');
    } finally {
      if (seq === mockupSeq.current) {
        setIsRenderingMockup(false);
      }
    }
  };

  // 뷰 모드 전환 또는 디자인 변경 또는 캔버스 준비 완료 시 목업 자동 갱신
  useEffect(() => {
    if (viewMode === 'mockup' && (withSticker || withCard)) {
      const timer = setTimeout(() => {
        void refreshMockup();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [
    viewMode,
    withSticker,
    withCard,
    background,
    layers,
    shape,
    sizeCm,
    cardBackground,
    cardLayers,
    cardSizeMm,
    currentStep,
    canvasReady,
    cardCanvasReady,
  ]);

  // 언마운트 시 오브젝트 URL 정리
  useEffect(() => {
    return () => {
      setMockupPng((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMockupCardPng((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const cut = (bleedUnits(sizeCm) / CANVAS_UNITS) * 100;
  const cutClip = shape === 'circle' ? `circle(${50 - cut}% at 50% 50%)` : `inset(${cut}%)`;

  const hasAnyPrint = withSticker || withCard;

  return (
    <aside ref={paneRef} className="pkg-preview-sticky card">
      {/* 미리보기 상단 헤더 및 뷰 전환 탭 */}
      <div className="pkg-preview-header">
        <div className="pkg-preview-title-wrap">
          <span className="pkg-preview-title">실시간 포장 미리보기</span>
          <span className="small muted">
            {viewMode === 'mockup' ? '포장지와 인쇄물 조합 예시 (참고용)' : '인쇄 재단선 및 안전 영역'}
          </span>
        </div>

        <div className="pkg-preview-mode-tabs">
          <button
            type="button"
            className={`pkg-mode-tab ${viewMode === 'mockup' ? 'active' : ''}`}
            onClick={() => {
              setViewMode('mockup');
              void refreshMockup();
            }}
          >
            조합 예시
          </button>
          {withSticker && (
            <button
              type="button"
              className={`pkg-mode-tab ${viewMode === 'canvas' && activeCanvas === 'sticker' ? 'active' : ''}`}
              onClick={() => {
                setActiveCanvas('sticker');
                setViewMode('canvas');
              }}
            >
              스티커 상세
            </button>
          )}
          {withCard && (
            <button
              type="button"
              className={`pkg-mode-tab ${viewMode === 'canvas' && activeCanvas === 'card' ? 'active' : ''}`}
              onClick={() => {
                setActiveCanvas('card');
                setViewMode('canvas');
              }}
            >
              카드 상세
            </button>
          )}
          {hasAnyPrint && (
            <button
              type="button"
              className="pkg-mode-tab real-size-trigger"
              onClick={() => onOpenRealSize(activeCanvas)}
              title="신용카드 크기로 실제 인쇄 크기 확인"
            >
              실제 크기
            </button>
          )}
        </div>
      </div>

      {/* 미리보기 본체 영역 */}
      <div className="pkg-preview-body">
        {/* 1. 포장 목업 뷰 (포장지 + 스티커만 결합하고, 카드(엽서)는 아래쪽에 별도로 표시) */}
        {viewMode === 'mockup' && (
          <div className="pkg-mockup-wrapper">
            {/* 포장 상자 + 스티커 조합 예시 */}
            <div
              className="pkg-mockup-box"
              style={{
                backgroundImage: style ? `url("${style.imageUrl}")` : undefined,
              }}
            >
              <div className="pkg-mockup-inner-frame">
                {/* 스티커: 포장 상자 정중앙에 부착 */}
                {withSticker && (
                  <div
                    className="pkg-mockup-sticker-anchor"
                    style={{
                      width: `${sizeCm === 6 ? 36 : 26}%`,
                      aspectRatio: '1',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setActiveCanvas('sticker');
                      setViewMode('canvas');
                      const mainLayer =
                        layers.find((l) => l.id === 'role-main') ?? layers.find((l) => l.type === 'text');
                      if (mainLayer) onSelectId(mainLayer.id);
                    }}
                    title="클릭하여 스티커 문구 직접 편집하기"
                  >
                    {mockupError && !mockupPng ? (
                      <div className="pkg-mockup-error" style={{ clipPath: cutClip }}>
                        <span>⚠️ 스티커 로딩 실패</span>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => void refreshMockup()}
                          style={{ padding: '2px 8px', fontSize: 11, marginTop: 4 }}
                        >
                          다시 시도
                        </button>
                      </div>
                    ) : isRenderingMockup && !mockupPng ? (
                      <div className="pkg-mockup-sticker-loading" style={{ clipPath: cutClip, background }}>
                        <span>스티커 갱신 중…</span>
                      </div>
                    ) : mockupPng ? (
                      <img
                        src={mockupPng}
                        alt="포장에 부착된 스티커 예시"
                        className="pkg-mockup-sticker-img"
                        style={{ clipPath: cutClip }}
                      />
                    ) : (
                      <div className="pkg-mockup-sticker-loading" style={{ clipPath: cutClip, background }}>
                        <span>스티커 로딩 중…</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pkg-mockup-caption">
                <span className="pkg-caption-style-name">{style?.name ?? '포장지'}</span>
                <span className="pkg-caption-sticker-spec">
                  {withSticker
                    ? `+ ${shape === 'circle' ? '원형' : '사각'} ${sizeCm}cm 스티커 (상자 부착)`
                    : '(인쇄물 없음)'}
                </span>
              </div>
            </div>

            {/* 카드(엽서): 포장 상자와 합쳐지지 않고 별도로 아래쪽에 단정하게 표시 */}
            {withCard && (
              <div className="pkg-mockup-card-section">
                <div className="pkg-mockup-card-header">
                  <span className="pkg-mockup-card-title">
                    💌 동봉 메시지 카드 ({cardSizeMm === '74x50' ? '74 × 50 mm (미니 엽서)' : '148 × 100 mm (표준 엽서)'})
                  </span>
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() => {
                      setActiveCanvas('card');
                      setViewMode('canvas');
                      const mainLayer =
                        cardLayers.find((l) => l.id === 'role-main') ?? cardLayers.find((l) => l.type === 'text');
                      if (mainLayer && onSelectCardId) onSelectCardId(mainLayer.id);
                    }}
                  >
                    카드 편집 ›
                  </button>
                </div>

                <div
                  className="pkg-mockup-card-frame"
                  style={{
                    aspectRatio: cardSizeMm === '148x100' ? '148 / 100' : '74 / 50',
                    background: cardBackground,
                  }}
                  onClick={() => {
                    setActiveCanvas('card');
                    setViewMode('canvas');
                    const mainLayer =
                      cardLayers.find((l) => l.id === 'role-main') ?? cardLayers.find((l) => l.type === 'text');
                    if (mainLayer && onSelectCardId) onSelectCardId(mainLayer.id);
                  }}
                  title="클릭하여 카드(엽서) 문구 직접 편집하기"
                >
                  {mockupCardPng ? (
                    <img
                      src={mockupCardPng}
                      alt="동봉되는 메시지 카드 예시"
                      className="pkg-mockup-card-img"
                    />
                  ) : (
                    <div className="pkg-mockup-card-loading">카드 미리보기 준비 중…</div>
                  )}
                </div>
                <p className="pkg-mockup-card-hint small muted">
                  ※ 선물 상자 안에 단정하게 동봉되는 가로형 메시지 카드입니다.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 2. 캔버스 뷰 (작업선 & 상호작용 - 두 캔버스를 항상 마운트하여 exportPng/측정 안정성 확보) */}
        <div
          ref={wrapRef}
          className="pkg-canvas-view"
          style={
            viewMode === 'canvas'
              ? { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }
              : { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }
          }
        >
          {/* 스티커 캔버스 */}
          {withSticker && displaySize > 0 && (
            <div
              style={
                activeCanvas === 'sticker' && viewMode === 'canvas'
                  ? { width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }
                  : { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }
              }
            >
              <StickerCanvas
                displaySize={displaySize}
                shape={shape}
                sizeCm={sizeCm}
                background={background}
                layers={layers}
                fontFamilies={fontFamilies}
                selectedId={selectedId}
                onSelect={onSelectId}
                onChange={onUpdateLayer}
                apiRef={apiRef}
                onTextRects={onTextRects}
                warnBoxes={warnBoxes}
                onReady={() => setCanvasReady(true)}
                onFontFallback={setFontFallback}
              />
            </div>
          )}

          {/* 카드 캔버스 */}
          {withCard &&
            displaySize > 0 &&
            cardApiRef &&
            onSelectCardId &&
            onUpdateCardLayer &&
            onCardTextRects && (
              <div
                style={
                  activeCanvas === 'card' && viewMode === 'canvas'
                    ? { width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }
                    : { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }
                }
              >
                <StickerCanvas
                  cardSizeMm={cardSizeMm}
                  displaySize={displaySize}
                  shape="square"
                  sizeCm={6}
                  background={cardBackground}
                  layers={cardLayers}
                  fontFamilies={fontFamilies}
                  selectedId={cardSelectedId}
                  onSelect={onSelectCardId}
                  onChange={onUpdateCardLayer}
                  apiRef={cardApiRef}
                  onTextRects={onCardTextRects}
                  warnBoxes={cardWarnBoxes}
                  onReady={() => setCardCanvasReady(true)}
                  onFontFallback={setFontFallback}
                />
              </div>
            )}

          {viewMode === 'canvas' && hasAnyPrint && (
            <div className="pkg-canvas-legend">
              <span className="pkg-legend-cut">🔴 빨간 점선: 자르는 선(재단선)</span>
              <span className="pkg-legend-safe">⚪ 회색 점선: 안전 영역(글자 배치)</span>
            </div>
          )}
        </div>
      </div>

      {/* 미리보기 하단 상태 피드백 */}
      <div className="pkg-preview-footer">
        <div className="spread small muted">
          <span>포장·인쇄물 유료 서비스</span>
          <span>
            {withSticker && withCard
              ? `스티커 ${sizeCm}cm + 카드 ${cardSizeMm}mm`
              : withSticker
              ? `스티커 ${sizeCm}×${sizeCm}cm ${shape === 'circle' ? '원형' : '사각'}`
              : withCard
              ? `카드 ${cardSizeMm}mm (가로형)`
              : '포장지만 적용'}
          </span>
        </div>
        <p className="pkg-preview-disclaimer small muted" style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.4 }}>
          ※ 실제 상품의 규격과 상자 형태에 따라 포장지와 스티커·카드의 형태 및 비례는 화면 예시와 다를 수 있습니다.
        </p>
      </div>
    </aside>
  );
}
