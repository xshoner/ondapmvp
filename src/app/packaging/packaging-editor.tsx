'use client';

// ONDAP 포장 꾸미기 3단계 제작 에디터
// STEP 1: 포장지 선택 -> STEP 2: 메시지 꾸미기 -> STEP 3: 최종 확인
// 일반 사용자가 복잡한 디자인 도구를 몰라도 추천 템플릿과 문구 수정만으로 포장을 완성할 수 있도록 구현

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventType } from '@/engine/types.ts';
import {
  CANVAS_UNITS,
  MIN_PRINT_DPI,
  STICKER_SIZES,
  bleedUnits,
  cautionWords,
  effectiveDpi,
  fillPlaceholders,
  fitScale,
  overlaps,
  printPixels,
  totalCm,
  type FontId,
} from '@/packaging/rules.ts';
import type {
  DesignCategory,
  DesignDraft,
  DesignImage,
  DesignText,
  GiftPurpose,
  PackagingStyle,
  StickerShape,
  StickerSizeCm,
  TextLayer,
} from '@/packaging/types.ts';
import { loadSavedDesigns, makeThumb, rememberDesign } from '@/packaging/client.ts';
import { matchesTarget, presetText } from '@/packaging/presets.ts';
import {
  applyImageSelectionToLayers,
  classifyDraftFormat,
  extractMainTextFromLayers,
  formatSenderDisplay,
  getEventTemplates,
  isNamesUsedInLayers,
  syncFieldsToLayers,
  syncMainTextToLayers,
  type DraftFormatType,
  type StickerTemplate,
} from '@/packaging/templates.ts';
import { saveDesignAction } from './actions.ts';
import {
  CARD_SHORT_MM,
  PREVIEW_PX,
  autosave,
  clearAutosave,
  forgetFields,
  fromStored,
  loadAutosave,
  loadFields,
  prunePhotos,
  putPhoto,
  rememberFields,
  savePreview,
  toStored,
  todayLabel,
} from './editor-store.ts';
import type { CanvasApi, EditorHistoryEntry, EditorImageLayer, EditorLayer, EditorSnapshot, TextRect } from './editor-types.ts';

import { StepNavigation } from './components/step-navigation.tsx';
import { ProductHeader } from './components/product-header.tsx';
import { Step1Wrapping } from './components/step1-wrapping.tsx';
import { Step2Message } from './components/step2-message.tsx';
import { Step3Review } from './components/step3-review.tsx';
import { PreviewPane } from './components/preview-pane.tsx';
import { ResultModal } from './components/result-modal.tsx';
import { RealSizeModal } from './components/real-size-modal.tsx';

export type PackagingEntry = 'recommend' | 'cafe24' | 'pick' | 'mine';

interface Props {
  product: { productNo: number; name: string; price: number; image: string | null; url: string };
  quantity: number;
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
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
    img.src = src;
  });
}

function coverLayer(src: string, w: number, h: number, extra: Partial<EditorImageLayer> = {}): EditorImageLayer {
  const r = w / h;
  return {
    id: newId(),
    type: 'image',
    src,
    x: 500,
    y: 500,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: r >= 1 ? 1000 * r : 1000,
    height: r >= 1 ? 1000 : 1000 / r,
    ...extra,
  };
}

