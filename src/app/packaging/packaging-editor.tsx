'use client';

// 고객 포장 꾸미기: 포장 스타일 고르기 → (무료) 스티커 꾸미기 → 저장하면 디자인 코드 발급.
// 단계를 줄이려고 한 화면에 모두 두고, 행사에 맞는 추천 이미지를 처음부터 깔아 둔다 (바로 저장해도 된다).
// 꾸미던 내용은 이 기기에 자동 보관하고, 저장한 디자인은 '내 디자인'에서 다시 꾸밀 수 있다.

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CANVAS_UNITS, FONTS, MIN_PRINT_DPI, PLACEHOLDER_BLANK, STICKER_SIZES, bleedUnits, cautionWords, effectiveDpi, fillPlaceholders, fitScale,
  printPixels, totalCm, type FontId,
} from '@/packaging/rules.ts';
import type { EventType } from '@/engine/types.ts';
import { isMobileUA } from '@/lib/device.ts';
import { MAX_QTY, clampQty } from '@/lib/result-query.ts';
import type { DesignCategory, DesignDraft, DesignImage, DesignText, PackagingStyle, StickerShape, StickerSizeCm, TextLayer } from '@/packaging/types.ts';
import { loadSavedDesigns, makeThumb, orderUrl, rememberDesign } from '@/packaging/client.ts';
import { saveDesignAction } from './actions.ts';
import {
  CARD_SHORT_MM, PX_PER_MM_RANGE, autosave, clearAutosave, forgetFields, fromStored, loadAutosave, loadFields, loadPxPerMm,
  prunePhotos, putPhoto, rememberFields, savePxPerMm, toStored, todayLabel,
} from './editor-store.ts';
import type { CanvasApi, EditorImageLayer, EditorLayer, EditorSnapshot, TextRect } from './editor-types.ts';

const StickerCanvas = dynamic(() => import('./sticker-canvas.tsx'), {
  ssr: false,
  loading: () => <div className="stage-loading">편집기를 불러오는 중…</div>,
});

export type PackagingEntry = 'recommend' | 'cafe24' | 'pick' | 'mine';

type Props = {
  product: { productNo: number; name: string; price: number; image: string | null; url: string };
  quantity: number;
  event: EventType | null;
  events: { id: EventType; name: string }[];
  // 들어온 곳: 추천 결과, 카페24 상품 페이지 버튼, '포장만 꾸미기' 상품 선택, 내 디자인 '다시 꾸미기'
  from: PackagingEntry;
  restoreCode: string | null; // 다시 꾸밀 디자인 코드 (이 기기의 '내 디자인'에서 찾는다)
  styles: PackagingStyle[];
  images: DesignImage[];
  texts: DesignText[];
  categoryNames: Record<string, string>;
  fontFamilies: Record<FontId, string>;
};

