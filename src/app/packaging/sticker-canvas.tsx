'use client';

// 스티커 편집 캔버스 (Konva). 브라우저 전용이라 packaging-editor.tsx에서 ssr:false로 불러온다.
// 좌표계: 재단 여백 포함 전체를 1000으로 보고, 화면 크기에 맞춰 Stage를 축소해 보여 준다.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Circle, Group, Image as KImage, Layer as KLayer, Line, Rect, Shape, Stage, Text as KText, Transformer } from 'react-konva';
import type Konva from 'konva';
import { CANVAS_UNITS, bleedUnits, cardCanvasUnits, type Box, type FontId } from '@/packaging/rules.ts';
import type { CardSizeMm, StickerShape, TextLayer } from '@/packaging/types.ts';
import type { CanvasApi, EditorImageLayer, EditorLayer, TextRect } from './editor-types.ts';
import { loadCanvasFonts } from '@/packaging/font-loading.ts';

type Props = {
  displaySize: number;
  shape: StickerShape;
  sizeCm: number;
  cardSizeMm?: CardSizeMm;
  background: string;
  layers: EditorLayer[]; // 문구는 자리표시자를 채운 값
  fontFamilies: Record<FontId, string>;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onChange(id: string, patch: Partial<EditorLayer>): void;
  apiRef: RefObject<CanvasApi | null>;
  // 문구 상자를 잴 때마다 알려 준다 (잘림 경고·긴 이름 자동 맞춤에 쓴다)
  onTextRects(rects: Record<string, TextRect>): void;
  warnBoxes: Box[]; // 안전선을 넘은 문구: 빨간 상자로 표시
  onReady?: () => void;
  onFontFallback?: (fallback: boolean) => void;
};

type DragProps = { onDragMove(e: Konva.KonvaEventObject<DragEvent>): void; onDragEnd(): void };

const U = CANVAS_UNITS;
const C = U / 2;

const fontWeight = (font: string) => (font === 'pen' ? 'normal' : 'bold');

function fontSpec(l: TextLayer, families: Record<FontId, string>): string {
  return `${fontWeight(l.font)} ${Math.round(l.fontSize)}px ${families[l.font as FontId] ?? families.sans}`;
}

function useHtmlImage(src: string): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    let active = true;
    const el = new window.Image();
    const isRemote = /^https?:/.test(src);
    if (isRemote) {
      el.crossOrigin = 'anonymous';
    }
    el.onload = () => {
      if (active) setLoaded({ src, img: el });
    };
    el.onerror = () => {
      if (!active) return;
      console.warn('[포장 디자인] 이미지를 불러오지 못함:', src);
      // 원격 이미지 CORS 캐시 충돌 우려 시 캐시 우회 1회 재시도
      if (isRemote && !src.includes('retry_cors=1')) {
        const retryEl = new window.Image();
        retryEl.crossOrigin = 'anonymous';
        retryEl.onload = () => {
          if (active) setLoaded({ src, img: retryEl });
        };
        retryEl.onerror = () => {
          if (active) setLoaded(null);
        };
        const sep = src.includes('?') ? '&' : '?';
        retryEl.src = `${src}${sep}retry_cors=1`;
      } else {
        setLoaded(null);
      }
    };
    el.src = src;
    return () => {
      active = false;
      el.onload = null;
      el.onerror = null;
    };
  }, [src]);
  return loaded?.src === src ? loaded.img : null;
}

function ImageNode({ layer, onSelect, onChange, drag }: { layer: EditorImageLayer; onSelect(): void; onChange(p: Partial<EditorLayer>): void; drag: DragProps }) {
  const img = useHtmlImage(layer.src);
  if (!img) return null;
  return (
    <KImage
      id={layer.id}
      image={img}
      x={layer.x}
      y={layer.y}
      width={layer.width}
      height={layer.height}
      offsetX={layer.width / 2}
      offsetY={layer.height / 2}
      rotation={layer.rotation}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      draggable
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragMove={drag.onDragMove}
      onDragEnd={(e) => { drag.onDragEnd(); onChange({ x: e.target.x(), y: e.target.y() }); }}
    />
  );
}