export function PackagingEditor(props: Props) {
  const {
    product,
    styles,
    categoryNames,
    fontFamilies,
    events,
    from,
    backHref = '/',
    backLabel = '‹ 뒤로',
  } = props;

  // 1. 단일 핵심 상태 머신
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [purpose, setPurpose] = useState<GiftPurpose>('return');
  const [quantity, setQuantity] = useState(props.quantity);
  const [event, setEvent] = useState<DesignCategory | null>(props.event);

  // 사용 가능한 포장 스타일 (상품 제한 targeting.productNos 반영)
  const availableStyles = useMemo(() => {
    return styles.filter((s) => !s.targeting?.productNos?.length || s.targeting.productNos.includes(product.productNo));
  }, [styles, product.productNo]);

  const [styleId, setStyleId] = useState(() => {
    const matched = availableStyles.find((s) => matchesTarget(s, props.event, 'return', product.productNo));
    return matched?.id ?? availableStyles[0]?.id ?? styles[0]?.id ?? '';
  });

  // 사용 가능한 스타일이 변하거나 현재 styleId가 유효하지 않으면 폴백
  useEffect(() => {
    if (availableStyles.length > 0 && !availableStyles.some((s) => s.id === styleId)) {
      const fallback = availableStyles.find((s) => matchesTarget(s, event, purpose, product.productNo)) ?? availableStyles[0];
      if (fallback) setStyleId(fallback.id);
    }
  }, [availableStyles, styleId, event, purpose, product.productNo]);

  // 2. 행사 맞춤 템플릿 목록 (상태 초기값에 즉시 활용)
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

  const [withSticker, setWithSticker] = useState(true);
  const [shape, setShape] = useState<StickerShape>(() => initialTpl?.shape ?? 'circle');
  const [sizeCm, setSizeCm] = useState<StickerSizeCm>(() => initialTpl?.sizeCm ?? 6);
  const [background, setBackground] = useState<string>(() => initialTpl?.background ?? '#ffffff');
  const [layers, setLayers] = useState<EditorLayer[]>(() => initialLayers);
  const [fields, setFields] = useState<DesignDraft['fields']>({ recipient: '', sender: '', date: '' });
  const [mainText, setMainText] = useState<string>(() => initialTpl?.mainText ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(() => initialTpl?.id ?? null);

  // 사용자 편집 상태 및 첫 이미지 선택 여부 추적
  const autoTextEdited = useRef(false);
  const hasChosenImage = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [namesChecked, setNamesChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ code: string; preview: string | null } | null>(null);
  const [realSizeOpen, setRealSizeOpen] = useState(false);
  const [resume, setResume] = useState<unknown>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const apiRef = useRef<CanvasApi | null>(null);
  const pickSeq = useRef(0);
  const [textRects, setTextRects] = useState<Record<string, TextRect>>({});
  const fitTries = useRef<Record<string, { text: string; tries: number }>>({});
  const [settled, setSettled] = useState<Record<string, string>>({});
  const autosaving = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 실행 취소(되돌리기) 스택: 캔버스 레이어, 서식, 템플릿, 텍스트 입력값 전체를 100% 동기화하여 보관
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
  const started = useRef(false);
  const [canUndo, setCanUndo] = useState(false);

  const eventName = event && event !== 'common' ? categoryNames[event] : null;

  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) ?? templates[0];
  }, [templates, selectedTemplateId]);

  // 추천 이미지/문구 정렬
  const images = useMemo(() => {
    return props.images.filter((i) => i.category === event || i.category === 'common');
  }, [props.images, event]);
  const otherImages = useMemo(() => {
    return props.images.filter((i) => !images.includes(i));
  }, [props.images, images]);

  const texts = useMemo(() => {
    return props.texts.filter((t) => t.category === event || t.category === 'common');
  }, [props.texts, event]);
  const otherTexts = useMemo(() => {
    return props.texts.filter((t) => !texts.includes(t));
  }, [props.texts, texts]);

  // 템플릿 적용 함수 (고객 수정 문구, 추가 문구 및 사진 보존)
  const applyTemplate = (tpl: StickerTemplate, checkConfirm = false) => {
    const customUploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
    const customPickedImage = !customUploads.length && hasChosenImage.current
      ? layers.find((l) => l.type === 'image' && l.id !== 'template-image')
      : null;
    const additionalTextLayers = layers.filter(
      (l) => l.type === 'text' && !['role-main', 'role-recipient', 'role-sender', 'role-date'].includes(l.id),
    );
    const hasCustomEdits =
      autoTextEdited.current ||
      customUploads.length > 0 ||
      hasChosenImage.current ||
      additionalTextLayers.length > 0;

    if (checkConfirm && hasCustomEdits) {
      if (
        !window.confirm(
          '서식을 변경하면 폰트와 배치가 새 서식 기준으로 변경됩니다. 직접 입력하신 이름과 문구, 추가하신 문구 및 사진은 그대로 유지됩니다. 변경하시겠습니까?'
        )
      ) {
        return;
      }
    }

    setSelectedTemplateId(tpl.id);
    setBackground(tpl.background);
    setShape(tpl.shape);
    setSizeCm(tpl.sizeCm);

    // 직접 작성/수정한 문구가 있다면 유지, 아니면 새 템플릿의 문구 사용
    const textToUse = autoTextEdited.current && mainText.trim() ? mainText : tpl.mainText;

    const newLayers = tpl.createLayers({
      mainText: textToUse,
      fields,
    });

    // 1. 고객이 직접 올린 사진 또는 선택한 추천 이미지 보존
    let baseLayers = newLayers;
    if (customUploads.length > 0) {
      baseLayers = [customUploads[0], ...newLayers.filter((l) => l.type !== 'image')];
    } else if (customPickedImage) {
      baseLayers = [customPickedImage, ...newLayers.filter((l) => l.type !== 'image')];
    }

    // 2. 고객이 직접 추가한 별도 텍스트 레이어 보존
    const finalLayers = [...baseLayers, ...additionalTextLayers];

    setLayers(finalLayers);
    if (!autoTextEdited.current) {
      setMainText(tpl.mainText);
    }
    setSelectedId(null);
  };

  // 실행 취소 스택 관리
  useEffect(() => {
    if (!started.current) {
      return;
    }
    if (isRestoring.current) {
      isRestoring.current = false;
      return;
    }
    if (isUndoing.current) {
      isUndoing.current = false;
      return;
    }
    if (isAutoFitting.current) {
      isAutoFitting.current = false;
      if (prevSnap.current) {
        prevSnap.current = { ...prevSnap.current, layers };
      }
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
      // 마운트 시 최초 기준점만 등록 (히스토리 스택에 쌓지 않음 -> 초기 실행 취소 비활성화)
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
    setNamesChecked(false); // 실행 취소로 이름/날짜가 변경되었으므로 철자 확인 초기화

    prevSnap.current = { ...entry };
    setCanUndo(history.current.length > 0);
    lastPush.current = 0;
  };

  const clearAll = () => {
    if (prevSnap.current) {
      history.current.push(prevSnap.current);
      if (history.current.length > 50) history.current.shift();
      setCanUndo(true);
    }
    setLayers([]);
    setBackground('#ffffff');
    setSelectedId(null);
    setMainText('');
    setFields({ recipient: '', sender: '', date: '' });
    setNamesChecked(false);
  };

  // 초기 시작 시: 기본 템플릿 세팅 및 자동보관/다시꾸미기 검사
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void prunePhotos();

    const names = loadFields();
    if (names) {
      const nextFields = { recipient: names.recipient ?? '', sender: names.sender ?? '', date: '' };
      setFields((f) => ({ ...f, ...nextFields }));
      setLayers((ls) => {
        const nextLayers = syncFieldsToLayers(ls, nextFields, initialTpl);
        if (prevSnap.current) {
          prevSnap.current = {
            ...prevSnap.current,
            fields: { ...prevSnap.current.fields, ...nextFields },
            layers: nextLayers,
          };
        }
        return nextLayers;
      });
    }

    // 다시 꾸미기 복원
    const saved = props.restoreCode ? loadSavedDesigns().find((d) => d.code === props.restoreCode) : null;
    if (saved?.snapshot) {
      void restore(saved.snapshot, `${saved.code} 디자인을 불러왔어요. 고친 뒤 저장하면 새 코드가 나와요.`, false);
      return;
    }
    if (props.restoreCode) {
      setBanner('이 기기에서 저장한 디자인을 찾지 못해 새로 꾸며요.');
    }

    // 자동 보관 불러오기 확인
    const autoSnap = loadAutosave(product.productNo);
    if (autoSnap) {
      setResume(autoSnap);
    }
  }, []);

  // 보관된 편집 상태 복원 함수
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
      // 이전 형식으로 확실히 식별되는 초안: 기존 메인 문구를 role-main으로 정규화하여 복원
      const firstTextIdx = restoredLayers.findIndex(
        (l) => l.type === 'text' && !['role-recipient', 'role-sender', 'role-date'].includes(l.id),
      );
      if (firstTextIdx >= 0) {
        restoredLayers = restoredLayers.map((l, i) =>
          i === firstTextIdx ? { ...l, id: 'role-main' } : l,
        );
      }
    } else if (draftFormat === 'ambiguous') {
      // 형식을 확실히 구분할 수 없는 초안: 첫 텍스트의 역할을 임의로 바꾸지 않고 원래 레이어 보존, 안내 표기
      bannerMsg = `${bannerMsg} (이전 버전에서 작성된 문구는 기본 문구 입력란과 분리되어 유지됩니다.)`;
    }
    // 신규 초안('v2')인 경우: role-main이 없으면 의도적으로 메인 문구가 없는 상태이므로 layers 임의 변경 없음!

    setStyleId(d.styleId);
    setWithSticker(d.withSticker);
    setShape(d.shape);
    setSizeCm(d.sizeCm);
    setBackground(d.background);
    setLayers(restoredLayers);
    setFields(d.fields);

    hasChosenImage.current = restoredLayers.some((l) => l.type === 'image');
    autoTextEdited.current = true; // 복원된 디자인은 고객 작성 문구로 보호
    setNamesChecked(false); // 다른 초안을 불러왔을 때 이전 디자인의 철자 확인 체크가 유지되지 않도록 초기화

    // 복원된 레이어 중 메인 텍스트 추출
    const restoredMain = extractMainTextFromLayers(restoredLayers, draftFormat);
    setMainText(restoredMain);

    setEvent(keepSaving && props.event ? props.event : d.event);
    setQuantity(keepSaving && props.quantity > 1 ? props.quantity : d.quantity);
    setSelectedId(null);
    setConsent(false);
    // 복원만으로 원본 자동 보관을 갱신하지 않는다. 이후 편집부터 다시 보관한다.
    autosaving.current = false;
    setBanner(bannerMsg);

    // ★ 불러온 디자인을 실행 취소의 시작점(Baseline)으로 설정:
    // 실행 취소를 눌러 복원 전 디자인이나 빈 화면으로 돌아가지 않도록 history 초기화
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
  };

  // 메인 문구 입력 변경 시: role-main 텍스트 레이어 내용 실시간 갱신
  const handleMainTextChange = (text: string) => {
    autoTextEdited.current = true;
    setMainText(text);
    setLayers((ls) => syncMainTextToLayers(ls, text, currentTemplate));
  };

  // 받는 분, 보내는 사람, 날짜 입력 변경 시: 해당 레이어 실시간 동기화
  const handleFieldsChange = (newFields: DesignDraft['fields']) => {
    setFields(newFields);
    setNamesChecked(false); // 이름 또는 날짜가 변경되면 철자 재확인 필요
    setLayers((ls) => syncFieldsToLayers(ls, newFields, currentTemplate));
  };

  // 선물 목적(답례 vs 축하) 변경
  const handlePurposeChange = (nextPurpose: GiftPurpose) => {
    if (nextPurpose === purpose) return;
    const customUploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
    const hasCustomEdits = autoTextEdited.current || customUploads.length > 0 || hasChosenImage.current;

    if (hasCustomEdits) {
      if (
        !window.confirm(
          '선물 목적을 변경하면 해당 목적에 어울리는 추천 템플릿과 기본 문구로 교체됩니다. 직접 입력하신 이름과 사진은 유지됩니다. 계속하시겠습니까?'
        )
      ) {
        return;
      }
    }

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
      applyTemplate(nextTemplates[0], false);
    }
  };

  // 행사 변경
  const handleEventChange = (nextEvent: DesignCategory) => {
    if (nextEvent === event) return;
    const customUploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
    const hasCustomEdits = autoTextEdited.current || customUploads.length > 0 || hasChosenImage.current;

    if (hasCustomEdits) {
      if (
        !window.confirm(
          '행사를 변경하면 해당 행사에 어울리는 추천 템플릿과 기본 문구로 교체됩니다. 직접 입력하신 이름과 사진은 유지됩니다. 계속하시겠습니까?'
        )
      ) {
        return;
      }
    }

    setEvent(nextEvent);
    const matchingStyle = availableStyles.find((s) => matchesTarget(s, nextEvent, purpose, product.productNo));
    if (matchingStyle) setStyleId(matchingStyle.id);

    const nextTemplates = getEventTemplates({
      event: nextEvent,
      purpose,
      relation: props.relation,
      images: props.images,
    });
    if (nextTemplates.length > 0) {
      applyTemplate(nextTemplates[0], false);
    }
  };

  // 자동 보관 (LocalStorage)
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
    event,
    quantity,
  };

  useEffect(() => {
    if (resume !== null) return; // 기존 초안 복원 알림 중에는 덮어쓰지 않음
    if (!canUndo && !autosaving.current) return;
    autosaving.current = true;
    autosaveTimer.current = setTimeout(() => autosave(product.productNo, snapshot), 800);
    return () => clearTimeout(autosaveTimer.current);
  }, [resume, canUndo, styleId, withSticker, shape, sizeCm, background, layers, fields, event, quantity, purpose]);

  // 자리표시자 바인딩된 렌더용 레이어
  const rendered = useMemo(
    () => layers.map((l) => (l.type === 'text' ? { ...l, text: fillPlaceholders(l.text, fields) } : l)),
    [layers, fields],
  );

  // 긴 이름 자동 맞춤 (안전선 초과 시 폰트 축소)
  useEffect(() => {
    const done: Record<string, string> = {};
    for (const l of rendered) {
      const r = textRects[l.id];
      if (l.type !== 'text' || !r || r.text !== l.text || r.fontSize !== l.fontSize || settled[l.id] === l.text) continue;
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

  // 유효성 경고 검사
  const overflowBoxes = withSticker
    ? rendered.flatMap((l) => {
        const r = textRects[l.id];
        return l.type === 'text' && r && r.text === l.text && settled[l.id] === l.text && fitScale(shape, sizeCm, r) < 1 ? [r] : [];
      })
    : [];

  const textBoxes = withSticker ? rendered.flatMap((l) => (l.type === 'text' && textRects[l.id] ? [textRects[l.id]] : [])) : [];
  const overlapBoxes = textBoxes.filter((a, i) => textBoxes.some((b, j) => i !== j && overlaps(a, b)));
  const caution = withSticker ? [...new Set(rendered.flatMap((l) => (l.type === 'text' ? cautionWords(event, l.text) : [])))] : [];

  const namesUsed = withSticker && isNamesUsedInLayers(layers);

  const uploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));
  const lowRes = uploads.some((l) => effectiveDpi(l.naturalWidth ?? 0, l.width * l.scaleX, sizeCm) < MIN_PRINT_DPI);

  // 레이어 수정 함수
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

  const removeSelected = () => {
    if (!selectedId) return;
    if (selectedId === 'role-main') {
      setMainText('');
    } else if (selectedId === 'role-recipient') {
      setFields((f) => ({ ...f, recipient: '' }));
      setNamesChecked(false);
    } else if (selectedId === 'role-sender') {
      setFields((f) => ({ ...f, sender: '' }));
      setNamesChecked(false);
    } else if (selectedId === 'role-date') {
      setFields((f) => ({ ...f, date: '' }));
      setNamesChecked(false);
    }
    setLayers((ls) => ls.filter((l) => l.id !== selectedId));
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

  // 사진 업로드 핸들러
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

      // 첫 이미지 선택이고 고객이 메인 문구를 수정하지 않았다면 기본 메인 문구(role-main)만 제거
      // 고객이 입력한 이름(role-sender), 받는 분(role-recipient), 날짜(role-date), 추가 문구는 반드시 유지
      setLayers((ls) => {
        const { nextLayers, shouldClearMainText } = applyImageSelectionToLayers(ls, newLayer, {
          hasChosenImage: hasChosenImage.current,
          autoTextEdited: autoTextEdited.current,
        });
        if (shouldClearMainText) {
          setMainText('');
        }
        return nextLayers;
      });
      hasChosenImage.current = true;
      setSelectedId(null);
    } catch {
      URL.revokeObjectURL(url);
      setError('사진을 읽을 수 없어요. 다른 사진을 골라 주세요.');
    }
  };

  // 추천 이미지 선택
  const handlePickImage = async (img: DesignImage) => {
    const seq = ++pickSeq.current;
    try {
      const { w, h } = await loadNatural(img.imageUrl);
      if (seq !== pickSeq.current) return;
      const layer = coverLayer(img.imageUrl, w, h);

      // 첫 이미지 선택이고 고객이 메인 문구를 수정하지 않았다면 기본 메인 문구(role-main)만 제거
      // 고객이 입력한 이름(role-sender), 받는 분(role-recipient), 날짜(role-date), 추가 문구는 반드시 유지
      setLayers((ls) => {
        const { nextLayers, shouldClearMainText } = applyImageSelectionToLayers(ls, layer, {
          hasChosenImage: hasChosenImage.current,
          autoTextEdited: autoTextEdited.current,
        });
        if (shouldClearMainText) {
          setMainText('');
        }
        return nextLayers;
      });
      hasChosenImage.current = true;
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 텍스트 추가
  const handleAddText = (initialText = '감사합니다') => {
    if (layers.length >= 12) return setError('스티커에는 최대 12개까지 요소를 넣을 수 있습니다.');
    autoTextEdited.current = true;
    const font = currentTemplate?.font ?? 'serif';
    const color = currentTemplate?.textColor ?? '#1f2a26';
    const newL: TextLayer = {
      id: newId(),
      type: 'text',
      text: initialText,
      x: 500,
      y: 500,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font,
      fontSize: 66,
      color,
      stroke: null,
      shadow: false,
    };
    setLayers((ls) => [...ls, newL]);
    setSelectedId(newL.id);
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

    // 선택된 레이어가 없거나 텍스트가 아닌 경우 메인 문구에 추천 문구 그대로 적용
    setMainText(t.text);
    setLayers((ls) => syncMainTextToLayers(ls, t.text, currentTemplate));
  };

  // 최종 디자인 저장 & 코드 발급
  const save = async () => {
    setError(null);
    if (!styleId) return setError('포장 스타일을 골라 주세요.');
    if (withSticker && layers.length === 0) return setError('스티커에 문구나 이미지를 하나 이상 넣어 주세요.');
    if (withSticker && uploads.length > 0 && !consent) return setError('올린 사진의 사용 권한을 확인해 주세요.');
    if (namesUsed && !namesChecked) return setError('이름과 날짜 철자를 확인했다고 체크해 주세요.');
    if (overflowBoxes.length > 0 && !window.confirm('자르는 선에 걸려 글자가 잘릴 수 있어요. 그대로 저장할까요?')) return;
    if (overlapBoxes.length > 0 && !window.confirm('문구가 서로 겹쳐 있어요. 그대로 저장할까요?')) return;

    setSaving(true);
    setSelectedId(null);
    try {
      const form = new FormData();
      let preview: string | null = null;
      let draft: DesignDraft | null = null;

      if (withSticker) {
        if (!apiRef.current) throw new Error('편집기 캔버스가 아직 준비되지 않았습니다.');
        const blob = await apiRef.current.exportPng(printPixels(sizeCm));
        form.set('print', blob, 'print.png');
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

      form.set(
        'meta',
        JSON.stringify({
          productNo: product.productNo,
          quantity,
          event,
          styleId,
          sticker: withSticker ? { shape, sizeCm } : null,
          draft,
        }),
      );

      const res = await saveDesignAction(form);
      if (!res.ok) {
        if (preview) URL.revokeObjectURL(preview);
        return setError(`디자인 저장에 실패했습니다: ${res.message}. 작성하신 문구와 편집 내용은 그대로 유지되어 있으니 다시 시도해 주세요.`);
      }

      setResult({ code: res.code, preview });
      clearTimeout(autosaveTimer.current);
      clearAutosave();
      rememberFields(fields);

      const thumbBlob = preview ? await fetch(preview).then((r) => r.blob()).catch(() => null) : null;
      if (thumbBlob) {
        void savePreview(res.code, thumbBlob);
      }
      rememberDesign({
        code: res.code,
        productName: product.name,
        productUrl: product.url,
        quantity,
        savedAt: new Date().toISOString(),
        thumb: thumbBlob ? await makeThumb(thumbBlob) : null,
        productNo: product.productNo,
        snapshot: toStored(snapshot),
      });
    } catch (e) {
      setError(`디자인 저장에 실패했습니다. (${e instanceof Error ? e.message : String(e)}) 작성하신 문구와 편집 내용은 안전하게 보존되어 있으니 다시 시도해 주세요.`);
    } finally {
      setSaving(false);
    }
  };

  const selectedStyle = styles.find((s) => s.id === styleId);
  const cut = (bleedUnits(sizeCm) / CANVAS_UNITS) * 100;
  const cutClip = shape === 'circle' ? `circle(${50 - cut}% at 50% 50%)` : `inset(${cut}%)`;

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

      {/* 3. 메인 작업 레이아웃: 좌측 편집 도구 (~40%) + 우측 실시간 Sticky 미리보기 (~60%) */}
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
              onNext={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 2 && (
            <Step2Message
              withSticker={withSticker}
              setWithSticker={setWithSticker}
              event={event}
              setEvent={handleEventChange}
              events={events}
              eventName={eventName}
              relationName={props.relationName}
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={(tpl) => applyTemplate(tpl, true)}
              mainText={mainText}
              onMainTextChange={handleMainTextChange}
              fields={fields}
              onFieldsChange={handleFieldsChange}
              shape={shape}
              setShape={setShape}
              sizeCm={sizeCm}
              setSizeCm={setSizeCm}
              background={background}
              setBackground={setBackground}
              layers={rendered}
              selectedId={selectedId}
              onSelectLayer={setSelectedId}
              onUpdateLayer={updateLayer}
              onAddText={handleAddText}
              onRemoveSelected={removeSelected}
              onMoveSelected={moveSelected}
              onUpload={handleUpload}
              consent={consent}
              setConsent={setConsent}
              canUndo={canUndo}
              onUndo={undo}
              onClearAll={clearAll}
              images={images}
              otherImages={otherImages}
              categoryNames={categoryNames}
              onPickImage={handlePickImage}
              nearTexts={texts}
              otherTexts={otherTexts}
              onPickText={handlePickText}
              overflowBoxes={overflowBoxes}
              overlapBoxes={overlapBoxes}
              caution={caution}
              lowRes={lowRes}
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
              namesUsed={namesUsed}
              namesChecked={namesChecked}
              setNamesChecked={setNamesChecked}
              uploadsCount={uploads.length}
              consent={consent}
              setConsent={setConsent}
              overflowBoxes={overflowBoxes}
              overlapBoxes={overlapBoxes}
              saving={saving}
              error={error}
              onGoStep={setCurrentStep}
              onSave={save}
              onOpenRealSize={() => setRealSizeOpen(true)}
            />
          )}
        </section>

        {/* 우측 실시간 Sticky 미리보기 패널 */}
        <div className="pkg-right-column">
          <PreviewPane
            currentStep={currentStep}
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
            onOpenRealSize={() => setRealSizeOpen(true)}
          />
        </div>
      </main>

      {/* 디자인 완료 모달 */}
      {result && (
        <ResultModal
          code={result.code}
          preview={result.preview}
          cutClip={cutClip}
          product={product}
          quantity={quantity}
          from={from}
          onEditMore={() => setResult(null)}
        />
      )}

      {/* 실제 크기 보기 모달 */}
      {realSizeOpen && apiRef.current && (
        <RealSizeModalWrapper
          apiRef={apiRef}
          sizeCm={sizeCm}
          shape={shape}
          cutClip={cutClip}
          onClose={() => setRealSizeOpen(false)}
        />
      )}
    </div>
  );
}

// 실제 크기 보기용 비동기 이미지 래퍼
function RealSizeModalWrapper({
  apiRef,
  sizeCm,
  shape,
  cutClip,
  onClose,
}: {
  apiRef: { current: CanvasApi | null };
  sizeCm: StickerSizeCm;
  shape: StickerShape;
  cutClip: string;
  onClose: () => void;
}) {
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    if (!apiRef.current) return;
    void apiRef.current.exportPng(printPixels(sizeCm)).then((blob) => {
      setPng(URL.createObjectURL(blob));
    });
  }, [apiRef, sizeCm]);

  if (!png) return null;
  return <RealSizeModal png={png} sizeCm={sizeCm} shape={shape} clip={cutClip} onClose={onClose} />;
}
