'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { CANVAS_UNITS, bleedUnits, printPixels, STICKER_SIZES } from '@/packaging/rules.ts';
import type { PackagingStyle, StickerShape, StickerSizeCm, TextLayer } from '@/packaging/types.ts';
import type { CanvasApi, EditorLayer, TextRect } from '../editor-types.ts';

const StickerCanvas = dynamic(() => import('../sticker-canvas.tsx'), {
  ssr: false,
  loading: () => <div className="stage-loading">캔버스 불러오는 중…</div>,
});

interface Props {
  currentStep: 1 | 2 | 3;
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
  warnBoxes: any[];
  onOpenRealSize: () => void;
}

export function PreviewPane(props: Props) {
  const {
    currentStep,
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
  } = props;

  // 뷰 모드: 'mockup' (실제 포장 결합 모습) | 'canvas' (스티커 작업선)
  // Step 1: 포장지 중심 (mockup)
  // Step 2: 스티커 작업 중심 (canvas 기본, mockup 토글 가능)
  // Step 3: 완성 포장 중심 (mockup 기본, canvas 토글 가능)
  const [viewMode, setViewMode] = useState<'mockup' | 'canvas'>('mockup');
  const [mockupPng, setMockupPng] = useState<string | null>(null);
  const [isRenderingMockup, setIsRenderingMockup] = useState(false);
  const [mockupError, setMockupError] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const mockupSeq = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState(380);

  // 단계 변경 시 기본 뷰 모드 동기화
  useEffect(() => {
    if (currentStep === 1) setViewMode('mockup');
    else if (currentStep === 2) setViewMode('canvas');
    else if (currentStep === 3) setViewMode('mockup');
  }, [currentStep]);

  // 캔버스 디스플레이 크기 측정 (모바일에서도 최소 200px 이상 유지하여 0 크기 방지)
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

  // 목업용 스티커 이미지 갱신
  const refreshMockup = async () => {
    if (!withSticker) return;
    if (!apiRef.current) return;
    const seq = ++mockupSeq.current;
    setIsRenderingMockup(true);
    setMockupError(null);
    try {
      const blob = await apiRef.current.exportPng(400);
      if (seq !== mockupSeq.current) return;
      const url = URL.createObjectURL(blob);
      setMockupPng((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setMockupError(null);
    } catch {
      if (seq !== mockupSeq.current) return;
      setMockupPng((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMockupError('스티커 미리보기를 생성하지 못했습니다.');
    } finally {
      if (seq === mockupSeq.current) {
        setIsRenderingMockup(false);
      }
    }
  };

  // 뷰 모드가 목업으로 변경되거나 Step 3에 도달했을 때 목업 갱신
  useEffect(() => {
    if (viewMode === 'mockup' && withSticker) {
      const timer = setTimeout(() => {
        void refreshMockup();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [viewMode, withSticker, background, layers, shape, sizeCm, currentStep]);

  // 캔버스 모듈 로드 완료 시 즉시 목업 갱신
  useEffect(() => {
    if (canvasReady && viewMode === 'mockup' && withSticker) {
      void refreshMockup();
    }
  }, [canvasReady, viewMode, withSticker]);

  const cut = (bleedUnits(sizeCm) / CANVAS_UNITS) * 100;
  const cutClip = shape === 'circle' ? `circle(${50 - cut}% at 50% 50%)` : `inset(${cut}%)`;

  return (
    <aside className="pkg-preview-sticky card">
      {/* 미리보기 상단 헤더 및 뷰 전환 탭 */}
      <div className="pkg-preview-header">
        <div className="pkg-preview-title-wrap">
          <span className="pkg-preview-title">실시간 포장 미리보기</span>
          <span className="small muted">
            {viewMode === 'mockup' ? '포장지와 스티커 조합 예시 (참고용)' : '인쇄 재단선 및 안전 영역'}
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
              className={`pkg-mode-tab ${viewMode === 'canvas' ? 'active' : ''}`}
              onClick={() => setViewMode('canvas')}
            >
              스티커 상세
            </button>
          )}
          {withSticker && (
            <button
              type="button"
              className="pkg-mode-tab real-size-trigger"
              onClick={onOpenRealSize}
              title="신용카드 크기로 실제 인쇄 크기 확인"
            >
              실제 크기
            </button>
          )}
        </div>
      </div>

      {/* 미리보기 본체 영역 */}
      <div className="pkg-preview-stage-container">
        {/* 1. 포장 목업 뷰 (포장지 + 스티커) */}
        <div
          className={`pkg-mockup-view ${viewMode === 'mockup' ? 'active' : 'hidden'}`}
          style={{
            backgroundImage: style ? `url("${style.imageUrl}")` : undefined,
          }}
        >
          {/* 포장 상자 그림자 및 테두리 효과 */}
          <div className="pkg-mockup-inner-frame">
            {withSticker && (
              <div
                className="pkg-mockup-sticker-anchor"
                style={{
                  width: `${sizeCm === 6 ? 36 : 26}%`,
                  aspectRatio: '1',
                }}
              >
                {mockupError ? (
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
                ) : isRenderingMockup ? (
                  <div
                    className="pkg-mockup-sticker-loading"
                    style={{ clipPath: cutClip, background }}
                  >
                    <span>새 스티커 갱신 중…</span>
                  </div>
                ) : mockupPng ? (
                  <img
                    src={mockupPng}
                    alt="포장에 부착된 스티커 예시"
                    className="pkg-mockup-sticker-img"
                    style={{ clipPath: cutClip }}
                  />
                ) : (
                  <div
                    className="pkg-mockup-sticker-loading"
                    style={{ clipPath: cutClip, background }}
                  >
                    <span>스티커 로딩 중…</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pkg-mockup-caption">
            <span className="pkg-caption-style-name">{style?.name ?? '포장지'}</span>
            {withSticker ? (
              <span className="pkg-caption-sticker-spec">
                + {shape === 'circle' ? '원형' : '사각'} {sizeCm}cm 스티커
              </span>
            ) : (
              <span className="pkg-caption-sticker-spec">(인쇄물 없음)</span>
            )}
          </div>
        </div>

        {/* 2. 스티커 Konva 캔버스 뷰 (작업선 & 상호작용) */}
        {/* 항상 마운트 상태를 유지하여 exportPng 및 rect 측정이 동작하도록 함 */}
        <div
          ref={wrapRef}
          className={`pkg-canvas-view ${viewMode === 'canvas' ? 'active' : 'hidden'}`}
        >
          {displaySize > 0 && (
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
            />
          )}

          {viewMode === 'canvas' && (
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
          <span>포장·스티커 <b>무료 혜택</b> 적용</span>
          <span>{withSticker ? `규격: ${sizeCm}×${sizeCm}cm ${shape === 'circle' ? '원형' : '사각'}` : '포장지만 적용'}</span>
        </div>
        <p className="pkg-preview-disclaimer small muted" style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.4 }}>
          ※ 실제 상품의 규격과 상자 형태에 따라 포장지와 스티커의 부착 위치 및 비례는 화면 예시와 다를 수 있습니다.
        </p>
      </div>
    </aside>
  );
}