function TextNode({
  layer,
  family,
  isEditing,
  isExporting,
  onSelect,
  onStartEdit,
  onChange,
  drag,
}: {
  layer: TextLayer;
  family: string;
  isEditing: boolean;
  isExporting: boolean;
  onSelect(): void;
  onStartEdit(): void;
  onChange(p: Partial<EditorLayer>): void;
  drag: DragProps;
}) {
  const ref = useRef<Konva.Text>(null);
  const isDraggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // 가운데 기준으로 돌고 커지도록 글자 크기를 잰 뒤 기준점을 옮긴다
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    n.offsetX(n.width() / 2);
    n.offsetY(n.height() / 2);
    n.getLayer()?.batchDraw();
  });

  const handlePointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const evt = e.evt;
    let clientX = 0;
    let clientY = 0;
    if ('touches' in evt && evt.touches && evt.touches.length > 0) {
      clientX = evt.touches[0].clientX;
      clientY = evt.touches[0].clientY;
    } else if ('clientX' in evt) {
      clientX = (evt as MouseEvent).clientX;
      clientY = (evt as MouseEvent).clientY;
    }
    pointerStartRef.current = { x: clientX, y: clientY };
    isDraggingRef.current = false;
    onSelect();
  };

  const handleDragStart = () => {
    isDraggingRef.current = true;
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    drag.onDragEnd();
    onChange({ x: e.target.x(), y: e.target.y() });
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 150);
  };

  const handleTriggerEdit = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (isDraggingRef.current) return;
    const evt = e.evt;
    if (pointerStartRef.current) {
      let clientX = 0;
      let clientY = 0;
      if ('touches' in evt && evt.changedTouches && evt.changedTouches.length > 0) {
        clientX = evt.changedTouches[0].clientX;
        clientY = evt.changedTouches[0].clientY;
      } else if ('clientX' in evt) {
        clientX = (evt as MouseEvent).clientX;
        clientY = (evt as MouseEvent).clientY;
      }
      const dx = Math.abs(clientX - pointerStartRef.current.x);
      const dy = Math.abs(clientY - pointerStartRef.current.y);
      if (dx > 10 || dy > 10) return;
    }
    onSelect();
    onStartEdit();
  };

  const isPlaceholder = !layer.text;
  const displayText = isExporting ? layer.text : (layer.text || '(문구 입력)');

  return (
    <KText
      ref={ref}
      id={layer.id}
      text={displayText}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      fontFamily={family}
      fontStyle={fontWeight(layer.font)}
      fontSize={layer.fontSize}
      lineHeight={1.3}
      align="center"
      fill={isPlaceholder ? '#8a948f' : layer.color}
      opacity={isEditing ? 0 : isPlaceholder ? 0.6 : 1}
      stroke={isPlaceholder ? undefined : (layer.stroke ?? undefined)}
      strokeWidth={!isPlaceholder && layer.stroke ? layer.fontSize * 0.12 : 0}
      fillAfterStrokeEnabled
      lineJoin="round"
      shadowEnabled={!isPlaceholder && layer.shadow}
      shadowColor="rgba(0,0,0,0.45)"
      shadowBlur={layer.fontSize * 0.15}
      shadowOffsetX={layer.fontSize * 0.04}
      shadowOffsetY={layer.fontSize * 0.06}
      draggable
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onClick={handleTriggerEdit}
      onTap={handleTriggerEdit}
      onDragStart={handleDragStart}
      onDragMove={drag.onDragMove}
      onDragEnd={handleDragEnd}
    />
  );
}

type InlineEditorProps = {
  layer: TextLayer;
  scale: number;
  displayWidth: number;
  displayHeight: number;
  family: string;
  isCard?: boolean;
  onChange: (patch: Partial<EditorLayer>) => void;
  onClose: () => void;
  commitRef: React.MutableRefObject<(() => void) | null>;
};

