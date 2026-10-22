'use client';

// 스티커 편집 캔버스 (Konva). 브라우저 전용이라 packaging-editor.tsx에서 ssr:false로 불러온다.
// 좌표계: 재단 여백 포함 전체를 1000으로 보고, 화면 크기에 맞춰 Stage를 축소해 보여 준다.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Circle, Group, Image as KImage, Layer as KLayer, Line, Rect, Shape, Stage, Text as KText, Transformer } from 'react-konva';
import type Konva from 'konva';
import { CANVAS_UNITS, bleedUnits, type Box, type FontId } from '@/packaging/rules.ts';
import type { StickerShape, TextLayer } from '@/packaging/types.ts';
import type { CanvasApi, EditorImageLayer, EditorLayer, TextRect } from './editor-types.ts';

type Props = {
  displaySize: number;
  shape: StickerShape;
  sizeCm: number;
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
};

type DragProps = { onDragMove(e: Konva.KonvaEventObject<DragEvent>): void; onDragEnd(): void };

const U = CANVAS_UNITS;
const C = U / 2;

export const fontWeight = (font: string) => (font === 'pen' ? 'normal' : 'bold');

function fontSpec(l: TextLayer, families: Record<FontId, string>): string {
  return `${fontWeight(l.font)} ${Math.round(l.fontSize)}px ${families[l.font as FontId] ?? families.sans}`;
}

function useHtmlImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const el = new window.Image();
    // 다른 도메인(Supabase 저장소) 이미지가 캔버스를 오염시켜 내보내기가 막히지 않도록
    if (/^https?:/.test(src)) el.crossOrigin = 'anonymous';
    el.onload = () => setImg(el);
    el.onerror = () => console.warn('[포장 디자인] 이미지를 불러오지 못함:', src);
    el.src = src;
    return () => { el.onload = null; el.onerror = null; };
  }, [src]);
  return img;
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

function TextNode({ layer, family, onSelect, onChange, drag }: { layer: TextLayer; family: string; onSelect(): void; onChange(p: Partial<EditorLayer>): void; drag: DragProps }) {
  const ref = useRef<Konva.Text>(null);
  // 가운데 기준으로 돌고 커지도록 글자 크기를 잰 뒤 기준점을 옮긴다
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    n.offsetX(n.width() / 2);
    n.offsetY(n.height() / 2);
    n.getLayer()?.batchDraw();
  });
  return (
    <KText
      ref={ref}
      id={layer.id}
      text={layer.text}
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
      fill={layer.color}
      stroke={layer.stroke ?? undefined}
      strokeWidth={layer.stroke ? layer.fontSize * 0.12 : 0}
      fillAfterStrokeEnabled
      lineJoin="round"
      shadowEnabled={layer.shadow}
      shadowColor="rgba(0,0,0,0.45)"
      shadowBlur={layer.fontSize * 0.15}
      shadowOffsetX={layer.fontSize * 0.04}
      shadowOffsetY={layer.fontSize * 0.06}
      draggable
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragMove={drag.onDragMove}
      onDragEnd={(e) => { drag.onDragEnd(); onChange({ x: e.target.x(), y: e.target.y() }); }}
    />
  );
}

