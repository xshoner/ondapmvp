'use client';

// 고객 포장 꾸미기: 포장 스타일 고르기 → (무료) 스티커 꾸미기 → 저장하면 디자인 코드 발급.
// 단계를 줄이려고 한 화면에 모두 두고, 행사에 맞는 추천 이미지를 처음부터 깔아 둔다 (바로 저장해도 된다).

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FONTS, MIN_PRINT_DPI, PLACEHOLDER_BLANK, STICKER_SIZES, effectiveDpi, fillPlaceholders, printPixels, type FontId,
} from '@/packaging/rules.ts';
import type { EventType } from '@/engine/types.ts';
import type { DesignCategory, DesignDraft, DesignImage, DesignText, PackagingStyle, StickerShape, StickerSizeCm, TextLayer } from '@/packaging/types.ts';
import { saveDesignAction } from './actions.ts';
import type { CanvasApi, EditorImageLayer, EditorLayer } from './editor-types.ts';

const StickerCanvas = dynamic(() => import('./sticker-canvas.tsx'), {
  ssr: false,
  loading: () => <div className="stage-loading">편집기를 불러오는 중…</div>,
});

export type PackagingEntry = 'recommend' | 'cafe24' | 'pick';

type Props = {
  product: { productNo: number; name: string; price: number; image: string | null; url: string };
  quantity: number;
  event: EventType | null;
  events: { id: EventType; name: string }[];
  // 들어온 곳: 추천 결과, 카페24 상품 페이지 버튼, '포장만 꾸미기' 상품 선택
  from: PackagingEntry;
  styles: PackagingStyle[];
  images: DesignImage[];
  texts: DesignText[];
  categoryNames: Record<string, string>;
  fontFamilies: Record<FontId, string>;
};

const COLORS = ['#1f2a26', '#ffffff', '#2f5a4b', '#b8903a', '#b5523b', '#1d3557', '#7a2e3a', '#e8a0b4'];
const BACKGROUNDS = ['#ffffff', '#f6edd8', '#e3ede7', '#f7e6e1', '#1f3f34'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

// 카페24 상품 주소에 코드·수량을 붙인다. 쇼핑몰 스킨의 public/cafe24/ondap-helper.js가 읽어 수량을 맞추고 주문서에 코드를 넣는다.
// 휴대폰은 처음부터 모바일 쇼핑몰(/m/) 주소로 보낸다: PC 주소로 가면 카페24가 /m/으로 넘기면서 붙인 값을 버린다
function orderUrl(productUrl: string, code: string, quantity: number): string {
  try {
    const u = new URL(productUrl);
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) && !u.pathname.startsWith('/m/')) u.pathname = `/m${u.pathname}`;
    u.searchParams.set('ondap_code', code);
    u.searchParams.set('ondap_qty', String(quantity));
    return u.toString();
  } catch {
    return productUrl;
  }
}
const newId = () => 'l' + Math.random().toString(36).slice(2, 9);

function loadNatural(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
    img.src = src;
  });
}

// 재단 여백까지 빈틈없이 덮도록 (짧은 변을 1000에 맞춤)
function coverLayer(src: string, w: number, h: number, extra: Partial<EditorImageLayer> = {}): EditorImageLayer {
  const r = w / h;
  return {
    id: newId(), type: 'image', src, x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1,
    width: r >= 1 ? 1000 * r : 1000, height: r >= 1 ? 1000 : 1000 / r, ...extra,
  };
}

function textLayer(text: string, y = 500): TextLayer {
  return { id: newId(), type: 'text', text, x: 500, y, rotation: 0, scaleX: 1, scaleY: 1, font: 'serif', fontSize: 78, color: '#1f2a26', stroke: null, shadow: false };
}

// 행사 분류 → 공통 → 나머지 순서
function byRelevance<T extends { category: DesignCategory; sort: number }>(items: T[], event: DesignCategory | null): T[] {
  const rank = (c: DesignCategory) => (c === event ? 0 : c === 'common' ? 1 : 2);
  return [...items].sort((a, b) => rank(a.category) - rank(b.category) || a.sort - b.sort);
}