function InlineTextEditor({
  layer,
  scale,
  displayWidth,
  displayHeight,
  family,
  isCard,
  onChange,
  onClose,
  commitRef,
}: InlineEditorProps) {
  const [draftText, setDraftText] = useState(layer.text);
  const committedRef = useRef(false);
  const cancelledRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [hasOverflowX, setHasOverflowX] = useState(false);

  // 명시적 줄바꿈('\n') 개수 및 최대 줄 길이 측정 (자동 줄바꿈 없이 1:1 보존)
  const lines = draftText.split('\n');
  const lineCount = Math.max(1, lines.length);
  const maxLineLength = Math.max(...lines.map((l) => l.length), 0);

  // 실제 렌더링 폰트 크기 계산 (화면 스케일 및 scaleY 반영)
  const renderedFontSize = Math.max(
    16,
    Math.min(24, Math.round(layer.fontSize * scale * Math.abs(layer.scaleY || 1)))
  );
  const lineHeightPx = Math.round(renderedFontSize * 1.35);
  // 명시적 줄바꿈 줄 수에 따라 텍스트영역 높이를 자연스럽게 동적 산출 (1줄: 44px ~ 4줄: 130px)
  const textareaHeightPx = Math.max(44, Math.min(130, lineCount * lineHeightPx + 16));

  // 중앙 좌표 기준 에디터 카드 위치 산출 및 캔버스 영역 내 클램핑
  const centerX = layer.x * scale;
  const centerY = layer.y * scale;
  const estimatedCardHeight = 28 + textareaHeightPx + 40 + 26;
  const cardWidth = Math.min(360, Math.max(240, displayWidth - 16));
  const cardLeft = Math.max(8, Math.min(centerX - cardWidth / 2, displayWidth - cardWidth - 8));
  const cardTop = Math.max(8, Math.min(centerY - estimatedCardHeight / 2, displayHeight - estimatedCardHeight - 8));

  // 가로 스크롤 오버플로 감지 (장문 시 좌우 이동 지원)
  const checkOverflowX = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 2;
    setHasOverflowX(overflow);
  }, []);

  useEffect(() => {
    checkOverflowX();
  }, [draftText, cardWidth, checkOverflowX]);

  // 자동 포커스 및 모바일 가상 키보드 가림 방지
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
      try {
        textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        textareaRef.current.scrollIntoView();
      }
    }
  }, []);

  const handleCommit = () => {
    if (committedRef.current || cancelledRef.current) return;
    committedRef.current = true;
    onChange({ text: draftText });
    onClose();
  };

  const handleCancel = () => {
    if (committedRef.current || cancelledRef.current) return;
    cancelledRef.current = true;
    onClose();
  };

  // 캔버스 내보내기나 저장 시 진행 중인 편집 즉시 반영 콜백
  useEffect(() => {
    commitRef.current = () => {
      if (!committedRef.current && !cancelledRef.current) {
        committedRef.current = true;
        onChange({ text: draftText });
      }
    };
    return () => {
      commitRef.current = null;
    };
  }, [draftText, onChange, commitRef]);

  const handleBlur = (e: React.FocusEvent) => {
    if (cardRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    handleCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    }
  };

  const scrollToEdge = (edge: 'start' | 'end') => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      if (edge === 'start') {
        el.scrollLeft = 0;
        el.setSelectionRange(0, 0);
      } else {
        el.scrollLeft = el.scrollWidth;
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
      el.focus();
      setTimeout(checkOverflowX, 80);
    }
  };

  const isLong = hasOverflowX || maxLineLength > 16;

  return (
    <div
      ref={cardRef}
      className="pkg-inline-editor-card"
      style={{
        position: 'absolute',
        left: `${cardLeft}px`,
        top: `${cardTop}px`,
        width: `${cardWidth}px`,
        background: '#ffffff',
        borderRadius: '10px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25), 0 0 0 2px #2f5a4b',
        padding: '8px 10px 10px',
        boxSizing: 'border-box',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div
        className="pkg-inline-editor-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '12px',
          fontWeight: 600,
          color: '#2f5a4b',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>문구 직접 편집</span>
          {lineCount > 1 && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#1e293b',
                background: '#e2e8f0',
                padding: '1px 5px',
                borderRadius: '4px',
              }}
            >
              {lineCount}줄
            </span>
          )}
          {isLong && (
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 500,
                color: '#0369a1',
                background: '#e0f2fe',
                padding: '1px 5px',
                borderRadius: '4px',
              }}
            >
              ↔ 긴 문구
            </span>
          )}
        </div>
        <span
          className="pkg-inline-editor-counter"
          aria-live="polite"
          style={{
            color: draftText.length >= 120 ? '#c0392b' : '#64748b',
            fontSize: '11.5px',
          }}
        >
          {draftText.length}/120자
        </span>
      </div>

      <textarea
        ref={textareaRef}
        className="pkg-inline-editor-textarea"
        aria-label={isCard ? '카드 문구 직접 편집' : '스티커 문구 직접 편집'}
        value={draftText}
        maxLength={120}
        rows={Math.min(4, lineCount)}
        wrap="off"
        spellCheck={false}
        onChange={(e) => {
          const next = e.target.value.replace(/\r\n/g, '\n').slice(0, 120);
          setDraftText(next);
        }}
        onScroll={checkOverflowX}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="문구를 입력하세요"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          height: `${textareaHeightPx}px`,
          minHeight: '42px',
          padding: '6px 8px',
          fontSize: `${renderedFontSize}px`,
          fontFamily: family,
          fontWeight: fontWeight(layer.font),
          lineHeight: 1.35,
          textAlign: isLong ? 'left' : 'center',
          whiteSpace: 'pre',
          overflowX: 'auto',
          overflowY: lineCount > 4 ? 'auto' : 'hidden',
          wordWrap: 'normal',
          overflowWrap: 'normal',
          color: '#1a202c',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          resize: 'none',
          outline: 'none',
        }}
      />

      <div
        className="pkg-inline-editor-actions"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontSize: '11px',
              color: '#64748b',
              userSelect: 'none',
            }}
          >
            Enter 줄바꿈 (자동 줄바꿈 없음)
          </span>
          {isLong && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <button
                type="button"
                className="pkg-inline-scroll-btn pkg-inline-scroll-left"
                aria-label="문구 맨 앞으로 이동"
                title="문구 맨 앞으로 이동"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => scrollToEdge('start')}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  fontWeight: 500,
                  color: '#475569',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  minHeight: '24px',
                }}
              >
                ◀ 앞
              </button>
              <button
                type="button"
                className="pkg-inline-scroll-btn pkg-inline-scroll-right"
                aria-label="문구 맨 뒤로 이동"
                title="문구 맨 뒤로 이동"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => scrollToEdge('end')}
                style={{
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  fontWeight: 500,
                  color: '#475569',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  minHeight: '24px',
                }}
              >
                뒤 ▶
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="pkg-inline-cancel-btn"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleCancel}
            aria-label="문구 편집 취소"
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 500,
              color: '#475569',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              cursor: 'pointer',
              minHeight: '32px',
            }}
          >
            취소
          </button>
          <button
            type="button"
            className="pkg-inline-done-btn"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleCommit}
            aria-label="문구 편집 완료"
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#ffffff',
              background: '#2f5a4b',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              minHeight: '32px',
            }}
          >
            완료
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StickerCanvas(props: Props) {
  const { displaySize, shape, sizeCm, cardSizeMm, background, layers, fontFamilies, selectedId, onSelect, onChange, apiRef, onTextRects, warnBoxes, onReady, onFontFallback } = props;
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const guidesRef = useRef<Konva.Layer>(null);
  const [fontVersion, setFontVersion] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const commitActiveEditRef = useRef<(() => void) | null>(null);

  const isCard = !!cardSizeMm;
  const cardUnits = cardSizeMm ? cardCanvasUnits(cardSizeMm) : null;
  const widthUnits = cardUnits ? cardUnits.widthUnits : U;
  const heightUnits = cardUnits ? cardUnits.heightUnits : U;
  const displayWidth = displaySize;
  const displayHeight = Math.round(displayWidth * (heightUnits / widthUnits));
  const scale = displayWidth / widthUnits;
  const centerX = widthUnits / 2;
  const centerY = heightUnits / 2;
  const bleedX = cardUnits ? cardUnits.bleedX : bleedUnits(sizeCm);
  const bleedY = cardUnits ? cardUnits.bleedY : bleedUnits(sizeCm);
  const hair = 1.5 / scale; // 화면에서 1.5px 두께

  // 글꼴 파일이 늦게 도착하면 글자 폭이 달라지므로 문구 노드를 다시 만든다
  useEffect(() => {
    const bump = () => setFontVersion((v) => v + 1);
    document.fonts.addEventListener('loadingdone', bump);
    return () => document.fonts.removeEventListener('loadingdone', bump);
  }, []);
  const textKey = layers.filter((l) => l.type === 'text').map((l) => fontSpec(l as TextLayer, fontFamilies) + (l as TextLayer).text).join('|');
  useEffect(() => {
    void loadCanvasFonts(document.fonts, layers.filter((l) => l.type === 'text').map((l) => ({ font: fontSpec(l as TextLayer, fontFamilies), text: (l as TextLayer).text })));
  }, [textKey]); // 글꼴·문구가 바뀔 때만 (위치 이동에는 다시 부르지 않는다)

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId && !editingId ? stageRef.current?.findOne(`#${selectedId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, editingId, layers, fontVersion]);

  // selectedId가 null이거나 다른 것으로 바뀌면 편집 종료
  useEffect(() => {
    if (editingId && selectedId !== editingId) {
      setEditingId(null);
    }
  }, [selectedId, editingId]);

  useEffect(() => {
    apiRef.current = {
      async exportPng(pixels) {
        if (commitActiveEditRef.current) {
          commitActiveEditRef.current();
          setEditingId(null);
          await new Promise((r) => setTimeout(r, 60));
        }
        setIsExporting(true);
        let stage: Konva.Stage | null = null;
        try {
          const fontsLoaded = await loadCanvasFonts(document.fonts, layers.filter((l) => l.type === 'text').map((l) => ({ font: fontSpec(l as TextLayer, fontFamilies), text: (l as TextLayer).text })));
          onFontFallback?.(!fontsLoaded);
          await new Promise((r) => setTimeout(r, 60));
          stage = stageRef.current;
          if (!stage) throw new Error('편집기가 아직 준비되지 않았습니다.');
          const want = layers.filter((l) => l.type === 'image').length;
          for (let i = 0; i < 20 && stage.find('Image').length < want; i++) await new Promise((r) => setTimeout(r, 200));
          if (stage.find('Image').length < want) throw new Error('이미지를 아직 불러오지 못했어요. 잠시 후 다시 저장해 주세요.');
          trRef.current?.visible(false);
          guidesRef.current?.visible(false);

          const targetW = typeof pixels === 'number' ? pixels : pixels.width;
          const targetH = typeof pixels === 'number' ? pixels : pixels.height;

          const rawCanvas = stage.toCanvas({
            x: 0,
            y: 0,
            width: displayWidth,
            height: displayHeight,
            pixelRatio: (targetW + 0.001) / displayWidth,
          });

          let finalCanvas: HTMLCanvasElement = rawCanvas;
          if (rawCanvas.width !== targetW || rawCanvas.height !== targetH) {
            const exactCanvas = document.createElement('canvas');
            exactCanvas.width = targetW;
            exactCanvas.height = targetH;
            const ctx = exactCanvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(rawCanvas, 0, 0, targetW, targetH);
              finalCanvas = exactCanvas;
            }
          }

          const blob = await new Promise<Blob | null>((resolve) => finalCanvas.toBlob(resolve, 'image/png'));
          if (!blob) throw new Error(`${isCard ? '카드' : '스티커'} 이미지를 만들지 못했어요. 다시 시도해 주세요.`);
          return blob;
        } finally {
          setIsExporting(false);
          trRef.current?.visible(true);
          guidesRef.current?.visible(true);
          stage?.batchDraw();
        }
      },
    };
    onReady?.();
  }, [apiRef, layers, fontFamilies, displayWidth, displayHeight, isCard, onReady, onFontFallback]);

  // 문구 상자 재기: 렌더가 끝날 때마다 (글꼴이 다 오기 전 폭은 틀리므로 기다린다). 바뀌었을 때만 알린다
  const lastRects = useRef('');
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || document.fonts.status !== 'loaded') return;
    const out: Record<string, TextRect> = {};
    for (const l of layers) {
      const n = l.type === 'text' ? stage.findOne<Konva.Text>(`#${l.id}`) : undefined;
      if (!n) continue;
      const r = n.getClientRect({ skipShadow: true });
      out[l.id] = { x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale, text: n.text(), fontSize: n.fontSize() };
    }
    const key = JSON.stringify(out);
    if (key === lastRects.current) return;
    lastRects.current = key;
    onTextRects(out);
  });

  // 가운데 맞춤 자석: 끌다가 가운데에서 화면 8px 안으로 오면 붙이고 안내선을 보인다
  const [snap, setSnap] = useState({ v: false, h: false });
  const drag: DragProps = {
    onDragMove(e) {
      const n = e.target;
      const near = 8 / scale;
      const v = Math.abs(n.x() - centerX) < near;
      const h = Math.abs(n.y() - centerY) < near;
      if (v) n.x(centerX);
      if (h) n.y(centerY);
      setSnap((s) => (s.v === v && s.h === h ? s : { v, h }));
    },
    onDragEnd: () => setSnap({ v: false, h: false }),
  };

  const clip = (ctx: Konva.Context) => {
    if (isCard) {
      ctx.rect(0, 0, widthUnits, heightUnits);
    } else if (shape === 'circle') {
      ctx.arc(centerX, centerY, centerX, 0, Math.PI * 2, false);
    } else {
      ctx.rect(0, 0, widthUnits, heightUnits);
    }
  };

  const deselectIfEmpty = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage() || e.target.name() === 'bg') {
      if (editingId !== null) {
        commitActiveEditRef.current?.();
        setEditingId(null);
      }
      onSelect(null);
    }
  };

  const editingLayer = layers.find((l): l is TextLayer => l.id === editingId && l.type === 'text');

  return (
    <div
      className="pkg-canvas-stage-wrapper"
      style={{
        position: 'relative',
        width: displayWidth,
        height: displayHeight,
        margin: '0 auto',
      }}
    >
      <Stage
        ref={stageRef}
        width={displayWidth}
        height={displayHeight}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={deselectIfEmpty}
        onTouchStart={deselectIfEmpty}
      >
        <KLayer>
          <Group clipFunc={clip}>
            <Rect name="bg" x={0} y={0} width={widthUnits} height={heightUnits} fill={background} />
            {layers.map((l) =>
              l.type === 'image' ? (
                <ImageNode key={l.id} layer={l} onSelect={() => { commitActiveEditRef.current?.(); onSelect(l.id); }} onChange={(p) => onChange(l.id, p)} drag={drag} />
              ) : (
                <TextNode
                  key={`${l.id}-${fontVersion}`}
                  layer={l}
                  family={fontFamilies[l.font as FontId] ?? fontFamilies.sans}
                  isEditing={editingId === l.id}
                  isExporting={isExporting}
                  onSelect={() => { if (editingId !== l.id) commitActiveEditRef.current?.(); onSelect(l.id); }}
                  onStartEdit={() => setEditingId(l.id)}
                  onChange={(p) => onChange(l.id, p)}
                  drag={drag}
                />
              ),
            )}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            anchorSize={20}
            anchorCornerRadius={4}
            borderStroke="#2f5a4b"
            anchorStroke="#2f5a4b"
            rotationSnaps={[0, 90, 180, 270]}
            boundBoxFunc={(oldBox, box) => (Math.abs(box.width) < 20 || Math.abs(box.height) < 20 ? oldBox : box)}
            onTransformEnd={(e) => {
              const n = e.target;
              onChange(n.id(), { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() });
            }}
          />
        </KLayer>

        {/* 안내선: 인쇄 파일에는 들어가지 않는다 */}
        <KLayer ref={guidesRef} listening={false}>
          <Shape
            sceneFunc={(ctx, s) => {
              ctx.beginPath();
              if (isCard) {
                ctx.rect(0, 0, widthUnits, heightUnits);
                ctx.moveTo(bleedX, bleedY);
                ctx.lineTo(bleedX, heightUnits - bleedY);
                ctx.lineTo(widthUnits - bleedX, heightUnits - bleedY);
                ctx.lineTo(widthUnits - bleedX, bleedY);
                ctx.closePath();
              } else if (shape === 'circle') {
                ctx.arc(centerX, centerY, centerX, 0, Math.PI * 2, false);
                ctx.moveTo(centerX + centerX - bleedX, centerY);
                ctx.arc(centerX, centerY, centerX - bleedX, 0, Math.PI * 2, true);
              } else {
                ctx.rect(0, 0, widthUnits, heightUnits);
                ctx.moveTo(bleedX, bleedY);
                ctx.lineTo(bleedX, heightUnits - bleedY);
                ctx.lineTo(widthUnits - bleedX, heightUnits - bleedY);
                ctx.lineTo(widthUnits - bleedX, bleedY);
                ctx.closePath();
              }
              ctx.fillStrokeShape(s);
            }}
            fill="rgba(245,242,234,0.72)"
          />
          {isCard ? (
            <>
              <Rect x={bleedX} y={bleedY} width={widthUnits - 2 * bleedX} height={heightUnits - 2 * bleedY} stroke="#c0392b" strokeWidth={hair} dash={[10, 8]} />
              <Rect x={2 * bleedX} y={2 * bleedY} width={widthUnits - 4 * bleedX} height={heightUnits - 4 * bleedY} stroke="#8a948f" strokeWidth={hair} dash={[4, 8]} />
            </>
          ) : shape === 'circle' ? (
            <>
              <Circle x={centerX} y={centerY} radius={centerX - bleedX} stroke="#c0392b" strokeWidth={hair} dash={[10, 8]} />
              <Circle x={centerX} y={centerY} radius={centerX - 2 * bleedX} stroke="#8a948f" strokeWidth={hair} dash={[4, 8]} />
            </>
          ) : (
            <>
              <Rect x={bleedX} y={bleedY} width={widthUnits - 2 * bleedX} height={heightUnits - 2 * bleedY} stroke="#c0392b" strokeWidth={hair} dash={[10, 8]} />
              <Rect x={2 * bleedX} y={2 * bleedY} width={widthUnits - 4 * bleedX} height={heightUnits - 4 * bleedY} stroke="#8a948f" strokeWidth={hair} dash={[4, 8]} />
            </>
          )}
          {snap.v && <Line points={[centerX, 0, centerX, heightUnits]} stroke="#2f5a4b" strokeWidth={hair} dash={[6, 6]} />}
          {snap.h && <Line points={[0, centerY, widthUnits, centerY]} stroke="#2f5a4b" strokeWidth={hair} dash={[6, 6]} />}
          {warnBoxes.map((w, i) => (
            <Rect key={i} x={w.x} y={w.y} width={w.width} height={w.height} stroke="#c0392b" strokeWidth={hair * 1.4} dash={[8, 6]} cornerRadius={4 / scale} />
          ))}
        </KLayer>
      </Stage>

      {editingLayer && (
        <InlineTextEditor
          key={editingLayer.id}
          layer={editingLayer}
          scale={scale}
          displayWidth={displayWidth}
          displayHeight={displayHeight}
          family={fontFamilies[editingLayer.font as FontId] ?? fontFamilies.sans}
          isCard={isCard}
          onChange={(patch) => onChange(editingLayer.id, patch)}
          onClose={() => setEditingId(null)}
          commitRef={commitActiveEditRef}
        />
      )}
    </div>
  );
}
