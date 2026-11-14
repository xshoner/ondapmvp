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
  const [, setCanvasReady] = useState(false);
  const [, setCardCanvasReady] = useState(false);
  const mockupSeq = useRef(0);
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

  // 캔버스 디스플레이 크기 측정
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = (w: number) => {
      if (w > 0) setDisplaySize(Math.max(200, Math.floor(Math.min(w, 420))));
    };
    fit(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 목업용 이미지 갱신 (스티커 및 카드)
  const refreshMockup = async () => {
    if (!withSticker && !withCard) return;
    const seq = ++mockupSeq.current;
    setIsRenderingMockup(true);
    setMockupError(null);
    try {
      if (withSticker && apiRef.current) {
        const blob = await apiRef.current.exportPng(400);
        if (seq !== mockupSeq.current) return;
        const url = URL.createObjectURL(blob);
        setMockupPng((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } else {
        setMockupPng((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }

      if (withCard && cardApiRef?.current) {
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

  useEffect(() => {
    if (viewMode === 'mockup' && (withSticker || withCard)) {
      const timer = setTimeout(() => {
        void refreshMockup();
      }, 150);
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
  ]);

  const cut = (bleedUnits(sizeCm) / CANVAS_UNITS) * 100;
  const cutClip = shape === 'circle' ? `circle(${50 - cut}% at 50% 50%)` : `inset(${cut}%)`;

  const hasAnyPrint = withSticker || withCard;

  return (
    <aside className="pkg-preview-sticky card">
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
      <div className="pkg-preview-stage-container">
        {/* 1. 포장 목업 뷰 (포장지 + 스티커 및 동봉 카드) */}
        <div
          className={`pkg-mockup-view ${viewMode === 'mockup' ? 'active' : 'hidden'}`}
          style={{
            backgroundImage: style ? `url("${style.imageUrl}")` : undefined,
            position: 'relative',
          }}
        >
          <div className="pkg-mockup-inner-frame">
            {/* 스티커: 포장 상자 위에 부착 */}
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
                  const mainLayer = layers.find((l) => l.id === 'role-main') ?? layers.find((l) => l.type === 'text');
                  if (mainLayer) onSelectId(mainLayer.id);
                }}
                title="클릭하여 스티커 문구 직접 편집하기"
              >
                {mockupError && !mockupPng ? (
                  <div
                    className="pkg-mockup-error"
                    style={{
                      clipPath: cutClip,
                      background: 'rgba(255, 255, 255, 0.95)',
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      width: '100%',
                      height: '100%',
                      border: '1px dashed var(--danger)',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>⚠️</span>
                    <span className="small muted" style={{ fontSize: 11, margin: '4px 0' }}>
                      {mockupError}
                    </span>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void refreshMockup()}
                      style={{ padding: '2px 8px', fontSize: 11 }}
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

            {/* 카드(엽서): 포장과 함께 정갈하게 동봉되는 모습 (포장에 부착되지 않고 옆에 단정하게 놓임) */}
            {withCard && (
              <div
                className="pkg-mockup-card-anchor"
                style={{
                  position: 'absolute',
                  right: '12px',
                  bottom: '12px',
                  width: `${cardSizeMm === '148x100' ? 44 : 36}%`,
                  aspectRatio: '78 / 54',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.1)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  background: cardBackground,
                  cursor: 'pointer',
                  zIndex: 10,
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
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      color: 'var(--muted)',
                    }}
                  >
                    카드 로딩 중…
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pkg-mockup-caption">
            <span className="pkg-caption-style-name">{style?.name ?? '포장지'}</span>
            <span className="pkg-caption-sticker-spec">
              {withSticker && withCard
                ? `+ ${shape === 'circle' ? '원형' : '사각'} ${sizeCm}cm 스티커 & ${cardSizeMm}mm 카드(동봉)`
                : withSticker
                ? `+ ${shape === 'circle' ? '원형' : '사각'} ${sizeCm}cm 스티커`
                : withCard
                ? `+ ${cardSizeMm}mm 메시지 카드(동봉)`
                : '(인쇄물 없음)'}
            </span>
          </div>
        </div>

        {fontFallback && (
          <p className="pkg-font-fallback small" role="status">
            일부 글꼴을 불러오지 못해 대체 글꼴로 만들었어요. 미리보기의 글자 모양과 줄바꿈을 확인해 주세요.
          </p>
        )}

        {/* 2. 캔버스 뷰 (작업선 & 상호작용) - 두 캔버스를 항상 마운트하여 exportPng/측정 안정성 확보 */}
        <div ref={wrapRef} className={`pkg-canvas-view ${viewMode === 'canvas' ? 'active' : 'hidden'}`}>
          {/* 스티커 캔버스 */}
          {withSticker && displaySize > 0 && (
            <div
              style={{
                position: activeCanvas === 'sticker' && viewMode === 'canvas' ? 'relative' : 'absolute',
                visibility: activeCanvas === 'sticker' && viewMode === 'canvas' ? 'visible' : 'hidden',
                pointerEvents: activeCanvas === 'sticker' && viewMode === 'canvas' ? 'auto' : 'none',
                top: 0,
                left: 0,
                width: '100%',
              }}
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
                style={{
                  position: activeCanvas === 'card' && viewMode === 'canvas' ? 'relative' : 'absolute',
                  visibility: activeCanvas === 'card' && viewMode === 'canvas' ? 'visible' : 'hidden',
                  pointerEvents: activeCanvas === 'card' && viewMode === 'canvas' ? 'auto' : 'none',
                  top: 0,
                  left: 0,
                  width: '100%',
                }}
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