export default function StickerCanvas(props: Props) {
  const { displaySize, shape, sizeCm, background, layers, fontFamilies, selectedId, onSelect, onChange, apiRef, onTextRects, warnBoxes } = props;
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const guidesRef = useRef<Konva.Layer>(null);
  const [fontVersion, setFontVersion] = useState(0);
  const scale = displaySize / U;
  const b = bleedUnits(sizeCm);
  const hair = 1.5 / scale; // 화면에서 1.5px 두께

  // 글꼴 파일이 늦게 도착하면 글자 폭이 달라지므로 문구 노드를 다시 만든다
  useEffect(() => {
    const bump = () => setFontVersion((v) => v + 1);
    document.fonts.addEventListener('loadingdone', bump);
    return () => document.fonts.removeEventListener('loadingdone', bump);
  }, []);
  const textKey = layers.filter((l) => l.type === 'text').map((l) => fontSpec(l as TextLayer, fontFamilies) + (l as TextLayer).text).join('|');
  useEffect(() => {
    for (const l of layers) if (l.type === 'text') void document.fonts.load(fontSpec(l, fontFamilies), l.text);
  }, [textKey]); // 글꼴·문구가 바뀔 때만 (위치 이동에는 다시 부르지 않는다)

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? stageRef.current?.findOne(`#${selectedId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, layers, fontVersion]);

  useEffect(() => {
    apiRef.current = {
      async exportPng(pixels) {
        await Promise.all(layers.filter((l) => l.type === 'text').map((l) => document.fonts.load(fontSpec(l as TextLayer, fontFamilies), (l as TextLayer).text)));
        await document.fonts.ready;
        await new Promise((r) => setTimeout(r, 60)); // 글꼴 도착 후 문구 노드가 다시 그려질 시간
        const stage = stageRef.current;
        if (!stage) throw new Error('편집기가 아직 준비되지 않았습니다.');
        // 이미지가 아직 안 그려졌으면(느린 망) 최대 8초 기다린다. 끝내 못 그리면 빈 스티커로 접수되지 않게 막는다
        const want = layers.filter((l) => l.type === 'image').length;
        for (let i = 0; i < 40 && stage.find('Image').length < want; i++) await new Promise((r) => setTimeout(r, 200));
        if (stage.find('Image').length < want) throw new Error('이미지를 아직 불러오지 못했어요. 잠시 후 다시 저장해 주세요.');
        trRef.current?.visible(false);
        guidesRef.current?.visible(false);
        try {
          return (await stage.toBlob({ pixelRatio: pixels / displaySize, mimeType: 'image/png' })) as Blob;
        } finally {
          trRef.current?.visible(true);
          guidesRef.current?.visible(true);
          stage.batchDraw();
        }
      },
    };
  }, [apiRef, layers, fontFamilies, displaySize]);

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
      const v = Math.abs(n.x() - C) < near;
      const h = Math.abs(n.y() - C) < near;
      if (v) n.x(C);
      if (h) n.y(C);
      setSnap((s) => (s.v === v && s.h === h ? s : { v, h }));
    },
    onDragEnd: () => setSnap({ v: false, h: false }),
  };

  const clip = (ctx: Konva.Context) => {
    if (shape === 'circle') ctx.arc(C, C, C, 0, Math.PI * 2, false);
    else ctx.rect(0, 0, U, U);
  };

  const deselectIfEmpty = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage() || e.target.name() === 'bg') onSelect(null);
  };

  return (
    <Stage
      ref={stageRef}
      width={displaySize}
      height={displaySize}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={deselectIfEmpty}
      onTouchStart={deselectIfEmpty}
    >
      <KLayer>
        <Group clipFunc={clip}>
          <Rect name="bg" x={0} y={0} width={U} height={U} fill={background} />
          {layers.map((l) =>
            l.type === 'image' ? (
              <ImageNode key={l.id} layer={l} onSelect={() => onSelect(l.id)} onChange={(p) => onChange(l.id, p)} drag={drag} />
            ) : (
              <TextNode
                key={`${l.id}-${fontVersion}`}
                layer={l}
                family={fontFamilies[l.font as FontId] ?? fontFamilies.sans}
                onSelect={() => onSelect(l.id)}
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
          anchorSize={14}
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
            if (shape === 'circle') {
              ctx.arc(C, C, C, 0, Math.PI * 2, false);
              ctx.moveTo(C + C - b, C);
              ctx.arc(C, C, C - b, 0, Math.PI * 2, true);
            } else {
              ctx.rect(0, 0, U, U);
              ctx.moveTo(b, b);
              ctx.lineTo(b, U - b);
              ctx.lineTo(U - b, U - b);
              ctx.lineTo(U - b, b);
              ctx.closePath();
            }
            ctx.fillStrokeShape(s);
          }}
          fill="rgba(245,242,234,0.72)"
        />
        {shape === 'circle' ? (
          <>
            <Circle x={C} y={C} radius={C - b} stroke="#c0392b" strokeWidth={hair} dash={[10, 8]} />
            <Circle x={C} y={C} radius={C - 2 * b} stroke="#8a948f" strokeWidth={hair} dash={[4, 8]} />
          </>
        ) : (
          <>
            <Rect x={b} y={b} width={U - 2 * b} height={U - 2 * b} stroke="#c0392b" strokeWidth={hair} dash={[10, 8]} />
            <Rect x={2 * b} y={2 * b} width={U - 4 * b} height={U - 4 * b} stroke="#8a948f" strokeWidth={hair} dash={[4, 8]} />
          </>
        )}
        {snap.v && <Line points={[C, 0, C, U]} stroke="#2f5a4b" strokeWidth={hair} dash={[6, 6]} />}
        {snap.h && <Line points={[0, C, U, C]} stroke="#2f5a4b" strokeWidth={hair} dash={[6, 6]} />}
        {warnBoxes.map((w, i) => (
          <Rect key={i} x={w.x} y={w.y} width={w.width} height={w.height} stroke="#c0392b" strokeWidth={hair * 1.4} dash={[8, 6]} cornerRadius={4 / scale} />
        ))}
      </KLayer>
    </Stage>
  );
}
