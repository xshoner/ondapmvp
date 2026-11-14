'use client';

// ONDAP 포장 꾸미기 3단계 제작 에디터
// STEP 1: 포장지 선택 -> STEP 2: 인쇄물 꾸미기 (스티커 / 카드 / 둘 다 / 인쇄물 없음) -> STEP 3: 최종 확인
// 일반 사용자가 복잡한 디자인 도구를 몰라도 추천 템플릿과 문구 수정만으로 포장을 완성할 수 있도록 구현

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventType } from '@/engine/types.ts';
import {
  CANVAS_UNITS,
  MAX_CARD_PRINT_BYTES,
  MAX_STICKER_PRINT_BYTES,
  MIN_PRINT_DPI,
  bleedUnits,
  cardCanvasUnits,
  cardPrintPixels,
  cautionWords,
  effectiveDpi,
  effectiveDpiCard,
  fillPlaceholders,
  fitScale,
  fitScaleCard,
  overlaps,
  printPixels,
  type FontId,
} from '@/packaging/rules.ts';
import type {
  CardSizeMm,
  DesignCategory,
  DesignDraft,
  DesignImage,
  DesignText,
  GiftPurpose,
  PackagingStyle,
  StickerShape,
  StickerSizeCm,
} from '@/packaging/types.ts';
import { loadSavedDesigns, makeThumb, rememberDesign } from '@/packaging/client.ts';
import { matchesTarget } from '@/packaging/presets.ts';
import {
  applyImageSelectionToLayers,
  classifyDraftFormat,
  extractMainTextFromLayers,
  getEventTemplates,
  isNamesUsedInLayers,
  syncFieldsToLayers,
  syncMainTextToLayers,
  type StickerTemplate,
} from '@/packaging/templates.ts';
import { commitDesignUploadAction, prepareDesignUploadAction, saveDesignAction } from './actions.ts';
import { uploadPrintBlob } from './upload-client.ts';
import {
  autosave,
  clearAutosave,
  fromStored,
  loadAutosave,
  saveRecovery,
  loadFields,
  prunePhotos,
  putPhoto,
  rememberFields,
  savePreview,
  toStored,
} from './editor-store.ts';
import type {
  CanvasApi,
  CardHistoryEntry,
  EditorHistoryEntry,
  EditorImageLayer,
  EditorLayer,
  EditorSnapshot,
  TextRect,
} from './editor-types.ts';

import { StepNavigation } from './components/step-navigation.tsx';
import { ProductHeader } from './components/product-header.tsx';
import { Step1Wrapping } from './components/step1-wrapping.tsx';
import { Step2Message } from './components/step2-message.tsx';
import { Step3Review } from './components/step3-review.tsx';
import { PreviewPane } from './components/preview-pane.tsx';
import { ResultModal } from './components/result-modal.tsx';
import { RealSizeModal } from './components/real-size-modal.tsx';
import type { PackagingOptionInfo } from '@/packaging/pricing.ts';

export type PackagingEntry = 'recommend' | 'cafe24' | 'pick' | 'mine';

interface Props {
  product: { productNo: number; name: string; price: number; image: string | null; url: string };
  quantity: number;
  initialPackagingOption?: PackagingOptionInfo | null;
  event: EventType | null;
  events: { id: EventType; name: string }[];
  relation?: string | null;
  relationName?: string | null;
  from: PackagingEntry;
  restoreCode: string | null;
  styles: PackagingStyle[];
  images: DesignImage[];
  texts: DesignText[];
  categoryNames: Record<string, string>;
  fontFamilies: Record<FontId, string>;
  backHref?: string;
  backLabel?: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MIN_AUTO_FONT = 28;
const newId = () => 'l' + Math.random().toString(36).slice(2, 9);

function loadNatural(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const isRemote = /^https?:/.test(src);
    if (isRemote) img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => {
      if (isRemote && !src.includes('retry_cors=1')) {
        const retryImg = new window.Image();
        retryImg.crossOrigin = 'anonymous';
        retryImg.onload = () => resolve({ w: retryImg.naturalWidth, h: retryImg.naturalHeight });
        retryImg.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
        const sep = src.includes('?') ? '&' : '?';
        retryImg.src = `${src}${sep}retry_cors=1`;
      } else {
        reject(new Error('이미지를 읽을 수 없습니다.'));
      }
    };
    img.src = src;
  });
}

function coverLayer(
  src: string,
  w: number,
  h: number,
  extra: Partial<EditorImageLayer> = {},
  heightUnits = 1000,
): EditorImageLayer {
  const r = w / h;
  const targetW = 1000;
  const targetH = heightUnits;
  const cardR = targetW / targetH;
  let width = targetW;
  let height = targetH;
  if (r >= cardR) {
    height = targetH;
    width = targetH * r;
  } else {
    width = targetW;
    height = targetW / r;
  }
  return {
    id: newId(),
    type: 'image',
    src,
    x: 500,
    y: targetH / 2,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width,
    height,
    ...extra,
  };
}

function createCardLayers(tpl: StickerTemplate | undefined, heightUnits: number): EditorLayer[] {
  if (!tpl) return [];
  const baseLayers = tpl.createLayers({
    mainText: tpl.mainText,
    fields: { recipient: '', sender: '', date: '' },
  });
  const scaleY = heightUnits / 1000;
  return baseLayers.map((l) => {
    if (l.type === 'text') {
      return {
        ...l,
        y: Math.round(l.y * scaleY),
      };
    } else if (l.type === 'image') {
      return {
        ...l,
        y: Math.round(heightUnits / 2),
      };
    }
    return l;
  });
}