export function PackagingEditor(props: Props) {
  const { product, styles, categoryNames, fontFamilies, events, from } = props;
  // 추천을 거치지 않고 들어오면 행사를 모르므로 화면에서 고르게 한다 (안 골라도 공통 이미지로 꾸밀 수 있다)
  const [event, setEvent] = useState<DesignCategory | null>(props.event);
  const [quantity, setQuantity] = useState(props.quantity);
  const eventName = event && event !== 'common' ? categoryNames[event] : null;
  const images = useMemo(() => byRelevance(props.images, event), [props.images, event]);
  const texts = useMemo(() => byRelevance(props.texts, event), [props.texts, event]);
  const nearTexts = texts.filter((t) => t.category === event || t.category === 'common');
  const otherTexts = texts.filter((t) => !nearTexts.includes(t));

  const [styleId, setStyleId] = useState(styles[0]?.id ?? '');
  const [withSticker, setWithSticker] = useState(true);
  const [shape, setShape] = useState<StickerShape>('circle');
  const [sizeCm, setSizeCm] = useState<StickerSizeCm>(6);
  const [background, setBackground] = useState('#ffffff');
  const [layers, setLayers] = useState<EditorLayer[]>([]);
  const [fields, setFields] = useState<DesignDraft['fields']>({ recipient: '', sender: '', date: '' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'image' | 'text'>('image');
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ code: string; copied: boolean; preview: string | null } | null>(null);
  const apiRef = useRef<CanvasApi | null>(null);
  const autoLayer = useRef<EditorLayer | null>(null); // 화면이 자동으로 깐 레이어 (고객이 움직이면 새 객체가 되어 더는 같지 않다)
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [displaySize, setDisplaySize] = useState(0);

  // 처음 화면: 행사 추천 이미지가 있으면 깔아 두고, 없으면 추천 문구 한 줄
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // 개발 모드(StrictMode)에서 두 번 돌아도 한 번만 깐다
    started.current = true;
    const first = images.find((i) => i.category === event);
    if (first) {
      void loadNatural(first.imageUrl).then(({ w, h }) => {
        const l = coverLayer(first.imageUrl, w, h);
        autoLayer.current = l;
        setLayers((ls) => (ls.length ? ls : [l]));
      });
    } else if (nearTexts[0]) {
      const l = textLayer(nearTexts[0].text);
      autoLayer.current = l;
      setLayers((ls) => (ls.length ? ls : [l]));
      setTab('text');
    }
  }, []); // 처음 한 번만

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = (width: number) => setDisplaySize(Math.floor(Math.min(width, 420)));
    fit(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [withSticker]);

  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const rendered = useMemo(
    () => layers.map((l) => (l.type === 'text' ? { ...l, text: fillPlaceholders(l.text, fields) } : l)),
    [layers, fields],
  );
  const usedPlaceholders = useMemo(() => {
    const all = layers.filter((l) => l.type === 'text').map((l) => (l as TextLayer).text).join(' ');
    return { recipient: all.includes('{받는분}'), sender: all.includes('{보내는분}'), date: all.includes('{날짜}') };
  }, [layers]);
  const hasBlank = rendered.some((l) => l.type === 'text' && l.text.includes(PLACEHOLDER_BLANK));
  const uploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
  const lowRes = uploads.some((l) => effectiveDpi(l.naturalWidth ?? 0, l.width * l.scaleX, sizeCm) < MIN_PRINT_DPI);

  const update = (id: string, patch: Partial<EditorLayer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as EditorLayer) : l)));

  // 바탕 이미지는 한 장: 맨 아래가 이미지면 바꾸고, 아니면 맨 아래에 넣는다
  const setBaseImage = (layer: EditorImageLayer) => {
    setLayers((ls) => {
      const old = ls[0]?.type === 'image' ? (ls[0] as EditorImageLayer) : null;
      if (old?.uploaded && old.src !== layer.src) URL.revokeObjectURL(old.src);
      return [layer, ...(old ? ls.slice(1) : ls)];
    });
    setSelectedId(null);
  };

  const pickImage = async (img: DesignImage, auto = false) => {
    try {
      const { w, h } = await loadNatural(img.imageUrl);
      const layer = coverLayer(img.imageUrl, w, h);
      if (auto) autoLayer.current = layer;
      setBaseImage(layer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 행사를 고르면 바탕이 추천 이미지(직접 올린 사진 아님)일 때 새 행사의 첫 이미지로 바꾸고, 고객이 넣은 문구는 그대로 둔다.
  // 화면이 처음 자동으로 깐 것(손대기 전)은 새 행사 것으로 통째로 바꾼다
  const chooseEvent = (id: EventType) => {
    setEvent(id);
    const untouched = layers.length === 0 || (layers.length === 1 && layers[0] === autoLayer.current);
    const base = layers[0];
    const first = props.images.find((i) => i.category === id);
    if (first) {
      if (untouched) setLayers([]);
      if (untouched || !(base?.type === 'image' && base.uploaded)) void pickImage(first, true);
    } else if (untouched) {
      const t = props.texts.find((x) => x.category === id) ?? props.texts.find((x) => x.category === 'common');
      if (t) {
        const l = textLayer(t.text);
        autoLayer.current = l;
        setLayers([l]);
      }
    }
  };

  const onUpload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return setError('JPG 또는 PNG 사진만 올릴 수 있어요.');
    if (file.size > MAX_UPLOAD_BYTES) return setError('사진은 10MB까지 올릴 수 있어요.');
    const url = URL.createObjectURL(file);
    try {
      const { w, h } = await loadNatural(url);
      setBaseImage(coverLayer(url, w, h, { uploaded: true, naturalWidth: w }));
    } catch {
      URL.revokeObjectURL(url);
      setError('사진을 읽을 수 없어요. 다른 사진을 골라 주세요.');
    }
  };

  const pickText = (t: DesignText) => {
    if (selected?.type === 'text') update(selected.id, { text: t.text });
    else {
      const hasImage = layers.some((l) => l.type === 'image');
      const l = textLayer(t.text, hasImage ? 780 : 500);
      if (hasImage) Object.assign(l, { fontSize: 64, color: '#ffffff', stroke: '#1f2a26' });
      setLayers((ls) => [...ls, l]);
      setSelectedId(l.id);
    }
  };

  const addText = () => {
    const l = textLayer('감사합니다');
    setLayers((ls) => [...ls, l]);
    setSelectedId(l.id);
    setTab('text');
  };

  const removeSelected = () => {
    if (!selected) return;
    if (selected.type === 'image' && selected.uploaded) URL.revokeObjectURL(selected.src);
    setLayers((ls) => ls.filter((l) => l.id !== selected.id));
    setSelectedId(null);
  };

  const moveSelected = (dir: 1 | -1) => {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === selectedId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setError(null);
    if (!styleId) return setError('포장 스타일을 골라 주세요.');
    if (withSticker && layers.length === 0) return setError('스티커에 이미지나 문구를 하나 이상 넣어 주세요.');
    if (withSticker && uploads.length > 0 && !consent) return setError('올린 사진의 사용 권한을 확인해 주세요.');
    setSaving(true);
    setSelectedId(null);
    try {
      const form = new FormData();
      let preview: string | null = null;
      let draft: DesignDraft | null = null;
      if (withSticker) {
        if (!apiRef.current) throw new Error('편집기가 아직 준비되지 않았습니다.');
        const blob = await apiRef.current.exportPng(printPixels(sizeCm));
        form.set('print', blob, 'print.png');
        preview = URL.createObjectURL(blob);
        draft = {
          background,
          fields,
          layers: layers.map((l) => {
            if (l.type !== 'image') return l;
            const { uploaded, naturalWidth: _w, ...rest } = l;
            return uploaded ? { ...rest, src: 'upload' } : rest;
          }),
        };
      }
      form.set('meta', JSON.stringify({
        productNo: product.productNo, quantity, event, styleId,
        sticker: withSticker ? { shape, sizeCm } : null, draft,
      }));
      const res = await saveDesignAction(form);
      if (!res.ok) {
        if (preview) URL.revokeObjectURL(preview);
        return setError(res.message);
      }
      let copied = false;
      try {
        await navigator.clipboard.writeText(res.code);
        copied = true;
      } catch {
        // 브라우저가 자동 복사를 막으면 복사 버튼으로 안내
      }
      setResult({ code: res.code, copied, preview });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const copyAgain = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setResult({ ...result, copied: true });
    } catch {
      setError('복사가 막혀 있어요. 코드를 길게 눌러 직접 복사해 주세요.');
    }
  };

  const style = styles.find((s) => s.id === styleId);

  return (
    <>
      <h1 style={{ fontSize: 24, marginTop: 8 }}>선물을 정성껏<br />싸 드릴게요</h1>
      <p className="lead" style={{ marginBottom: 18 }}>포장지를 고르고, 스티커에 문구와 그림을 넣어 주세요. 포장과 스티커는 무료입니다.</p>

      <section className="product-strip">
        {product.image && <Image src={product.image} alt="" width={68} height={68} priority style={{ objectFit: 'cover' }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.4 }}>{product.name}</div>
          <div className="small muted num">{won(product.price)}{eventName ? `, ${eventName}` : ''}</div>
          <label className="small row" style={{ gap: 6, margin: '4px 0 0' }}>
            수량
            <input
              type="number"
              className="qty-input"
              min={1}
              max={100000}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(100000, Math.max(1, Math.round(Number(e.target.value) || 1))))}
              aria-label="수량"
            />
            개
          </label>
        </div>
      </section>

      <section className="step">
        <h2 className="step-label"><span className="step-no">1</span>포장지</h2>
        <div className="style-grid">
          {styles.map((s) => (
            <button key={s.id} type="button" className="thumb" aria-pressed={s.id === styleId} onClick={() => setStyleId(s.id)}>
              {/* 화면에는 썸네일만 필요: 원본(최대 1200px) 대신 줄인 그림을 받는다 */}
              <Image src={s.imageUrl} alt="" width={240} height={240} sizes="(max-width: 480px) 30vw, 150px" priority />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        {style?.description && <p className="small muted" style={{ margin: '8px 0 0' }}>{style.description}</p>}
      </section>

      <section className="step">
        <h2 className="step-label"><span className="step-no">2</span>함께 넣을 인쇄물</h2>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={withSticker} onClick={() => setWithSticker(true)}>스티커 (무료)</button>
          <button type="button" className="chip" disabled title="준비 중">엽서 (준비 중)</button>
          <button type="button" className="chip" disabled title="준비 중">띠지 (준비 중)</button>
          <button type="button" className="chip" aria-pressed={!withSticker} onClick={() => setWithSticker(false)}>인쇄물 없이</button>
        </div>
      </section>

      {withSticker && (
        <section className="step">
          <h2 className="step-label"><span className="step-no">3</span>스티커 꾸미기</h2>
          <div className="small" style={{ fontWeight: 600, marginBottom: 8, color: 'var(--ink-soft)' }}>
            어떤 자리인가요? <span className="muted" style={{ fontWeight: 400 }}>고르면 어울리는 그림과 문구가 먼저 나와요</span>
          </div>
          <div className="chips event-chips">
            {events.map((e) => (
              <button key={e.id} type="button" className="chip" aria-pressed={event === e.id} onClick={() => chooseEvent(e.id)}>{e.name}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={shape === 'circle'} onClick={() => setShape('circle')}>● 원형</button>
              <button type="button" className="chip" aria-pressed={shape === 'square'} onClick={() => setShape('square')}>■ 사각</button>
            </div>
            <div className="chips">
              {STICKER_SIZES.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={sizeCm === s} onClick={() => setSizeCm(s)}>{s}×{s}cm</button>
              ))}
            </div>
          </div>

          <div ref={wrapRef} className="stage-wrap" style={{ marginTop: 14 }}>
            {displaySize > 0 && (
              <StickerCanvas
                displaySize={displaySize}
                shape={shape}
                sizeCm={sizeCm}
                background={background}
                layers={rendered}
                fontFamilies={fontFamilies}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={update}
                apiRef={apiRef}
              />
            )}
          </div>
          <p className="guide-note">
            <span className="cut">빨간 점선: 자르는 선</span>
            <span>회색 점선 안에 글자를 두면 안전해요</span>
          </p>
          {lowRes && (
            <p className="small" style={{ color: 'var(--red)', margin: '6px 0 0', textAlign: 'center' }}>
              올린 사진의 해상도가 낮아 인쇄하면 흐릿할 수 있어요. 가로 {printPixels(sizeCm)}px 이상 사진을 권장해요.
            </p>
          )}

          {selected && (
            <div className="layer-bar">
              <span className="small" style={{ fontWeight: 600 }}>{selected.type === 'text' ? '선택한 문구' : '선택한 이미지'}</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn ghost small" onClick={() => moveSelected(-1)}>뒤로</button>
              <button type="button" className="btn ghost small" onClick={() => moveSelected(1)}>앞으로</button>
              <button type="button" className="btn ghost small" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={removeSelected}>삭제</button>
            </div>
          )}

          <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
            <button type="button" role="tab" aria-selected={tab === 'image'} onClick={() => setTab('image')}>이미지</button>
            <button type="button" role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')}>문구</button>
          </div>

          {tab === 'image' ? (
            <div className="tab-body">
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>내 사진 올리기</button>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setNotice('AI 이미지 만들기는 곧 열릴 예정이에요. 지금은 추천 이미지나 내 사진으로 꾸며 주세요.')}
                >
                  AI로 그림 만들기 <span className="pill gray" style={{ padding: '0 6px', fontSize: 11 }}>준비 중</span>
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { void onUpload(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              {notice && <p className="small muted" style={{ margin: '8px 0 0' }}>{notice}</p>}
              <p className="small muted" style={{ margin: '8px 0 0' }}>JPG·PNG, 10MB까지. 직접 찍었거나 사용 권한이 있는 사진만 올려 주세요.</p>
              {uploads.length > 0 && (
                <label className="small row" style={{ gap: 6, marginTop: 6 }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  올린 사진은 제가 찍었거나 사용 권한이 있는 사진입니다.
                </label>
              )}

              <div className="field-label" style={{ marginTop: 16 }}>추천 이미지</div>
              <div className="sticker-grid">
                {images.map((img) => (
                  <button key={img.id} type="button" className="thumb" onClick={() => void pickImage(img)}
                    aria-pressed={layers[0]?.type === 'image' && layers[0].src === img.imageUrl}>
                    <Image src={img.imageUrl} alt={img.name} width={200} height={200} sizes="(max-width: 480px) 22vw, 110px" />
                    <span>{categoryNames[img.category] ?? ''}</span>
                  </button>
                ))}
              </div>

              <div className="field-label" style={{ marginTop: 16 }}>바탕색</div>
              <div className="row" style={{ gap: 8 }}>
                {BACKGROUNDS.map((c) => (
                  <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={background === c} aria-label={`바탕색 ${c}`} onClick={() => setBackground(c)} />
                ))}
              </div>
            </div>
          ) : (
            <div className="tab-body">
              {(usedPlaceholders.recipient || usedPlaceholders.sender || usedPlaceholders.date) && (
                <div className="name-fields">
                  {usedPlaceholders.recipient && (
                    <label>받는 분<input className="num-input" value={fields.recipient} maxLength={30} placeholder="예: 김영희" onChange={(e) => setFields({ ...fields, recipient: e.target.value })} /></label>
                  )}
                  {usedPlaceholders.sender && (
                    <label>보내는 분<input className="num-input" value={fields.sender} maxLength={30} placeholder="예: 홍길동·김영희" onChange={(e) => setFields({ ...fields, sender: e.target.value })} /></label>
                  )}
                  {usedPlaceholders.date && (
                    <label>날짜<input className="num-input" value={fields.date} maxLength={30} placeholder="예: 2026년 12월 5일" onChange={(e) => setFields({ ...fields, date: e.target.value })} /></label>
                  )}
                </div>
              )}

              {selected?.type === 'text' && <TextControls layer={selected} onChange={(p) => update(selected.id, p)} />}

              <div className="spread" style={{ marginTop: 16 }}>
                <div className="field-label">추천 문구 {selected?.type === 'text' ? '(누르면 선택한 문구가 바뀌어요)' : ''}</div>
                <button type="button" className="btn ghost small" onClick={addText}>+ 문구 추가</button>
              </div>
              <div className="text-list">
                {nearTexts.map((t) => <TextChoice key={t.id} t={t} fields={fields} onPick={pickText} />)}
              </div>
              {otherTexts.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>다른 행사 문구 더 보기</summary>
                  <div className="text-list">
                    {otherTexts.map((t) => <TextChoice key={t.id} t={t} fields={fields} onPick={pickText} label={categoryNames[t.category]} />)}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      <div className="sticky-cta">
        {error && <p className="summary-line" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        {withSticker && hasBlank && !error && (
          <p className="summary-line" style={{ color: 'var(--brass)' }}>
            {PLACEHOLDER_BLANK} 자리에 이름을 넣어 주세요. 그대로 저장하면 {PLACEHOLDER_BLANK}로 인쇄돼요.
          </p>
        )}
        <button type="button" className="btn block" disabled={saving || !styleId} onClick={() => void save()}>
          {saving ? '저장하는 중…' : '디자인 저장하고 코드 받기'}
        </button>
      </div>

      {result && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="디자인 코드">
          <div className="modal card">
            <h2 style={{ fontSize: 20, textAlign: 'center' }}>디자인이 접수됐어요</h2>
            {result.preview && <img src={result.preview} alt="저장한 스티커" style={{ width: 140, height: 140, display: 'block', margin: '0 auto', objectFit: 'contain' }} />}
            <div className="design-code">{result.code}</div>
            <p className="small" style={{ textAlign: 'center', margin: '4px 0 0', color: result.copied ? 'var(--green)' : 'var(--muted)' }}>
              {result.copied ? '코드가 복사됐어요.' : '아래 버튼으로 코드를 복사해 주세요.'}
            </p>
            <ol className="steps-list">
              <li>‘주문하러 가기’를 누르면 상품 페이지가 열리고 수량이 <b>{quantity}개</b>로 맞춰져 있어요.</li>
              <li>‘바로 구매’를 눌러요. 로그인 화면이 나오면 <b>‘비회원 구매’</b>로도 주문할 수 있어요.</li>
              <li>주문서의 <b>‘온답 포장 디자인 코드’</b> 칸에 코드가 자동으로 들어가요. 비어 있으면 붙여 넣어 주세요.</li>
            </ol>
            <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
              {/* 카페24에서 온 고객은 같은 창으로 돌려보내고, 온답 화면에서 온 고객은 새 창으로 연다 */}
              <a className="btn block" href={orderUrl(product.url, result.code, quantity)} target={from === 'cafe24' ? '_self' : '_blank'} rel="noreferrer">주문하러 가기</a>
              <button type="button" className="btn ghost block" onClick={() => void copyAgain()}>코드 복사</button>
              <button type="button" className="btn ghost block" style={{ border: 'none', background: 'transparent' }} onClick={() => setResult(null)}>디자인 더 고치기</button>
              <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>고친 뒤 다시 저장하면 새 코드가 나옵니다.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TextChoice({ t, fields, onPick, label }: { t: DesignText; fields: DesignDraft['fields']; onPick(t: DesignText): void; label?: string }) {
  return (
    <button type="button" className="text-choice" onClick={() => onPick(t)}>
      {label && <span className="pill gray" style={{ fontSize: 11, padding: '0 6px', marginRight: 6 }}>{label}</span>}
      <span style={{ whiteSpace: 'pre-line' }}>{fillPlaceholders(t.text, fields)}</span>
    </button>
  );
}

function TextControls({ layer, onChange }: { layer: TextLayer; onChange(p: Partial<TextLayer>): void }) {
  return (
    <div className="text-controls">
      <textarea
        value={layer.text}
        maxLength={200}
        rows={2}
        onChange={(e) => onChange({ text: e.target.value })}
        aria-label="문구"
      />
      <p className="small muted" style={{ margin: 0 }}>{'{받는분} {보내는분} {날짜}'}는 위에 적은 내용으로 바뀌어요.</p>
      <div className="chips">
        {FONTS.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={layer.font === f.id} onClick={() => onChange({ font: f.id })}>{f.label}</button>
        ))}
      </div>
      <label className="small row" style={{ gap: 8 }}>
        크기
        <input type="range" min={28} max={200} value={layer.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value), scaleX: 1, scaleY: 1 })} style={{ flex: 1 }} />
      </label>
      <div className="row" style={{ gap: 6 }}>
        <span className="small" style={{ width: 36 }}>색</span>
        {COLORS.map((c) => (
          <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={layer.color === c} aria-label={`글자색 ${c}`} onClick={() => onChange({ color: c })} />
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <label className="small row" style={{ gap: 4, width: 70 }}>
          <input type="checkbox" checked={Boolean(layer.stroke)} onChange={(e) => onChange({ stroke: e.target.checked ? (layer.color === '#ffffff' ? '#1f2a26' : '#ffffff') : null })} />
          테두리
        </label>
        {layer.stroke && COLORS.map((c) => (
          <button key={c} type="button" className="swatch small" style={{ background: c }} aria-pressed={layer.stroke === c} aria-label={`테두리색 ${c}`} onClick={() => onChange({ stroke: c })} />
        ))}
      </div>
      <label className="small row" style={{ gap: 4 }}>
        <input type="checkbox" checked={layer.shadow} onChange={(e) => onChange({ shadow: e.target.checked })} />
        그림자
      </label>
    </div>
  );
}