const COLORS = ['#1f2a26', '#ffffff', '#2f5a4b', '#b8903a', '#b5523b', '#1d3557', '#7a2e3a', '#e8a0b4'];
const BACKGROUNDS = ['#ffffff', '#f6edd8', '#e3ede7', '#f7e6e1', '#1f3f34'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MIN_AUTO_FONT = 28; // 긴 이름 자동 맞춤은 글자 크기 막대의 최솟값까지만 줄인다

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

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
  const [textRects, setTextRects] = useState<Record<string, TextRect>>({});
  const fitTries = useRef<Record<string, { text: string; tries: number }>>({});
  const [settled, setSettled] = useState<Record<string, string>>({}); // 자동 맞춤을 마친 문구 (레이어 → 그때 글자)
  const [namesChecked, setNamesChecked] = useState(false);
  const [view, setView] = useState<{ kind: 'mockup' | 'real'; png: string } | null>(null);
  const [resume, setResume] = useState<unknown>(null); // 자동 보관해 둔 디자인
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldsRemembered, setFieldsRemembered] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const autosaving = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 처음 화면: 행사 추천 이미지가 있으면 깔아 두고, 없으면 추천 문구 한 줄
  // 되돌리기: 바뀌기 직전 상태를 쌓아 둔다. 짧은 시간(0.6초) 안의 연속 변경(글자 입력 등)은 한 번으로 친다.
  // 올린 사진의 blob 주소는 되돌리기로 다시 쓸 수 있으므로 지우지 않는다
  const history = useRef<{ layers: EditorLayer[]; background: string }[]>([]);
  const prevSnap = useRef<{ layers: EditorLayer[]; background: string }>({ layers: [], background: '#ffffff' });
  const lastPush = useRef(0);
  const restoring = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    const prev = prevSnap.current;
    prevSnap.current = { layers, background };
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    if (prev.layers === layers && prev.background === background) return;
    if (prev.layers.length === 0 && history.current.length === 0) return; // 처음 자동으로 깐 것은 되돌리기 대상이 아니다
    const now = Date.now();
    if (now - lastPush.current > 600) {
      history.current.push(prev);
      if (history.current.length > 40) history.current.shift();
    }
    lastPush.current = now;
    setCanUndo(history.current.length > 0);
  }, [layers, background]);

  const undo = () => {
    const snap = history.current.pop();
    if (!snap) return;
    restoring.current = true;
    setLayers(snap.layers);
    setBackground(snap.background);
    setSelectedId(null);
    setCanUndo(history.current.length > 0);
    lastPush.current = 0;
  };

  const clearAll = () => {
    setLayers([]);
    setBackground('#ffffff');
    setSelectedId(null);
  };

  // 저장해 둔 편집 상태로 바꾼다 (다시 꾸미기·이어서 꾸미기). 불러온 문구는 자동 맞춤으로 크기를 바꾸지 않는다
  const restore = async (stored: unknown, message: string, keepSaving: boolean) => {
    const r = await fromStored(stored, { styleIds: styles.map((x) => x.id), events: events.map((e) => e.id) });
    setResume(null);
    if (!r) return setBanner('저장해 둔 디자인을 읽지 못했어요. 새로 꾸며 주세요.');
    const d = r.snap;
    setSettled(Object.fromEntries(d.layers.flatMap((l) => (l.type === 'text' ? [[l.id, fillPlaceholders(l.text, d.fields)]] : []))));
    setStyleId(d.styleId);
    setWithSticker(d.withSticker);
    setShape(d.shape);
    setSizeCm(d.sizeCm);
    setBackground(d.background);
    setLayers(d.layers);
    setFields(d.fields);
    setEvent(d.event);
    setQuantity(d.quantity);
    setSelectedId(null);
    setConsent(false); // 사진이 바뀌었을 수 있으니 사용 권한은 다시 확인
    autosaving.current = keepSaving; // 이어서 꾸미기는 계속 보관, 다시 꾸미기는 고친 뒤부터
    setBanner(r.missingPhotos ? `${message} 올렸던 사진 ${r.missingPhotos}장은 이 기기에 남아 있지 않아 빠졌어요.` : message);
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // 개발 모드(StrictMode)에서 두 번 돌아도 한 번만 깐다
    started.current = true;
    void prunePhotos();
    const names = loadFields();
    if (names) {
      setFields((f) => ({ ...f, ...names }));
      setFieldsRemembered(true);
    }
    const saved = props.restoreCode ? loadSavedDesigns().find((d) => d.code === props.restoreCode) : null;
    if (saved?.snapshot) {
      void restore(saved.snapshot, `${saved.code} 디자인을 불러왔어요. 고친 뒤 저장하면 새 코드가 나와요.`, false);
      return;
    }
    if (props.restoreCode) setBanner('이 기기에서 저장한 디자인을 찾지 못해 새로 꾸며요. 다른 기기에서 저장했다면 그 기기에서 다시 꾸며 주세요.');
    setResume(loadAutosave(product.productNo));
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

  // 꾸미던 내용 자동 보관: 고객이 스티커에 손댄 뒤부터 (처음 깔린 그대로는 남기지 않는다)
  const snapshot: EditorSnapshot = { styleId, withSticker, shape, sizeCm, background, layers, fields, event, quantity };
  useEffect(() => {
    if (!canUndo && !autosaving.current) return;
    autosaving.current = true;
    autosaveTimer.current = setTimeout(() => autosave(product.productNo, snapshot), 800);
    return () => clearTimeout(autosaveTimer.current);
  }, [canUndo, styleId, withSticker, shape, sizeCm, background, layers, fields, event, quantity]);

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

  // 긴 이름 자동 맞춤: 문구 글자가 바뀌어 안전선을 조금 넘으면 글자 크기를 줄인다.
  // 많이 넘치면(0.5배 미만) 위치 문제라 경고만 하고, 맞춘 뒤 고객이 키운 크기는 건드리지 않는다
  useEffect(() => {
    const done: Record<string, string> = {};
    for (const l of rendered) {
      const r = textRects[l.id];
      if (l.type !== 'text' || !r || r.text !== l.text || r.fontSize !== l.fontSize || settled[l.id] === l.text) continue; // 지금 글자로 잰 값만
      const prev = fitTries.current[l.id];
      const tries = prev?.text === l.text ? prev.tries : 0;
      const k = fitScale(shape, sizeCm, r);
      if (k >= 1 || k < 0.5 || tries >= 4 || l.fontSize <= MIN_AUTO_FONT) {
        done[l.id] = l.text;
        continue;
      }
      fitTries.current[l.id] = { text: l.text, tries: tries + 1 };
      update(l.id, { fontSize: Math.max(MIN_AUTO_FONT, Math.floor(l.fontSize * k * 0.97)) });
    }
    if (Object.keys(done).length) setSettled((m) => ({ ...m, ...done }));
  }, [textRects]);

  // 글자 잘림 경고: 맞춤을 마친 문구 중 안전선을 넘는 것
  const overflowBoxes = withSticker
    ? rendered.flatMap((l) => {
      const r = textRects[l.id];
      return l.type === 'text' && r && r.text === l.text && settled[l.id] === l.text && fitScale(shape, sizeCm, r) < 1 ? [r] : [];
    })
    : [];
  // 행사와 어긋난 말
  const caution = withSticker ? [...new Set(rendered.flatMap((l) => (l.type === 'text' ? cautionWords(event, l.text) : [])))] : [];
  // 이름·날짜를 넣었으면 저장 전에 철자 확인을 받는다
  const namesUsed = withSticker && Boolean(
    (usedPlaceholders.recipient && fields.recipient.trim()) || (usedPlaceholders.sender && fields.sender.trim()) || (usedPlaceholders.date && fields.date.trim()),
  );
  useEffect(() => setNamesChecked(false), [fields]);
  const uploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
  const lowRes = uploads.some((l) => effectiveDpi(l.naturalWidth ?? 0, l.width * l.scaleX, sizeCm) < MIN_PRINT_DPI);

  const update = (id: string, patch: Partial<EditorLayer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as EditorLayer) : l)));

  // 바탕 이미지는 한 장: 맨 아래가 이미지면 바꾸고, 아니면 맨 아래에 넣는다
  const setBaseImage = (layer: EditorImageLayer) => {
    setLayers((ls) => {
      const old = ls[0]?.type === 'image' ? (ls[0] as EditorImageLayer) : null;
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
      const photoId = newId();
      void putPhoto(photoId, file); // 다시 꾸미기·이어서 꾸미기 때 꺼낼 원본
      setBaseImage(coverLayer(url, w, h, { uploaded: true, naturalWidth: w, photoId }));
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
    if (namesUsed && !namesChecked) return setError('이름과 날짜 철자를 확인했다고 체크해 주세요.');
    if (overflowBoxes.length > 0 && !window.confirm('빨간 상자로 표시한 글자가 자르는 선에 걸려 잘릴 수 있어요. 그대로 저장할까요?')) return;
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
      clearTimeout(autosaveTimer.current);
      clearAutosave(); // 저장했으니 '꾸미던 디자인'으로 다시 띄우지 않는다
      rememberFields(fields);
      // 이 기기의 '내 디자인'에 남긴다 (코드를 잃어버려도 다시 찾고, 다시 꾸밀 수 있게)
      const thumbBlob = preview ? await fetch(preview).then((r) => r.blob()).catch(() => null) : null;
      rememberDesign({
        code: res.code, productName: product.name, productUrl: product.url, quantity,
        savedAt: new Date().toISOString(), thumb: thumbBlob ? await makeThumb(thumbBlob) : null,
        productNo: product.productNo, snapshot: toStored(snapshot),
      });
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
  const cut = (bleedUnits(sizeCm) / CANVAS_UNITS) * 100; // 재단 여백(%): 미리보기는 자르는 선 안쪽만 보여 준다
  const cutClip = shape === 'circle' ? `circle(${50 - cut}% at 50% 50%)` : `inset(${cut}%)`;

  const openView = async (kind: 'mockup' | 'real') => {
    if (!apiRef.current) return;
    setError(null);
    setSelectedId(null);
    try {
      const blob = await apiRef.current.exportPng(kind === 'real' ? printPixels(sizeCm) : 600);
      setView({ kind, png: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const closeView = () => {
    if (view) URL.revokeObjectURL(view.png);
    setView(null);
  };

  // PC에서 저장하면 휴대폰으로 이어서 주문할 QR을 보여 준다 (휴대폰은 내 디자인에서 코드를 조회해 모바일 쇼핑몰로 간다)
  useEffect(() => {
    setQr(null);
    if (!result || isMobileUA()) return;
    let live = true;
    void import('qrcode-generator')
      .then(({ default: qrcode }) => {
        const q = qrcode(0, 'M');
        q.addData(`${location.origin}/packaging/mine?code=${result.code}`);
        q.make();
        if (live) setQr(q.createDataURL(4, 2));
      })
      .catch(() => {}); // QR이 없어도 코드·주문 버튼으로 주문할 수 있다
    return () => { live = false; };
  }, [result?.code]);

  return (
    <>
      <h1 style={{ fontSize: 24, marginTop: 8 }}>선물을 정성껏<br />싸 드릴게요</h1>
      <p className="lead" style={{ marginBottom: 18 }}>포장지를 고르고, 스티커에 문구와 그림을 넣어 주세요. 포장과 스티커는 무료입니다.</p>
      {resume !== null && (
        <div className="notice editor-resume" role="status">
          <span>꾸미다 만 디자인이 있어요.</span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" onClick={() => void restore(resume, '꾸미던 디자인을 다시 열었어요.', true)}>이어서 꾸미기</button>
            <button type="button" className="btn ghost small" onClick={() => { clearAutosave(); setResume(null); }}>새로 시작</button>
          </span>
        </div>
      )}
      {banner && <p className="notice" role="status" style={{ margin: '0 0 14px' }}>{banner}</p>}

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
              max={MAX_QTY}
              value={quantity}
              onChange={(e) => setQuantity(clampQty(e.target.value))}
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
                onTextRects={setTextRects}
                warnBoxes={overflowBoxes}
              />
            )}
          </div>
          <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn ghost small" disabled={!canUndo} onClick={undo}>되돌리기</button>
            <button type="button" className="btn ghost small" disabled={layers.length === 0} onClick={clearAll}>모두 지우기</button>
            <button type="button" className="btn ghost small" disabled={layers.length === 0 || !displaySize} onClick={() => void openView('mockup')}>포장된 모습</button>
            <button type="button" className="btn ghost small" disabled={layers.length === 0 || !displaySize} onClick={() => void openView('real')}>실제 크기</button>
          </div>
          <p className="guide-note">
            <span className="cut">빨간 점선: 자르는 선</span>
            <span>회색 점선 안에 글자를 두면 안전해요</span>
          </p>
          {overflowBoxes.length > 0 && (
            <p className="small" role="status" style={{ color: 'var(--red)', margin: '6px 0 0', textAlign: 'center' }}>
              빨간 상자 글자가 회색 점선 밖으로 나가 잘릴 수 있어요. 안쪽으로 옮기거나 크기를 줄여 주세요.
            </p>
          )}
          {caution.length > 0 && (
            <p className="small" role="status" style={{ color: 'var(--brass)', margin: '6px 0 0', textAlign: 'center' }}>
              ‘{caution.join('’, ‘')}’ 같은 말은 {event ? categoryNames[event] : ''} 자리와 어울리지 않을 수 있어요. 한 번 더 살펴봐 주세요.
            </p>
          )}
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
                    <div className="date-row">
                      <label>날짜<input className="num-input" value={fields.date} maxLength={30} placeholder="예: 2026년 12월 5일" onChange={(e) => setFields({ ...fields, date: e.target.value })} /></label>
                      <button type="button" className="btn ghost small" onClick={() => setFields({ ...fields, date: todayLabel() })}>오늘</button>
                    </div>
                  )}
                  {fieldsRemembered && ((usedPlaceholders.recipient && fields.recipient) || (usedPlaceholders.sender && fields.sender)) && (
                    <p className="small muted" style={{ margin: 0 }}>
                      지난번에 쓴 이름을 넣어 두었어요 (이 기기에만 기억).{' '}
                      <button type="button" className="link-btn" onClick={() => { forgetFields(); setFields({ ...fields, recipient: '', sender: '' }); setFieldsRemembered(false); }}>지우기</button>
                    </p>
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
        {namesUsed && (
          <div className="name-check">
            <label>
              <input type="checkbox" checked={namesChecked} onChange={(e) => setNamesChecked(e.target.checked)} />
              이름과 날짜 철자를 확인했어요
            </label>
            <button type="button" className="link-btn" onClick={() => void openView('real')}>실제 크기로 보기</button>
          </div>
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
            {qr && (
              <div className="qr-box">
                <img src={qr} alt="휴대폰으로 이어서 주문하는 QR 코드" width={116} height={116} />
                <p className="small" style={{ margin: 0 }}>휴대폰으로 주문하려면 카메라로 찍어 보세요. 이 디자인 코드로 바로 이어져요.</p>
              </div>
            )}
            <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
              {/* 카페24에서 온 고객은 같은 창으로 돌려보내고, 온답 화면에서 온 고객은 새 창으로 연다 */}
              <a className="btn block" href={orderUrl(product.url, result.code, quantity)} target={from === 'cafe24' ? '_self' : '_blank'} rel="noreferrer">주문하러 가기</a>
              <button type="button" className="btn ghost block" onClick={() => void copyAgain()}>코드 복사</button>
              <button type="button" className="btn ghost block" style={{ border: 'none', background: 'transparent' }} onClick={() => setResult(null)}>디자인 더 고치기</button>
              <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
                고친 뒤 다시 저장하면 새 코드가 나옵니다. 저장한 디자인은 <a className="text-link" href="/packaging/mine">내 디자인</a>에서 다시 볼 수 있어요.
              </p>
            </div>
          </div>
        </div>
      )}

      {view?.kind === 'mockup' && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="포장된 모습" onClick={(e) => { if (e.target === e.currentTarget) closeView(); }}>
          <div className="modal card">
            <h2 style={{ fontSize: 18, textAlign: 'center' }}>포장된 모습</h2>
            <div className="mockup" style={{ backgroundImage: style ? `url("${style.imageUrl}")` : undefined }}>
              <span className="mockup-sticker" style={{ width: `${sizeCm === 6 ? 34 : 24}%` }}>
                <img src={view.png} alt="포장 위에 붙인 스티커" style={{ clipPath: cutClip }} />
              </span>
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              {style?.name ?? ''} 포장에 {sizeCm}cm {shape === 'circle' ? '원형' : '사각'} 스티커를 붙인 모습이에요. 실제 무늬·색과 조금 다를 수 있어요.
            </p>
            <button type="button" className="btn ghost block" style={{ marginTop: 14 }} onClick={closeView}>닫기</button>
          </div>
        </div>
      )}
      {view?.kind === 'real' && <RealSize png={view.png} sizeCm={sizeCm} shape={shape} clip={cutClip} onClose={closeView} />}
    </>
  );
}

// 실제 크기로 보기: 화면 1mm 배율로 스티커를 그린다. 배율은 신용카드에 대 보고 고칠 수 있다
function RealSize({ png, sizeCm, shape, clip, onClose }: { png: string; sizeCm: number; shape: StickerShape; clip: string; onClose(): void }) {
  const [pxPerMm, setPxPerMm] = useState(loadPxPerMm);
  return (
    <div className="real-view" role="dialog" aria-modal="true" aria-label="실제 크기로 보기">
      <div className="real-stage">
        <img src={png} alt="실제 크기 스티커" style={{ width: totalCm(sizeCm) * 10 * pxPerMm, clipPath: clip }} />
      </div>
      <div className="real-panel">
        <p style={{ margin: 0, fontWeight: 600 }}>{shape === 'circle' ? '지름' : '한 변'} {sizeCm}cm, 실제 인쇄 크기예요</p>
        <p className="small muted" style={{ margin: '2px 0 0' }}>이 크기에서 이름과 날짜가 잘 읽히는지, 철자가 맞는지 확인해 주세요.</p>
        <details className="disclosure" style={{ marginTop: 10 }}>
          <summary>화면 크기 맞추기</summary>
          <p className="small muted" style={{ margin: '8px 0' }}>신용카드 짧은 변(5.4cm)을 화면에 대고, 아래 막대가 카드와 같은 길이가 되게 조절해 주세요.</p>
          <div className="card-ruler" style={{ width: CARD_SHORT_MM * pxPerMm }} />
          <input
            type="range" min={PX_PER_MM_RANGE[0]} max={PX_PER_MM_RANGE[1]} step={0.02} value={pxPerMm} aria-label="화면 배율"
            style={{ width: '100%', marginTop: 8 }}
            onChange={(e) => { const v = Number(e.target.value); setPxPerMm(v); savePxPerMm(v); }}
          />
        </details>
        <button type="button" className="btn block" style={{ marginTop: 12 }} onClick={onClose}>닫기</button>
      </div>
    </div>
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