export function PackagingEditor(props: Props) {
  const { product, styles, categoryNames, fontFamilies, events, from, backHref = '/', backLabel = '‹ 뒤로' } = props;

  // 1. 단일 핵심 상태 머신
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [subStep, setSubStep] = useState<'sticker' | 'card'>('sticker');
  const [purpose, setPurpose] = useState<GiftPurpose>('return');
  const [quantity, setQuantity] = useState(props.quantity);
  const [event, setEvent] = useState<DesignCategory | null>(props.event);
  const [packagingOption, setPackagingOption] = useState<PackagingOptionInfo | null>(
    props.initialPackagingOption ?? null,
  );

  const requestSeqRef = useRef(0);

  const fetchLatestOptionPrice = (forceRefresh = false) => {
    const seq = ++requestSeqRef.current;
    const targetProductNo = product.productNo;

    setPackagingOption({
      status: 'loading',
      productNo: targetProductNo,
      unitPrice: null,
      reason: 'loading',
    });

    const url = `/api/packaging/option-price?product=${targetProductNo}${forceRefresh ? '&refresh=1' : ''}`;

    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (seq !== requestSeqRef.current) return;
        if (!res.ok) {
          setPackagingOption({
            status: 'unconfirmed',
            productNo: targetProductNo,
            unitPrice: null,
            reason: 'api_error',
          });
          return;
        }
        const json = await res.json();
        const data: PackagingOptionInfo = json && typeof json === 'object' && 'data' in json ? json.data : json;
        if (seq !== requestSeqRef.current) return;
        if (data && data.productNo === targetProductNo) {
          setPackagingOption(data);
        } else {
          setPackagingOption({
            status: 'unconfirmed',
            productNo: targetProductNo,
            unitPrice: null,
            reason: 'api_error',
          });
        }
      })
      .catch(() => {
        if (seq !== requestSeqRef.current) return;
        setPackagingOption({
          status: 'unconfirmed',
          productNo: targetProductNo,
          unitPrice: null,
          reason: 'api_error',
        });
      });
  };

  useEffect(() => {
    if (currentStep === 3) {
      fetchLatestOptionPrice(true);
    }
  }, [currentStep, product.productNo]);

  useEffect(() => {
    if (!packagingOption || packagingOption.productNo !== product.productNo) {
      setPackagingOption({
        status: 'loading',
        productNo: product.productNo,
        unitPrice: null,
        reason: 'loading',
      });
      fetchLatestOptionPrice(false);
    }
  }, [product.productNo]);

  // 사용 가능한 포장 스타일
  const availableStyles = useMemo(() => {
    return styles.filter((s) => !s.targeting?.productNos?.length || s.targeting.productNos.includes(product.productNo));
  }, [styles, product.productNo]);

  const [styleId, setStyleId] = useState(() => {
    const matched = availableStyles.find((s) => matchesTarget(s, props.event, 'return', product.productNo));
    return matched?.id ?? availableStyles[0]?.id ?? styles[0]?.id ?? '';
  });

  useEffect(() => {
    if (availableStyles.length > 0 && !availableStyles.some((s) => s.id === styleId)) {
      const fallback =
        availableStyles.find((s) => matchesTarget(s, event, purpose, product.productNo)) ?? availableStyles[0];
      if (fallback) setStyleId(fallback.id);
    }
  }, [availableStyles, styleId, event, purpose, product.productNo]);

  // 2. 행사 맞춤 템플릿 목록
  const templates = useMemo(() => {
    return getEventTemplates({
      event,
      purpose,
      relation: props.relation,
      images: props.images,
    });
  }, [event, purpose, props.relation, props.images]);

  const initialTpl = templates[0];
  const initialLayers = useMemo(() => {
    return initialTpl
      ? initialTpl.createLayers({
          mainText: initialTpl.mainText,
          fields: { recipient: '', sender: '', date: '' },
        })
      : [];
  }, [initialTpl]);

  // ---------- (A) 스티커 상태 ----------
  const [withSticker, setWithSticker] = useState(true);
  const [shape, setShape] = useState<StickerShape>(() => initialTpl?.shape ?? 'circle');
  const [sizeCm, setSizeCm] = useState<StickerSizeCm>(() => initialTpl?.sizeCm ?? 6);
  const [background, setBackground] = useState<string>(() => initialTpl?.background ?? '#ffffff');
  const [layers, setLayers] = useState<EditorLayer[]>(() => initialLayers);
  const [fields, setFields] = useState<DesignDraft['fields']>({ recipient: '', sender: '', date: '' });
  const [mainText, setMainText] = useState<string>(() => initialTpl?.mainText ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(() => initialTpl?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const autoTextEdited = useRef(false);
  const hasChosenImage = useRef(false);
  const [consent, setConsent] = useState(false);
  const [namesChecked, setNamesChecked] = useState(false);

  const apiRef = useRef<CanvasApi | null>(null);
  const pendingCommit = useRef<{ sessionId: string; secret: string; code: string } | null>(null);
  const [textRects, setTextRects] = useState<Record<string, TextRect>>({});
  const fitTries = useRef<Record<string, { text: string; tries: number }>>({});
  const [settled, setSettled] = useState<Record<string, string>>({});

  const history = useRef<EditorHistoryEntry[]>([]);
  const prevSnap = useRef<EditorHistoryEntry>({
    layers: initialLayers,
    background: initialTpl?.background ?? '#ffffff',
    shape: initialTpl?.shape ?? 'circle',
    sizeCm: initialTpl?.sizeCm ?? 6,
    selectedTemplateId: initialTpl?.id ?? null,
    fields: { recipient: '', sender: '', date: '' },
    mainText: initialTpl?.mainText ?? '',
    autoTextEdited: false,
    hasChosenImage: false,
  });
  const lastPush = useRef(0);
  const isUndoing = useRef(false);
  const isRestoring = useRef(false);
  const isAutoFitting = useRef(false);
  const [canUndo, setCanUndo] = useState(false);

  // ---------- (B) 카드(엽서) 상태 ----------
  const initialCardUnits = cardCanvasUnits('74x50');
  const initialCardLayers = useMemo(() => {
    return createCardLayers(initialTpl, initialCardUnits.heightUnits);
  }, [initialTpl]);

  const [withCard, setWithCard] = useState(false);
  const [cardSizeMm, setCardSizeMm] = useState<CardSizeMm>('74x50');
  const [cardBackground, setCardBackground] = useState<string>(() => initialTpl?.background ?? '#ffffff');
  const [cardLayers, setCardLayers] = useState<EditorLayer[]>(() => initialCardLayers);
  const [cardFields, setCardFields] = useState<DesignDraft['fields']>({ recipient: '', sender: '', date: '' });
  const [cardMainText, setCardMainText] = useState<string>(() => initialTpl?.mainText ?? '');
  const [cardSelectedTemplateId, setCardSelectedTemplateId] = useState<string | null>(() => initialTpl?.id ?? null);
  const [cardSelectedId, setCardSelectedId] = useState<string | null>(null);

  const cardAutoTextEdited = useRef(false);
  const cardHasChosenImage = useRef(false);
  const [cardConsent, setCardConsent] = useState(false);
  const [cardNamesChecked, setCardNamesChecked] = useState(false);
  const [canCardUndo, setCanCardUndo] = useState(false);

  const cardApiRef = useRef<CanvasApi | null>(null);
  const [cardTextRects, setCardTextRects] = useState<Record<string, TextRect>>({});
  const cardFitTries = useRef<Record<string, { text: string; tries: number }>>({});
  const [cardSettled, setCardSettled] = useState<Record<string, string>>({});

  const cardHistory = useRef<CardHistoryEntry[]>([]);
  const cardPrevSnap = useRef<CardHistoryEntry>({
    layers: initialCardLayers,
    background: initialTpl?.background ?? '#ffffff',
    sizeMm: '74x50',
    fields: { recipient: '', sender: '', date: '' },
    mainText: initialTpl?.mainText ?? '',
    autoTextEdited: false,
    hasChosenImage: false,
  });
  const cardLastPush = useRef(0);
  const isCardUndoing = useRef(false);
  const isCardAutoFitting = useRef(false);

  // 공통 다이얼로그 / 기타 상태
  const pickSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ code: string; preview: string | null; cardPreview?: string | null } | null>(
    null,
  );
  const [realSizeModal, setRealSizeModal] = useState<{ open: boolean; target: 'sticker' | 'card' }>({
    open: false,
    target: 'sticker',
  });
  const [resume, setResume] = useState<unknown>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const autosaving = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const started = useRef(false);

  const eventName = event && event !== 'common' ? categoryNames[event] : null;

  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) ?? templates[0];
  }, [templates, selectedTemplateId]);

  const images = useMemo(() => {
    return props.images.filter((i) => i.category === event || i.category === 'common');
  }, [props.images, event]);
  const otherImages = useMemo(() => {
    return props.images.filter((i) => !images.includes(i));
  }, [props.images, images]);

  const texts = useMemo(() => {
    return props.texts.filter((t) => t.category === event || t.category === 'common');
  }, [props.texts, event]);

  // 스티커 실행 취소 스택 관리
  useEffect(() => {
    if (!started.current || isRestoring.current || isUndoing.current) {
      if (isUndoing.current) isUndoing.current = false;
      return;
    }
    if (isAutoFitting.current) {
      isAutoFitting.current = false;
      if (prevSnap.current) prevSnap.current = { ...prevSnap.current, layers };
      return;
    }

    const currentEntry: EditorHistoryEntry = {
      layers,
      background,
      shape,
      sizeCm,
      selectedTemplateId,
      fields: { ...fields },
      mainText,
      autoTextEdited: autoTextEdited.current,
      hasChosenImage: hasChosenImage.current,
    };

    if (!prevSnap.current) {
      prevSnap.current = currentEntry;
      return;
    }

    const prev = prevSnap.current;
    const sameLayers = prev.layers === layers;
    const sameBg = prev.background === background;
    const sameShape = prev.shape === shape;
    const sameSize = prev.sizeCm === sizeCm;
    const sameTpl = prev.selectedTemplateId === selectedTemplateId;
    const sameFields =
      prev.fields.recipient === fields.recipient &&
      prev.fields.sender === fields.sender &&
      prev.fields.date === fields.date;
    const sameMain = prev.mainText === mainText;

    if (sameLayers && sameBg && sameShape && sameSize && sameTpl && sameFields && sameMain) {
      return;
    }

    const now = Date.now();
    const isDiscreteChange = !sameShape || !sameSize || !sameTpl || !sameBg;
    if (isDiscreteChange || now - lastPush.current > 500) {
      history.current.push(prev);
      if (history.current.length > 50) history.current.shift();
      lastPush.current = now;
      setCanUndo(true);
    }
    prevSnap.current = currentEntry;
  }, [layers, background, shape, sizeCm, selectedTemplateId, fields, mainText]);

  const undo = () => {
    if (history.current.length === 0) return;
    const entry = history.current.pop();
    if (!entry) return;

    isUndoing.current = true;
    setLayers(entry.layers);
    setBackground(entry.background);
    setShape(entry.shape);
    setSizeCm(entry.sizeCm);
    setSelectedTemplateId(entry.selectedTemplateId);
    setFields({ ...entry.fields });
    setMainText(entry.mainText);
    autoTextEdited.current = entry.autoTextEdited;
    hasChosenImage.current = entry.hasChosenImage;
    setSelectedId(null);
    setNamesChecked(false);

    prevSnap.current = { ...entry };
    setCanUndo(history.current.length > 0);
    lastPush.current = 0;
  };

  // 카드 실행 취소 스택 관리
  useEffect(() => {
    if (!started.current || isRestoring.current || isCardUndoing.current) {
      if (isCardUndoing.current) isCardUndoing.current = false;
      return;
    }
    if (isCardAutoFitting.current) {
      isCardAutoFitting.current = false;
      if (cardPrevSnap.current) cardPrevSnap.current = { ...cardPrevSnap.current, layers: cardLayers };
      return;
    }

    const currentEntry: CardHistoryEntry = {
      layers: cardLayers,
      background: cardBackground,
      sizeMm: cardSizeMm,
      fields: { ...cardFields },
      mainText: cardMainText,
      autoTextEdited: cardAutoTextEdited.current,
      hasChosenImage: cardHasChosenImage.current,
    };

    if (!cardPrevSnap.current) {
      cardPrevSnap.current = currentEntry;
      return;
    }

    const prev = cardPrevSnap.current;
    const sameLayers = prev.layers === cardLayers;
    const sameBg = prev.background === cardBackground;
    const sameSize = prev.sizeMm === cardSizeMm;
    const sameFields =
      prev.fields.recipient === cardFields.recipient &&
      prev.fields.sender === cardFields.sender &&
      prev.fields.date === cardFields.date;
    const sameMain = prev.mainText === cardMainText;

    if (sameLayers && sameBg && sameSize && sameFields && sameMain) {
      return;
    }

    const now = Date.now();
    const isDiscreteChange = !sameSize || !sameBg;
    if (isDiscreteChange || now - cardLastPush.current > 500) {
      cardHistory.current.push(prev);
      if (cardHistory.current.length > 50) cardHistory.current.shift();
      cardLastPush.current = now;
      setCanCardUndo(true);
    }
    cardPrevSnap.current = currentEntry;
  }, [cardLayers, cardBackground, cardSizeMm, cardFields, cardMainText]);

  useEffect(() => {
    isRestoring.current = false;
  }, [layers, background, shape, sizeCm, selectedTemplateId, fields, mainText, cardLayers, cardBackground, cardSizeMm, cardFields, cardMainText]);

  const undoCard = () => {
    if (cardHistory.current.length === 0) return;
    const entry = cardHistory.current.pop();
    if (!entry) return;

    isCardUndoing.current = true;
    setCardLayers(entry.layers);
    setCardBackground(entry.background);
    setCardSizeMm(entry.sizeMm);
    setCardFields({ ...entry.fields });
    setCardMainText(entry.mainText);
    cardAutoTextEdited.current = entry.autoTextEdited;
    cardHasChosenImage.current = entry.hasChosenImage;
    setCardSelectedId(null);
    setCardNamesChecked(false);

    cardPrevSnap.current = { ...entry };
    setCanCardUndo(cardHistory.current.length > 0);
    cardLastPush.current = 0;
  };

  // 초기 마운트 시
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void prunePhotos();

    const names = loadFields();
    if (names) {
      const nextFields = { recipient: names.recipient ?? '', sender: names.sender ?? '', date: '' };
      setFields((f) => ({ ...f, ...nextFields }));
      setCardFields((f) => ({ ...f, ...nextFields }));
      setLayers((ls) => syncFieldsToLayers(ls, nextFields, initialTpl));
      const cardUnits = cardCanvasUnits('74x50');
      setCardLayers((ls) => syncFieldsToLayers(ls, nextFields, initialTpl, cardUnits.heightUnits));
    }

    // 다시 꾸미기 복원
    const saved = props.restoreCode ? loadSavedDesigns().find((d) => d.code === props.restoreCode) : null;
    if (saved?.snapshot && saved.productNo === product.productNo && saved.productUrl === product.url) {
      void restore(saved.snapshot, `${saved.code} 디자인을 불러왔어요. 고친 뒤 저장하면 새 코드가 나와요.`, false);
      return;
    }
    if (props.restoreCode) {
      setBanner('이 기기에서 저장한 디자인을 찾지 못해 새로 꾸며요.');
    }

    // 자동 보관 불러오기 확인
    const autoSnap = loadAutosave(product.productNo, Date.now(), product.url);
    if (autoSnap) {
      setResume(autoSnap);
    }
  }, []);

  // 보관된 편집 상태 복원
  const restore = async (stored: unknown, message: string, keepSaving: boolean) => {
    const r = await fromStored(stored, {
      styleIds: styles.map((x) => x.id),
      events: events.map((e) => e.id),
    });
    setResume(null);
    if (!r) return setBanner('저장해 둔 디자인을 읽지 못했어요. 새로 꾸며 주세요.');
    const d = r.snap;
    setPurpose(d.purpose ?? 'return');
    isRestoring.current = true;
    setSettled(
      Object.fromEntries(
        d.layers.flatMap((l) => (l.type === 'text' ? [[l.id, fillPlaceholders(l.text, d.fields)]] : [])),
      ),
    );

    const draftFormat = classifyDraftFormat(d);
    let restoredLayers = d.layers;
    let bannerMsg = r.missingPhotos
      ? `${message} 올렸던 사진 ${r.missingPhotos}장은 이 기기에 남아 있지 않아 빠졌어요.`
      : message;

    if (draftFormat === 'legacy_confirmed') {
      const firstTextIdx = restoredLayers.findIndex(
        (l) => l.type === 'text' && !['role-recipient', 'role-sender', 'role-date'].includes(l.id),
      );
      if (firstTextIdx >= 0) {
        restoredLayers = restoredLayers.map((l, i) => (i === firstTextIdx ? { ...l, id: 'role-main' } : l));
      }
    } else if (draftFormat === 'ambiguous') {
      bannerMsg = `${bannerMsg} (이전 버전에서 작성된 문구는 기본 문구 입력란과 분리되어 유지됩니다.)`;
    }

    setStyleId(d.styleId);
    setWithSticker(d.withSticker);
    setShape(d.shape);
    setSizeCm(d.sizeCm);
    setBackground(d.background);
    setLayers(restoredLayers);
    setFields(d.fields);

    hasChosenImage.current = restoredLayers.some((l) => l.type === 'image');
    autoTextEdited.current = true;
    setNamesChecked(false);

    const restoredMain = extractMainTextFromLayers(restoredLayers, draftFormat);
    setMainText(restoredMain);

    // 카드 복원
    setWithCard(Boolean(d.withCard));
    setCardSizeMm(d.cardSizeMm ?? '74x50');
    setCardBackground(d.cardBackground ?? '#ffffff');
    const restoredCardLayers = d.cardLayers ?? initialCardLayers;
    setCardLayers(restoredCardLayers);
    setCardFields(d.cardFields ?? { recipient: '', sender: '', date: '' });
    cardHasChosenImage.current = restoredCardLayers.some((l) => l.type === 'image');
    cardAutoTextEdited.current = true;
    setCardNamesChecked(false);
    const restoredCardMain = extractMainTextFromLayers(restoredCardLayers, draftFormat);
    setCardMainText(restoredCardMain);

    if (d.withCard && !d.withSticker) {
      setSubStep('card');
    } else {
      setSubStep('sticker');
    }

    setEvent(keepSaving && props.event ? props.event : d.event);
    setQuantity(keepSaving && props.quantity > 1 ? props.quantity : d.quantity);
    setSelectedId(null);
    setCardSelectedId(null);
    setConsent(false);
    setCardConsent(false);
    autosaving.current = false;
    setBanner(bannerMsg);

    history.current = [];
    prevSnap.current = {
      layers: restoredLayers,
      background: d.background,
      shape: d.shape,
      sizeCm: d.sizeCm,
      selectedTemplateId: null,
      fields: { ...d.fields },
      mainText: restoredMain,
      autoTextEdited: true,
      hasChosenImage: hasChosenImage.current,
    };
    setCanUndo(false);
    lastPush.current = 0;

    cardHistory.current = [];
    cardPrevSnap.current = {
      layers: restoredCardLayers,
      background: d.cardBackground ?? '#ffffff',
      sizeMm: d.cardSizeMm ?? '74x50',
      fields: { ...(d.cardFields ?? { recipient: '', sender: '', date: '' }) },
      mainText: restoredCardMain,
      autoTextEdited: true,
      hasChosenImage: cardHasChosenImage.current,
    };
    setCanCardUndo(false);
    cardLastPush.current = 0;
  };

  // 메인 문구 입력 변경
  const handleMainTextChange = (text: string) => {
    autoTextEdited.current = true;
    setMainText(text);
    setLayers((ls) => syncMainTextToLayers(ls, text, currentTemplate));
  };

  const handleCardMainTextChange = (text: string) => {
    cardAutoTextEdited.current = true;
    setCardMainText(text);
    const cardUnits = cardCanvasUnits(cardSizeMm);
    setCardLayers((ls) => syncMainTextToLayers(ls, text, currentTemplate, cardUnits.heightUnits));
  };

  // 선물 목적(답례 vs 축하) 변경
  const handlePurposeChange = (nextPurpose: GiftPurpose) => {
    if (nextPurpose === purpose) return;
    setPurpose(nextPurpose);
    const matchingStyle = availableStyles.find((s) => matchesTarget(s, event, nextPurpose, product.productNo));
    if (matchingStyle) setStyleId(matchingStyle.id);

    const nextTemplates = getEventTemplates({
      event,
      purpose: nextPurpose,
      relation: props.relation,
      images: props.images,
    });
    if (nextTemplates.length > 0) {
      const tpl = nextTemplates[0];
      if (!autoTextEdited.current && !hasChosenImage.current) {
        setSelectedTemplateId(tpl.id);
        setBackground(tpl.background);
        setShape(tpl.shape);
        setSizeCm(tpl.sizeCm);
        setLayers(tpl.createLayers({ mainText: tpl.mainText, fields }));
        setMainText(tpl.mainText);
      }

      // 카드도 커스텀 편집이 없었다면 함께 목적 템플릿으로 갱신
      if (!cardAutoTextEdited.current && !cardHasChosenImage.current) {
        setCardSelectedTemplateId(tpl.id);
        setCardBackground(tpl.background);
        const cardUnits = cardCanvasUnits(cardSizeMm);
        setCardLayers(createCardLayers(tpl, cardUnits.heightUnits));
        setCardMainText(tpl.mainText);
      }
    }
  };

  // 자동 보관
  const snapshot: EditorSnapshot = {
    version: 2,
    purpose,
    styleId,
    withSticker,
    shape,
    sizeCm,
    background,
    layers,
    fields,
    withCard,
    cardSizeMm,
    cardBackground,
    cardLayers,
    cardFields,
    event,
    quantity,
  };

  useEffect(() => {
    if (resume !== null) return;
    autosaving.current = true;
    autosaveTimer.current = setTimeout(() => autosave(product.productNo, snapshot, product.url), 800);
    return () => clearTimeout(autosaveTimer.current);
  }, [
    resume,
    canUndo,
    canCardUndo,
    styleId,
    withSticker,
    shape,
    sizeCm,
    background,
    layers,
    fields,
    withCard,
    cardSizeMm,
    cardBackground,
    cardLayers,
    cardFields,
    event,
    quantity,
    purpose,
  ]);

  // 자리표시자 바인딩
  const rendered = useMemo(
    () => layers.map((l) => (l.type === 'text' ? { ...l, text: fillPlaceholders(l.text, fields) } : l)),
    [layers, fields],
  );

  const renderedCard = useMemo(
    () => cardLayers.map((l) => (l.type === 'text' ? { ...l, text: fillPlaceholders(l.text, cardFields) } : l)),
    [cardLayers, cardFields],
  );

  // 긴 이름 자동 맞춤 (스티커)
  useEffect(() => {
    const done: Record<string, string> = {};
    for (const l of rendered) {
      const r = textRects[l.id];
      if (l.type !== 'text' || !r || r.text !== l.text || r.fontSize !== l.fontSize || settled[l.id] === l.text)
        continue;
      const prev = fitTries.current[l.id];
      const tries = prev?.text === l.text ? prev.tries : 0;
      const k = fitScale(shape, sizeCm, r);
      if (k >= 1 || k < 0.5 || tries >= 4 || l.fontSize <= MIN_AUTO_FONT) {
        done[l.id] = l.text;
        continue;
      }
      fitTries.current[l.id] = { text: l.text, tries: tries + 1 };
      isAutoFitting.current = true;
      updateLayer(l.id, { fontSize: Math.max(MIN_AUTO_FONT, Math.floor(l.fontSize * k * 0.97)) });
    }
    if (Object.keys(done).length) setSettled((m) => ({ ...m, ...done }));
  }, [textRects]);

  // 긴 이름 자동 맞춤 (카드)
  useEffect(() => {
    const done: Record<string, string> = {};
    for (const l of renderedCard) {
      const r = cardTextRects[l.id];
      if (
        l.type !== 'text' ||
        !r ||
        r.text !== l.text ||
        r.fontSize !== l.fontSize ||
        cardSettled[l.id] === l.text
      )
        continue;
      const prev = cardFitTries.current[l.id];
      const tries = prev?.text === l.text ? prev.tries : 0;
      const k = fitScaleCard(cardSizeMm, r);
      if (k >= 1 || k < 0.5 || tries >= 4 || l.fontSize <= MIN_AUTO_FONT) {
        done[l.id] = l.text;
        continue;
      }
      cardFitTries.current[l.id] = { text: l.text, tries: tries + 1 };
      isCardAutoFitting.current = true;
      updateCardLayer(l.id, { fontSize: Math.max(MIN_AUTO_FONT, Math.floor(l.fontSize * k * 0.97)) });
    }
    if (Object.keys(done).length) setCardSettled((m) => ({ ...m, ...done }));
  }, [cardTextRects]);

  // 스티커 유효성 검사
  const overflowBoxes = withSticker
    ? rendered.flatMap((l) => {
        const r = textRects[l.id];
        return l.type === 'text' && r && r.text === l.text && settled[l.id] === l.text && fitScale(shape, sizeCm, r) < 1
          ? [r]
          : [];
      })
    : [];

  const textBoxes = withSticker
    ? rendered.flatMap((l) => (l.type === 'text' && textRects[l.id] ? [textRects[l.id]] : []))
    : [];
  const overlapBoxes = textBoxes.filter((a, i) => textBoxes.some((b, j) => i !== j && overlaps(a, b)));
  const caution = withSticker
    ? [...new Set(rendered.flatMap((l) => (l.type === 'text' ? cautionWords(event, l.text) : [])))]
    : [];

  const namesUsed = withSticker && isNamesUsedInLayers(layers);
  const uploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
  const lowRes = uploads.some((l) => effectiveDpi(l.naturalWidth ?? 0, l.width * l.scaleX, sizeCm) < MIN_PRINT_DPI);

  // 카드 유효성 검사
  const cardOverflowBoxes = withCard
    ? renderedCard.flatMap((l) => {
        const r = cardTextRects[l.id];
        return l.type === 'text' && r && fitScaleCard(cardSizeMm, r) < 1 ? [r] : [];
      })
    : [];

  const cardTextBoxes = withCard
    ? renderedCard.flatMap((l) => (l.type === 'text' && cardTextRects[l.id] ? [cardTextRects[l.id]] : []))
    : [];
  const cardOverlapBoxes = cardTextBoxes.filter((a, i) => cardTextBoxes.some((b, j) => i !== j && overlaps(a, b)));
  const cardCaution = withCard
    ? [...new Set(renderedCard.flatMap((l) => (l.type === 'text' ? cautionWords(event, l.text) : [])))]
    : [];

  const cardNamesUsed = withCard && isNamesUsedInLayers(cardLayers);
  const cardUploads = cardLayers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
  const cardLowRes = cardUploads.some(
    (l) => effectiveDpiCard(l.naturalWidth ?? 0, l.width * l.scaleX, cardSizeMm) < MIN_PRINT_DPI,
  );

  // 레이어 수정 함수 (스티커)
  const updateLayer = (id: string, patch: Partial<EditorLayer>) => {
    if ('text' in patch && typeof (patch as { text?: unknown }).text === 'string') {
      autoTextEdited.current = true;
      const val = (patch as { text: string }).text;
      if (id === 'role-main') {
        setMainText(val);
      } else if (id === 'role-recipient') {
        setFields((f) => ({ ...f, recipient: val }));
        setNamesChecked(false);
      } else if (id === 'role-sender') {
        setFields((f) => ({ ...f, sender: val }));
        setNamesChecked(false);
      } else if (id === 'role-date') {
        setFields((f) => ({ ...f, date: val }));
        setNamesChecked(false);
      }
    }
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as EditorLayer) : l)));
  };

  // 레이어 수정 함수 (카드)
  const updateCardLayer = (id: string, patch: Partial<EditorLayer>) => {
    if ('text' in patch && typeof (patch as { text?: unknown }).text === 'string') {
      cardAutoTextEdited.current = true;
      const val = (patch as { text: string }).text;
      if (id === 'role-main') {
        setCardMainText(val);
      } else if (id === 'role-recipient') {
        setCardFields((f) => ({ ...f, recipient: val }));
        setCardNamesChecked(false);
      } else if (id === 'role-sender') {
        setCardFields((f) => ({ ...f, sender: val }));
        setCardNamesChecked(false);
      } else if (id === 'role-date') {
        setCardFields((f) => ({ ...f, date: val }));
        setCardNamesChecked(false);
      }
    }
    setCardLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as EditorLayer) : l)));
  };

  // 사진 업로드 핸들러 (스티커)
  const handleUpload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return setError('JPG 또는 PNG 사진만 올릴 수 있어요.');
    if (file.size > MAX_UPLOAD_BYTES) return setError('사진은 10MB까지 올릴 수 있어요.');
    const seq = ++pickSeq.current;
    const url = URL.createObjectURL(file);
    try {
      const { w, h } = await loadNatural(url);
      if (seq !== pickSeq.current) return URL.revokeObjectURL(url);
      const photoId = newId();
      void putPhoto(photoId, file);
      const newLayer = coverLayer(url, w, h, { uploaded: true, naturalWidth: w, photoId });
      setLayers((ls) => applyImageSelectionToLayers(ls, newLayer).nextLayers);
      hasChosenImage.current = true;
      setSelectedId(null);
    } catch {
      URL.revokeObjectURL(url);
      setError('사진을 읽을 수 없어요. 다른 사진을 골라 주세요.');
    }
  };

  // 사진 업로드 핸들러 (카드)
  const handleCardUpload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return setError('JPG 또는 PNG 사진만 올릴 수 있어요.');
    if (file.size > MAX_UPLOAD_BYTES) return setError('사진은 10MB까지 올릴 수 있어요.');
    const seq = ++pickSeq.current;
    const url = URL.createObjectURL(file);
    try {
      const { w, h } = await loadNatural(url);
      if (seq !== pickSeq.current) return URL.revokeObjectURL(url);
      const photoId = newId();
      void putPhoto(photoId, file);
      const cardUnits = cardCanvasUnits(cardSizeMm);
      const newLayer = coverLayer(url, w, h, { uploaded: true, naturalWidth: w, photoId }, cardUnits.heightUnits);
      setCardLayers((ls) => applyImageSelectionToLayers(ls, newLayer).nextLayers);
      cardHasChosenImage.current = true;
      setCardSelectedId(null);
    } catch {
      URL.revokeObjectURL(url);
      setError('사진을 읽을 수 없어요. 다른 사진을 골라 주세요.');
    }
  };

  // 추천 이미지 선택 (스티커)
  const handlePickImage = async (img: DesignImage) => {
    const seq = ++pickSeq.current;
    try {
      const { w, h } = await loadNatural(img.imageUrl);
      if (seq !== pickSeq.current) return;
      const layer = coverLayer(img.imageUrl, w, h);
      setLayers((ls) => applyImageSelectionToLayers(ls, layer).nextLayers);
      hasChosenImage.current = true;
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 추천 이미지 선택 (카드)
  const handlePickCardImage = async (img: DesignImage) => {
    const seq = ++pickSeq.current;
    try {
      const { w, h } = await loadNatural(img.imageUrl);
      if (seq !== pickSeq.current) return;
      const cardUnits = cardCanvasUnits(cardSizeMm);
      const layer = coverLayer(img.imageUrl, w, h, {}, cardUnits.heightUnits);
      setCardLayers((ls) => applyImageSelectionToLayers(ls, layer).nextLayers);
      cardHasChosenImage.current = true;
      setCardSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 이미지 삭제
  const handleRemoveImage = () => {
    setLayers((ls) => ls.filter((l) => l.type !== 'image'));
    hasChosenImage.current = false;
    if (selectedId && layers.find((l) => l.id === selectedId)?.type === 'image') {
      setSelectedId(null);
    }
  };

  const handleRemoveCardImage = () => {
    setCardLayers((ls) => ls.filter((l) => l.type !== 'image'));
    cardHasChosenImage.current = false;
    if (cardSelectedId && cardLayers.find((l) => l.id === cardSelectedId)?.type === 'image') {
      setCardSelectedId(null);
    }
  };

  // 추천 문구 선택
  const handlePickText = (t: DesignText) => {
    autoTextEdited.current = true;
    if (selectedId) {
      const selectedLayer = layers.find((l) => l.id === selectedId);
      if (selectedLayer && selectedLayer.type === 'text') {
        updateLayer(selectedId, { text: t.text });
        if (selectedId === 'role-main') {
          setMainText(t.text);
        }
        return;
      }
    }
    setMainText(t.text);
    setLayers((ls) => syncMainTextToLayers(ls, t.text, currentTemplate));
  };

  const handlePickCardText = (t: DesignText) => {
    cardAutoTextEdited.current = true;
    if (cardSelectedId) {
      const selectedLayer = cardLayers.find((l) => l.id === cardSelectedId);
      if (selectedLayer && selectedLayer.type === 'text') {
        updateCardLayer(cardSelectedId, { text: t.text });
        if (cardSelectedId === 'role-main') {
          setCardMainText(t.text);
        }
        return;
      }
    }
    setCardMainText(t.text);
    const cardUnits = cardCanvasUnits(cardSizeMm);
    setCardLayers((ls) => syncMainTextToLayers(ls, t.text, currentTemplate, cardUnits.heightUnits));
  };

  // 최종 디자인 저장 & 코드 발급
  const save = async () => {
    setError(null);
    if (!pendingCommit.current) {
      try { pendingCommit.current = JSON.parse(sessionStorage.getItem('ondap_pending_print_commit') || 'null'); } catch { /* 저장소를 사용할 수 없으면 현재 화면에서만 재시도한다. */ }
    }
    if (pendingCommit.current) {
      const pending = pendingCommit.current;
      setSaving(true);
      try {
        const result = await commitDesignUploadAction(pending);
        if (!result.ok) {
          if (!result.uncertain) {
            pendingCommit.current = null;
            try { sessionStorage.removeItem('ondap_pending_print_commit'); } catch { /* 저장소 사용 불가 */ }
            return setError(`이전 접수를 완료하지 못했습니다. ${result.message} 다시 저장해 주세요.`);
          }
          return setError(`이전 접수 ${pending.code}의 완료 여부를 확인하지 못했습니다. ${result.message} 다시 시도해 주세요.`);
        }
        pendingCommit.current = null;
        try { sessionStorage.removeItem('ondap_pending_print_commit'); } catch { /* 저장소 사용 불가 */ }
        setResult({ code: result.code, preview: null, cardPreview: null });
        setBanner('이전에 저장을 요청한 디자인의 접수를 확인했습니다. 이후 수정한 내용은 포함되지 않습니다.');
        return;
      } catch {
        return setError(`이전 접수 ${pending.code}의 완료 여부를 확인하지 못했습니다. 다시 시도해 주세요.`);
      } finally { setSaving(false); }
    }
    if (!styleId) return setError('포장 스타일을 골라 주세요.');

    const hasAny = withSticker || withCard;
    if (hasAny) {
      if (withSticker && layers.length === 0) return setError('스티커에 문구나 이미지를 하나 이상 넣어 주세요.');
      if (withCard && cardLayers.length === 0) return setError('카드에 문구나 이미지를 하나 이상 넣어 주세요.');
      if (withSticker && uploads.length > 0 && !consent)
        return setError('올린 스티커 사진의 사용 권한을 확인해 주세요.');
      if (withCard && cardUploads.length > 0 && !cardConsent)
        return setError('올린 카드 사진의 사용 권한을 확인해 주세요.');
      if ((namesUsed && !namesChecked) || (cardNamesUsed && !cardNamesChecked)) {
        return setError('이름과 날짜 철자를 확인했다고 체크해 주세요.');
      }
      if (
        (overflowBoxes.length > 0 || cardOverflowBoxes.length > 0) &&
        !window.confirm('자르는 선에 걸려 글자가 잘릴 수 있어요. 그대로 저장할까요?')
      ) {
        return;
      }
      if (
        (overlapBoxes.length > 0 || cardOverlapBoxes.length > 0) &&
        !window.confirm('문구가 서로 겹쳐 있어요. 그대로 저장할까요?')
      ) {
        return;
      }
    }

    setSaving(true);
    setSelectedId(null);
    setCardSelectedId(null);
    const preserveFailedDesign = async () => {
      clearTimeout(autosaveTimer.current);
      if (resume !== null) return false;
      return saveRecovery(product.productNo, snapshot, product.url);
    };

    try {
      let stickerBlob: Blob | null = null;
      let cardBlob: Blob | null = null;
      let preview: string | null = null;
      let cardPreview: string | null = null;
      let draft: DesignDraft | null = null;
      let cardDraft: DesignDraft | null = null;

      if (withSticker) {
        if (!apiRef.current) throw new Error('스티커 캔버스가 아직 준비되지 않았습니다.');
        const blob = await apiRef.current.exportPng(printPixels(sizeCm));
        if (blob.size > MAX_STICKER_PRINT_BYTES) {
          throw new Error('스티커 인쇄 파일 용량이 너무 큽니다 (최대 4MB). 사진 크기를 조절해 주세요.');
        }
        stickerBlob = blob;
        preview = URL.createObjectURL(blob);
        draft = {
          background,
          purpose,
          fields,
          layers: layers.map((l) => {
            if (l.type !== 'image') return l;
            const { uploaded, naturalWidth: _w, ...rest } = l;
            return uploaded ? { ...rest, src: 'upload' } : rest;
          }),
        };
      }

      if (withCard) {
        if (!cardApiRef.current) throw new Error('카드 캔버스가 아직 준비되지 않았습니다.');
        const cardBlobRaw = await cardApiRef.current.exportPng(cardPrintPixels(cardSizeMm));
        if (cardBlobRaw.size > MAX_CARD_PRINT_BYTES) {
          throw new Error('카드(엽서) 인쇄 파일 용량이 너무 큽니다 (최대 10MB). 사진 크기를 조절해 주세요.');
        }
        cardBlob = cardBlobRaw;
        cardPreview = URL.createObjectURL(cardBlobRaw);
        cardDraft = {
          background: cardBackground,
          purpose,
          fields: cardFields,
          layers: cardLayers.map((l) => {
            if (l.type !== 'image') return l;
            const { uploaded, naturalWidth: _w, ...rest } = l;
            return uploaded ? { ...rest, src: 'upload' } : rest;
          }),
        };
      }

      const meta = {
        productNo: product.productNo,
        quantity,
        event,
        styleId,
        sticker: withSticker ? { shape, sizeCm } : null,
        draft,
        card: withCard ? { sizeMm: cardSizeMm } : null,
        cardDraft,
      };

      // 1단계: 업로드 세션 준비
      const prep = await prepareDesignUploadAction(meta);
      if (!prep.ok) {
        if (preview) URL.revokeObjectURL(preview);
        if (cardPreview) URL.revokeObjectURL(cardPreview);
        const saved = await preserveFailedDesign();
        return setError(
          `디자인이 접수되지 않았습니다: ${prep.message} ${
            saved
              ? '이 기기에 임시 보관했어요. 같은 기기에서 다시 열고 저장을 재시도해 주세요.'
              : '이 기기에 임시 보관하지 못했어요. 화면을 닫지 말고 다시 시도해 주세요.'
          }`,
        );
      }

      let code = prep.code;

      // 2단계: 인쇄 파일이 필요한 경우 서명 URL 또는 로컬 업로드 엔드포인트로 직접 전송
      if (!prep.direct) {
        if (prep.uploads.sticker && stickerBlob) {
          await uploadPrintBlob(prep.uploads.sticker, stickerBlob);
        }
        if (prep.uploads.card && cardBlob) {
          await uploadPrintBlob(prep.uploads.card, cardBlob);
        }

        // 3단계: 업로드 완료 검증 및 접수 확정 (Commit)
        pendingCommit.current = { sessionId: prep.sessionId, secret: prep.secret, code: prep.code };
        try { sessionStorage.setItem('ondap_pending_print_commit', JSON.stringify(pendingCommit.current)); } catch { /* 현재 화면에서 재시도 */ }
        const commit = await commitDesignUploadAction({
          sessionId: prep.sessionId,
          secret: prep.secret,
        });

        if (!commit.ok) {
          if (!commit.uncertain) {
            pendingCommit.current = null;
            try { sessionStorage.removeItem('ondap_pending_print_commit'); } catch { /* 저장소 사용 불가 */ }
          }
          if (preview) URL.revokeObjectURL(preview);
          if (cardPreview) URL.revokeObjectURL(cardPreview);
          const saved = await preserveFailedDesign();
          return setError(
            `${commit.uncertain ? `접수 ${prep.code}의 완료 여부를 확인하지 못했습니다` : '디자인 접수를 완료하지 못했습니다'}: ${commit.message} ${
              saved
                ? '이 기기에 임시 보관했어요. 같은 기기에서 다시 열고 저장을 재시도해 주세요.'
                : '이 기기에 임시 보관하지 못했어요. 화면을 닫지 말고 다시 시도해 주세요.'
            }`,
          );
        }
        pendingCommit.current = null;
        try { sessionStorage.removeItem('ondap_pending_print_commit'); } catch { /* 저장소 사용 불가 */ }
        code = commit.code;
      }

      setResult({ code, preview, cardPreview });
      clearTimeout(autosaveTimer.current);
      clearAutosave();
      rememberFields(fields);

      const thumbBlob = preview
        ? await fetch(preview).then((r) => r.blob()).catch(() => null)
        : cardPreview
        ? await fetch(cardPreview).then((r) => r.blob()).catch(() => null)
        : null;
      if (thumbBlob) {
        void savePreview(code, thumbBlob);
      }
      rememberDesign({
        code,
        productName: product.name,
        productUrl: product.url,
        quantity,
        savedAt: new Date().toISOString(),
        thumb: thumbBlob ? await makeThumb(thumbBlob) : null,
        productNo: product.productNo,
        snapshot: toStored(snapshot),
      });
    } catch (e) {
      const saved = await preserveFailedDesign();
      setError(
        `디자인 접수를 확인하지 못했습니다. (${e instanceof Error ? e.message : String(e)}) ${
          saved
            ? '이 기기에 임시 보관했어요. 재시도 전에 내 디자인에서 이미 접수됐는지 확인해 주세요.'
            : '이 기기에 임시 보관하지 못했어요. 화면을 닫지 말고 내 디자인을 확인한 뒤 다시 시도해 주세요.'
        }`,
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedStyle = styles.find((s) => s.id === styleId);
  const cut = (bleedUnits(sizeCm) / CANVAS_UNITS) * 100;
  const cutClip = shape === 'circle' ? `circle(${50 - cut}% at 50% 50%)` : `inset(${cut}%)`;

  const handleGoStep = (step: 1 | 2 | 3, target?: 'sticker' | 'card') => {
    setCurrentStep(step);
    if (step === 2 && target) {
      setSubStep(target);
    }
  };

  return (
    <div className="pkg-page-wrapper">
      {/* 1. 상단 단계 내비게이션 바 */}
      <StepNavigation currentStep={currentStep} onStepClick={setCurrentStep} />

      {/* 2. 상품 정보 & 선물 목적 요약 헤더 */}
      <ProductHeader
        product={product}
        quantity={quantity}
        onQuantityChange={setQuantity}
        purpose={purpose}
        onPurposeChange={handlePurposeChange}
        eventName={eventName}
        relationName={props.relationName}
        backHref={backHref}
        backLabel={backLabel}
        packagingOption={packagingOption}
      />

      {/* 자동 보관 알림 */}
      {resume !== null && (
        <div className="notice editor-resume" role="status" style={{ marginTop: 12 }}>
          <span>이전에 꾸미다 만 디자인이 보관되어 있습니다.</span>
          <span className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn small"
              onClick={() => void restore(resume, '보관된 디자인을 불러왔습니다.', true)}
            >
              이어서 꾸미기
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                clearAutosave();
                setResume(null);
              }}
            >
              새로 시작
            </button>
          </span>
        </div>
      )}

      {banner && (
        <p className="notice" role="status" style={{ margin: '12px 0 0' }}>
          {banner}
        </p>
      )}

      {/* 3. 메인 작업 레이아웃 */}
      <main className="pkg-workstation-layout">
        <section className="pkg-left-column" aria-label="포장 제작 편집 도구">
          {currentStep === 1 && (
            <Step1Wrapping
              styles={availableStyles}
              styleId={styleId}
              onSelectStyle={setStyleId}
              productNo={product.productNo}
              event={event}
              purpose={purpose}
              eventName={eventName}
              packagingOption={packagingOption}
              onNext={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 2 && (
            <Step2Message
              withSticker={withSticker}
              setWithSticker={setWithSticker}
              withCard={withCard}
              setWithCard={setWithCard}
              subStep={subStep}
              setSubStep={setSubStep}
              eventName={eventName}
              relationName={props.relationName}
              mainText={mainText}
              onMainTextChange={handleMainTextChange}
              fields={fields}
              shape={shape}
              setShape={setShape}
              sizeCm={sizeCm}
              setSizeCm={setSizeCm}
              background={background}
              setBackground={setBackground}
              layers={rendered}
              selectedId={selectedId}
              onUpdateLayer={updateLayer}
              onUpload={handleUpload}
              consent={consent}
              setConsent={setConsent}
              canUndo={canUndo}
              onUndo={undo}
              onPickImage={handlePickImage}
              onRemoveImage={handleRemoveImage}
              nearTexts={texts}
              onPickText={handlePickText}
              overflowBoxes={overflowBoxes}
              overlapBoxes={overlapBoxes}
              caution={caution}
              lowRes={lowRes}
              cardSizeMm={cardSizeMm}
              setCardSizeMm={setCardSizeMm}
              cardBackground={cardBackground}
              setCardBackground={setCardBackground}
              cardLayers={renderedCard}
              cardSelectedId={cardSelectedId}
              onUpdateCardLayer={updateCardLayer}
              cardMainText={cardMainText}
              onCardMainTextChange={handleCardMainTextChange}
              cardFields={cardFields}
              onCardUpload={handleCardUpload}
              cardConsent={cardConsent}
              setCardConsent={setCardConsent}
              canCardUndo={canCardUndo}
              onCardUndo={undoCard}
              onPickCardImage={handlePickCardImage}
              onRemoveCardImage={handleRemoveCardImage}
              onPickCardText={handlePickCardText}
              cardOverflowBoxes={cardOverflowBoxes}
              cardOverlapBoxes={cardOverlapBoxes}
              cardCaution={cardCaution}
              cardLowRes={cardLowRes}
              images={images}
              otherImages={otherImages}
              categoryNames={categoryNames}
              onPrev={() => setCurrentStep(1)}
              onNext={() => setCurrentStep(3)}
            />
          )}

          {currentStep === 3 && (
            <Step3Review
              product={product}
              quantity={quantity}
              style={selectedStyle}
              withSticker={withSticker}
              shape={shape}
              sizeCm={sizeCm}
              layers={rendered}
              withCard={withCard}
              cardSizeMm={cardSizeMm}
              cardLayers={renderedCard}
              namesUsed={namesUsed || cardNamesUsed}
              namesChecked={(!namesUsed || namesChecked) && (!cardNamesUsed || cardNamesChecked)}
              setNamesChecked={(val) => {
                if (namesUsed) setNamesChecked(val);
                if (cardNamesUsed) setCardNamesChecked(val);
              }}
              uploadsCount={(withSticker ? uploads.length : 0) + (withCard ? cardUploads.length : 0)}
              consent={(!withSticker || !uploads.length || consent) && (!withCard || !cardUploads.length || cardConsent)}
              setConsent={(val) => {
                if (withSticker && uploads.length) setConsent(val);
                if (withCard && cardUploads.length) setCardConsent(val);
              }}
              overflowBoxes={[...overflowBoxes, ...cardOverflowBoxes]}
              overlapBoxes={[...overlapBoxes, ...cardOverlapBoxes]}
              saving={saving}
              error={error}
              packagingOption={packagingOption}
              onGoStep={handleGoStep}
              onSave={save}
              onOpenRealSize={(target) => setRealSizeModal({ open: true, target: target ?? subStep })}
            />
          )}
        </section>

        {/* 우측 실시간 Sticky 미리보기 패널 */}
        <div className="pkg-right-column">
          <PreviewPane
            currentStep={currentStep}
            subStep={subStep}
            style={selectedStyle}
            withSticker={withSticker}
            shape={shape}
            sizeCm={sizeCm}
            background={background}
            layers={rendered}
            fontFamilies={fontFamilies}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            onUpdateLayer={updateLayer}
            apiRef={apiRef}
            onTextRects={setTextRects}
            warnBoxes={[...overflowBoxes, ...overlapBoxes]}
            withCard={withCard}
            cardSizeMm={cardSizeMm}
            cardBackground={cardBackground}
            cardLayers={renderedCard}
            cardSelectedId={cardSelectedId}
            onSelectCardId={setCardSelectedId}
            onUpdateCardLayer={updateCardLayer}
            cardApiRef={cardApiRef}
            onCardTextRects={setCardTextRects}
            cardWarnBoxes={[...cardOverflowBoxes, ...cardOverlapBoxes]}
            onOpenRealSize={(target) => setRealSizeModal({ open: true, target: target ?? subStep })}
          />
        </div>
      </main>

      {/* 디자인 완료 모달 */}
      {result && (
        <ResultModal
          code={result.code}
          preview={result.preview}
          cardPreview={result.cardPreview}
          cutClip={cutClip}
          product={product}
          quantity={quantity}
          from={from}
          packagingOption={packagingOption}
          onEditMore={() => setResult(null)}
        />
      )}

      {/* 실제 크기 보기 모달 */}
      {realSizeModal.open && (
        <RealSizeModalWrapper
          apiRef={apiRef}
          cardApiRef={cardApiRef}
          sizeCm={sizeCm}
          shape={shape}
          cutClip={cutClip}
          target={realSizeModal.target}
          cardSizeMm={cardSizeMm}
          onClose={() => setRealSizeModal({ open: false, target: 'sticker' })}
        />
      )}
    </div>
  );
}

// 실제 크기 보기용 비동기 이미지 래퍼
function RealSizeModalWrapper({
  apiRef,
  cardApiRef,
  sizeCm,
  shape,
  cutClip,
  target,
  cardSizeMm,
  onClose,
}: {
  apiRef: { current: CanvasApi | null };
  cardApiRef: { current: CanvasApi | null };
  sizeCm: StickerSizeCm;
  shape: StickerShape;
  cutClip: string;
  target: 'sticker' | 'card';
  cardSizeMm: CardSizeMm;
  onClose: () => void;
}) {
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    if (target === 'card') {
      if (!cardApiRef.current) return;
      void cardApiRef.current.exportPng(cardPrintPixels(cardSizeMm)).then((blob) => {
        setPng(URL.createObjectURL(blob));
      });
    } else {
      if (!apiRef.current) return;
      void apiRef.current.exportPng(printPixels(sizeCm)).then((blob) => {
        setPng(URL.createObjectURL(blob));
      });
    }
  }, [apiRef, cardApiRef, sizeCm, target, cardSizeMm]);

  if (!png) return null;
  return (
    <RealSizeModal
      png={png}
      sizeCm={sizeCm}
      shape={shape}
      clip={target === 'card' ? 'none' : cutClip}
      itemType={target}
      cardSizeMm={cardSizeMm}
      onClose={onClose}
    />
  );
}
