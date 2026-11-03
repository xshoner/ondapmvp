import type { DesignCategory, DesignImage, GiftPurpose, StickerShape, StickerSizeCm, TextLayer } from './types.ts';
import type { EditorImageLayer, EditorLayer } from '../app/packaging/editor-types.ts';
import type { FontId } from './rules.ts';

const newId = () => 'l' + Math.random().toString(36).slice(2, 9);

/**
 * 보내는 사람 포맷터
 * 고객이 입력한 성함/호칭을 그대로 반환합니다.
 * '올림', '드림', '배상' 등을 임의로 강제 부착하지 않습니다.
 */
export function formatSenderDisplay(rawSender: string): string {
  return (rawSender ?? '').trim();
}

/**
 * 받는 분, 보내는 사람, 날짜 필드를 캔버스 레이어에 동기화합니다.
 */
export function syncFieldsToLayers(
  layers: EditorLayer[],
  fields: { recipient: string; sender: string; date: string },
  template?: { font?: FontId; textColor?: string },
): EditorLayer[] {
  const font = template?.font ?? 'serif';
  const color = template?.textColor ?? '#1f2a26';
  const recipientTrimmed = (fields.recipient ?? '').trim();
  const senderTrimmed = (fields.sender ?? '').trim();
  const dateTrimmed = (fields.date ?? '').trim();

  const next = [...layers];

  // 1. 받는 분
  const recIdx = next.findIndex((l) => l.id === 'role-recipient');
  if (recipientTrimmed) {
    if (recIdx >= 0) {
      next[recIdx] = { ...next[recIdx], text: recipientTrimmed } as EditorLayer;
    } else {
      next.push({
        id: 'role-recipient',
        type: 'text',
        text: recipientTrimmed,
        x: 500,
        y: 250,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        font,
        fontSize: 44,
        color,
        stroke: null,
        shadow: false,
      });
    }
  } else if (recIdx >= 0) {
    next.splice(recIdx, 1);
  }

  // 2. 보내는 사람 (고객 입력 그대로 반영)
  const senderIdx = next.findIndex((l) => l.id === 'role-sender');
  if (senderTrimmed) {
    if (senderIdx >= 0) {
      next[senderIdx] = { ...next[senderIdx], text: senderTrimmed } as EditorLayer;
    } else {
      next.push({
        id: 'role-sender',
        type: 'text',
        text: senderTrimmed,
        x: 500,
        y: dateTrimmed ? 670 : 710,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        font,
        fontSize: 44,
        color,
        stroke: null,
        shadow: false,
      });
    }
  } else if (senderIdx >= 0) {
    next.splice(senderIdx, 1);
  }

  // 3. 날짜
  const dateIdx = next.findIndex((l) => l.id === 'role-date');
  if (dateTrimmed) {
    if (dateIdx >= 0) {
      next[dateIdx] = { ...next[dateIdx], text: dateTrimmed } as EditorLayer;
    } else {
      next.push({
        id: 'role-date',
        type: 'text',
        text: dateTrimmed,
        x: 500,
        y: 780,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        font,
        fontSize: 38,
        color,
        stroke: null,
        shadow: false,
      });
    }
  } else if (dateIdx >= 0) {
    next.splice(dateIdx, 1);
  }

  return next;
}

/**
 * 메인 문구를 캔버스 레이어에 동기화합니다.
 */
export function syncMainTextToLayers(
  layers: EditorLayer[],
  mainText: string,
  template?: { font?: FontId; textColor?: string },
): EditorLayer[] {
  const font = template?.font ?? 'serif';
  const color = template?.textColor ?? '#1f2a26';
  const trimmed = (mainText ?? '').trim();

  const mainIdx = layers.findIndex((l) => l.id === 'role-main');
  if (trimmed) {
    if (mainIdx >= 0) {
      return layers.map((l, i) => (i === mainIdx ? { ...l, text: mainText } : l));
    }
    const newL = {
      id: 'role-main',
      type: 'text' as const,
      text: mainText,
      x: 500,
      y: 470,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font,
      fontSize: 64,
      color,
      stroke: null,
      shadow: false,
    };
    return [...layers, newL];
  } else {
    if (mainIdx >= 0) {
      return layers.filter((l) => l.id !== 'role-main');
    }
    return layers;
  }
}

/**
 * 이미지 선택 시 레이어 상태 변환을 처리합니다.
 * 요구사항: 이미지를 선택하거나 제거해도 문구가 사라지지 않고, 문구를 삭제하거나 수정해도 이미지가 사라지지 않아야 합니다.
 * 따라서 메인 문구(role-main)를 포함한 모든 텍스트 레이어는 이미지 선택 시 온전히 보존됩니다.
 */
export function applyImageSelectionToLayers(
  layers: EditorLayer[],
  newImageLayer: EditorLayer,
  _options?: { hasChosenImage?: boolean; autoTextEdited?: boolean },
): { nextLayers: EditorLayer[]; shouldClearMainText: boolean } {
  const filtered = layers.filter((l) => l.type !== 'image');
  return {
    nextLayers: [newImageLayer, ...filtered],
    shouldClearMainText: false,
  };
}

/**
 * 레이어에서 이미지만 안전하게 제거합니다. 모든 텍스트 레이어는 보존됩니다.
 */
export function removeImageFromLayers(layers: EditorLayer[]): EditorLayer[] {
  return layers.filter((l) => l.type !== 'image');
}

export type DraftFormatType = 'v2' | 'legacy_confirmed' | 'ambiguous';

const KNOWN_LEGACY_PRESET_TEXTS = new Set([
  '보내주신 위로에\n깊이 감사드립니다',
  '저희의 새 출발을\n축복해 주셔서 감사합니다',
  '소중한 자리를 함께해 주셔서\n감사합니다',
  '보내주신 축하에\n감사의 마음을 전합니다',
  '보내주신 응원에\n감사드립니다',
  '새로운 시작을 함께해 주셔서\n감사합니다',
  '생일을 축하해 주셔서\n고맙습니다',
  '감사의 마음을\n전합니다',
  '삼가 위로의 마음을\n전합니다',
  '늘 건강하시고\n평안하세요',
  '소중한 시작을\n축하드립니다',
  '보내주신 위로에 깊이 감사드립니다',
  '함께해 주셔서\n감사합니다',
  '함께해 주셔서 감사합니다',
  '마음 깊이\n감사드립니다',
  '마음 깊이 감사드립니다',
  '고맙습니다',
  '축복해 주셔서\n감사합니다',
  '축복해 주셔서 감사합니다',
]);

/**
 * 초안의 형식을 3단계로 엄밀하게 분류합니다.
 * 1. 'v2': 신규 3단계 초안 (version: 2 이상이거나 role-* 역할 레이어가 명시된 경우)
 * 2. 'legacy_confirmed': 이전 형식임이 확실한 초안 (레거시 자리표시자 {받는분} 등이 포함되거나 ONDAP의 기존 고유 프리셋 문구와 일치)
 * 3. 'ambiguous': 버전과 역할 정보가 없어 신규인지 이전인지 확정할 수 없는 초안 (사용자 커스텀 텍스트 보존 대상)
 */
export function classifyDraftFormat(draft: {
  version?: number;
  layers?: EditorLayer[];
  fields?: { recipient?: string; sender?: string; date?: string };
}): DraftFormatType {
  // 1. version이 2 이상이거나 role-* 역할 레이어가 하나라도 존재하면 명백한 v2 신규 초안
  if (draft.version === 2 || draft.layers?.some((l) => typeof l.id === 'string' && l.id.startsWith('role-'))) {
    return 'v2';
  }

  const textLayers = (draft.layers ?? []).filter((l): l is TextLayer => l.type === 'text');
  if (textLayers.length === 0) {
    return 'v2'; // 텍스트 레이어가 없으면 임의 치환할 대상도 없으므로 안전하게 v2로 처리
  }

  // 2. 레거시 자리표시자({받는분}, {보내는분}, {날짜}) 포함 여부
  const hasLegacyPlaceholder = textLayers.length === 1 && /\{(?:받는분|보내는분|날짜)\}/.test(textLayers[0].text);
  // 3. ONDAP의 기존 고유 프리셋 문구와 일치 여부 (단일 텍스트 레이어)
  const matchesKnownPreset = textLayers.length === 1 && KNOWN_LEGACY_PRESET_TEXTS.has(textLayers[0].text.trim());

  if (hasLegacyPlaceholder || matchesKnownPreset) {
    return 'legacy_confirmed';
  }

  // 4. 그 외: 역할이나 버전 정보가 없어 형식을 확정할 수 없는 초안 (ambiguous)
  return 'ambiguous';
}

/**
 * 복원된 레이어 목록에서 메인 문구를 추출합니다.
 * - role-main 레이어가 있으면 해당 문구를 반환합니다.
 * - 신규 초안('v2') 또는 확정 불가 초안('ambiguous')에서는 role-main이 없다면 메인 문구를 비운 것으로 취급하여 빈 문자열을 반환합니다.
 * - 이전 형식으로 확실히 식별된 초안('legacy_confirmed')일 때만 첫 번째 텍스트를 메인 문구로 간주합니다.
 */
export function extractMainTextFromLayers(layers: EditorLayer[], format?: DraftFormatType | boolean): string {
  const mainL = layers.find((l) => l.id === 'role-main');
  if (mainL && mainL.type === 'text') {
    return mainL.text;
  }

  if (format === 'legacy_confirmed' || format === true) {
    const firstText = layers.find((l) => l.type === 'text');
    return firstText?.text ?? '';
  }

  return '';
}

/**
 * 인쇄 대상 레이어 중 이름/날짜 항목이 포함되어 있는지 확인합니다.
 */
export function isNamesUsedInLayers(layers: EditorLayer[]): boolean {
  return layers.some(
    (l) =>
      l.type === 'text' &&
      ['role-recipient', 'role-sender', 'role-date'].includes(l.id) &&
      Boolean((l as any).text?.trim()),
  );
}

export interface StickerTemplate {
  id: string;
  name: string;
  tag: string;
  description: string;
  background: string;
  shape: StickerShape;
  sizeCm: StickerSizeCm;
  mainText: string;
  defaultSenderSuffix: string;
  font: FontId;
  textColor: string;
  stroke?: string | null;
  shadow?: boolean;
  imageUrl?: string;
  layout?: 'text_only' | 'image_top' | 'image_bg';
  createLayers: (params?: {
    mainText?: string;
    fields?: { recipient: string; sender: string; date: string };
    hasCustomImage?: boolean;
  }) => EditorLayer[];
}

interface TemplateConfig {
  event: DesignCategory | null;
  purpose: GiftPurpose;
  relation?: string | null;
  images?: DesignImage[];
}

// 템플릿 레이어 생성 헬퍼
function makeLayers(options: {
  imageUrl?: string;
  mainText: string;
  defaultSenderSuffix: string;
  font: FontId;
  textColor: string;
  stroke?: string | null;
  shadow?: boolean;
  layout?: 'text_only' | 'image_top' | 'image_bg';
  fields?: { recipient: string; sender: string; date: string };
}): EditorLayer[] {
  const {
    imageUrl,
    mainText,
    defaultSenderSuffix,
    font,
    textColor,
    stroke = null,
    shadow = false,
    layout = 'text_only',
    fields = { recipient: '', sender: '', date: '' },
  } = options;

  const layers: EditorLayer[] = [];

  // 1. 이미지 레이어 (모티프형 또는 배경형)
  if (imageUrl) {
    const isTop = layout === 'image_top';
    const imgLayer: EditorImageLayer = {
      id: 'template-image',
      type: 'image',
      src: imageUrl,
      x: 500,
      y: isTop ? 320 : 500,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: isTop ? 380 : 1000,
      height: isTop ? 380 : 1000,
    };
    layers.push(imgLayer);
  }

  // 필드 입력 여부 확인
  const hasRecipient = Boolean(fields.recipient?.trim());
  const formattedSender = (fields.sender ?? '').trim();
  const hasSender = Boolean(formattedSender);
  const hasDate = Boolean(fields.date?.trim());

  // 2. 받는 분 레이어 (입력값이 있을 때만 상단에 생성)
  if (hasRecipient) {
    layers.push({
      id: 'role-recipient',
      type: 'text',
      text: fields.recipient.trim(),
      x: 500,
      y: layout === 'image_top' ? 180 : 250,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font,
      fontSize: 44,
      color: textColor,
      stroke,
      shadow,
    });
  }

  // 3. 메인 문구 레이어 (가운데 정렬)
  if (mainText?.trim()) {
    let mainY = 470;
    let mainSize = 64;

    if (layout === 'image_top') {
      mainY = hasDate ? 570 : 590;
      mainSize = 52;
    } else if (layout === 'image_bg') {
      mainY = hasRecipient ? 450 : 470;
      mainSize = 64;
    } else {
      // text_only
      if (hasRecipient && (hasSender || hasDate)) {
        mainY = 440;
        mainSize = 58;
      } else if (!hasRecipient && !hasSender && !hasDate) {
        mainY = 500;
        mainSize = 72;
      } else if (!hasRecipient) {
        mainY = 460;
        mainSize = 64;
      }
    }

    layers.push({
      id: 'role-main',
      type: 'text',
      text: mainText,
      x: 500,
      y: mainY,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font,
      fontSize: mainSize,
      color: textColor,
      stroke,
      shadow,
    });
  }

  // 4. 보내는 분 레이어 (입력값이 있을 때만 생성)
  if (hasSender) {
    let senderY = 710;
    if (layout === 'image_top') {
      senderY = hasDate ? 720 : 740;
    } else if (hasDate) {
      senderY = 670;
    }

    layers.push({
      id: 'role-sender',
      type: 'text',
      text: formattedSender,
      x: 500,
      y: senderY,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font,
      fontSize: 44,
      color: textColor,
      stroke,
      shadow,
    });
  }

  // 5. 날짜 레이어 (입력값이 있을 때만 하단에 생성)
  if (hasDate) {
    layers.push({
      id: 'role-date',
      type: 'text',
      text: fields.date.trim(),
      x: 500,
      y: layout === 'image_top' ? 810 : 780,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font,
      fontSize: 38,
      color: textColor,
      stroke,
      shadow,
    });
  }

  return layers;
}

export function getEventTemplates(config: TemplateConfig): StickerTemplate[] {
  const { event, purpose, relation, images = [] } = config;

  // 행사에 매칭되는 스티커 모티프 이미지 탐색
  const eventImg = images.find((i) => i.category === event && i.active) ?? images.find((i) => i.category === 'common' && i.active);

  // 관계별 기본 끝인사 어미
  const defaultSuffix =
    relation === 'senior' ? '올림' :
    relation === 'business' ? '배상' :
    relation === 'family' ? '드림' : '올림';

  switch (event) {
    case 'wedding':
      if (purpose === 'return') {
        // [결혼 감사 답례]: 신랑·신부가 하객 분들께 드리는 인사
        return [
          {
            id: 'wedding-return-classic',
            name: '단아한 명조 서식',
            tag: '명조체',
            description: '단아한 명조 서체로 하객 분들께 정중한 감사의 뜻을 전하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '저희 두 사람의 새로운 출발을\n축복해 주셔서 진심으로 감사드립니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'wedding-return-art',
            name: '전통 모티프 서식',
            tag: '모티프 일러스트',
            description: '웨딩 축복 모티프 일러스트와 함께 정갈한 감사 문구',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '소중한 걸음으로 축복해 주신 은혜\n마음 깊이 간직하겠습니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#2f5a4b',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'wedding-return-warm',
            name: '감성 손글씨 서식',
            tag: '손글씨체',
            description: '정겨운 손글씨 서체로 진심 어린 감사를 전하는 서식',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '새로운 시작을 함께해 주셔서\n참 고맙습니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'wedding-return-modern',
            name: '간결한 고딕 사각',
            tag: '고딕 사각',
            description: '사각 스티커에 간결하고 세련되게 정돈된 서식',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '소중한 날 함께해 주신 분들께\n마음 다해 감사드립니다',
            defaultSenderSuffix: '올림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        // [결혼 축하 선물]: 하객·친구·동료가 신랑·신부에게 보내는 축하
        return [
          {
            id: 'wedding-celeb-classic',
            name: '단아한 축하 서식',
            tag: '명조체',
            description: '두 사람의 새 출발을 축하하며 행복을 기원하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '두 분의 소중한 새 출발을 축하하며\n앞날에 행복이 가득하기를 기원합니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'wedding-celeb-motif',
            name: '축복 모티프 서식',
            tag: '모티프 일러스트',
            description: '화사한 축복 일러스트와 함께 전하는 축하 선물',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '세상에서 가장 아름다운 두 분의\n결혼을 진심으로 축하드립니다',
            defaultSenderSuffix: '드림',
            font: 'serif',
            textColor: '#2f5a4b',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'wedding-celeb-warm',
            name: '감성 축복 손글씨',
            tag: '손글씨체',
            description: '다정하고 따뜻한 손글씨로 전하는 결혼 축하',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '서로를 아끼고 사랑하며\n언제나 꽃길만 걸으세요',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'wedding-celeb-modern',
            name: '간결한 고딕 사각',
            tag: '고딕 사각',
            description: '단정한 사각 스티커에 전하는 정갈한 축하 인사',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '결혼을 진심으로 축하드립니다\n행복한 가정 이루시길 바랍니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }

    case 'funeral':
      if (purpose === 'return') {
        // [장례 감사 답례]: 유가족·상주가 조문객에게 드리는 감사
        return [
          {
            id: 'funeral-return-formal',
            name: '삼가 감사의 말씀',
            tag: '명조체',
            description: '따뜻한 위로에 머리 숙여 깊은 감사의 뜻을 전하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '보내주신 따뜻한 위로와 격려에\n머리 숙여 깊이 감사드립니다',
            defaultSenderSuffix: '배상',
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'funeral-return-sincere',
            name: '정중한 조문 답례',
            tag: '바탕체',
            description: '바쁘신 중 찾아주신 분들께 온전한 감사를 표하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '바쁘신 중에도 찾아주시고 베풀어 주신\n은혜를 잊지 않고 보답하겠습니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'funeral-return-comfort',
            name: '온정 보답 서식',
            tag: '사각 서식',
            description: '슬픔을 함께 나누어 주신 분들께 전하는 정갈한 인사',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '슬픔을 함께 나누어 주셔서\n큰 위로와 힘이 되었습니다',
            defaultSenderSuffix: '배상',
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'funeral-return-simple',
            name: '간결한 조문 감사',
            tag: '고딕 서식',
            description: '군더더기 없이 진심만을 담은 간결한 감사 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '삼가 감사의 마음을 전하며\n귀댁의 평안과 건강을 기원합니다',
            defaultSenderSuffix: '올림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        // [장례 위로 선물]: 조문객·지인이 유가족께 보내는 위로 선물
        return [
          {
            id: 'funeral-comfort-formal',
            name: '삼가 조의의 말씀',
            tag: '명조체',
            description: '고인의 명복을 빌며 유가족께 깊은 위로를 전하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '삼가 고인의 명복을 빌며\n깊은 애도와 위로의 마음을 전합니다',
            defaultSenderSuffix: '배상',
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'funeral-comfort-warm',
            name: '따뜻한 위로 서식',
            tag: '바탕체',
            description: '슬픔에 잠긴 유가족을 위로하는 정중한 인사말',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '어떠한 위로의 말씀으로도 부족하겠지만\n부디 슬픔을 잘 추스르시길 빕니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'funeral-comfort-square',
            name: '깊은 애도 사각',
            tag: '사각 서식',
            description: '단정한 사각 스티커에 전하는 삼가 조의',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '뜻밖의 비보에 깊은 슬픔을 전하며\n삼가 고인의 영면을 기원합니다',
            defaultSenderSuffix: '배상',
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'funeral-comfort-simple',
            name: '간결한 위로 서식',
            tag: '고딕 서식',
            description: '단정하고 정갈하게 전하는 위로의 마음',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '고인의 명복을 진심으로 기원하며\n가족분들께 깊은 위로를 전합니다',
            defaultSenderSuffix: '올림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }

    case 'birth':
      if (purpose === 'return') {
        // [출산·돌 감사 답례]: 부모가 축하객 분들께 드리는 인사
        return [
          {
            id: 'birth-return-warm',
            name: '첫걸음 감사 서식',
            tag: '손글씨체',
            description: '아기의 첫 출발을 축하해 주신 분들께 드리는 정겨운 인사',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '저희 아이의 첫걸음을 축복해 주셔서\n진심으로 감사드립니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birth-return-formal',
            name: '정중한 감사 서식',
            tag: '명조체',
            description: '축복해 주신 소중한 분들께 정중하게 전하는 답례',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '따뜻한 사랑으로 축복해 주신 은혜에\n감사하며 바르고 건강하게 키우겠습니다',
            defaultSenderSuffix: '가족 올림',
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birth-return-baby',
            name: '아기 첫 인사 서식',
            tag: '화사한 스타일',
            description: '아기의 첫 인사를 산뜻하고 귀엽게 전하는 템플릿',
            background: '#f7e6e1',
            shape: 'circle',
            sizeCm: 6,
            mainText: '건강하고 밝게 자라겠습니다\n축하해 주셔서 고맙습니다',
            defaultSenderSuffix: '올림',
            font: 'sans',
            textColor: '#b5523b',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        // [출산 축하 선물]: 지인이 아기/산모에게 전하는 축하 선물
        return [
          {
            id: 'birth-celeb-formal',
            name: '출산 축하 서식',
            tag: '명조체',
            description: '예쁜 아기의 탄생을 축하하며 건강과 행복을 기원하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '예쁜 아기의 탄생을 진심으로 축하하며\n산모와 아기의 건강과 행복을 기원합니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birth-celeb-warm',
            name: '따뜻한 축복 손글씨',
            tag: '손글씨체',
            description: '천사 같은 아기에게 보내는 다정한 사랑의 축복',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '천사 같은 아기의 탄생을 축하해요\n사랑이 넘치는 가정 되길 바랍니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birth-celeb-modern',
            name: '온 가족 축복 사각',
            tag: '고딕 사각',
            description: '단정한 사각 스티커에 전하는 밝고 건강한 축하',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '새 가족을 맞이한 기쁨을 축하하며\n아기의 앞날에 축복만 가득하길 빕니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }

    case 'longevity':
      if (purpose === 'return') {
        // [회갑·칠순 감사 답례]: 어르신/가족이 축하객 분들께 드리는 인사
        return [
          {
            id: 'longevity-return-formal',
            name: '기품 있는 감사 서식',
            tag: '명조체',
            description: '회갑·칠순 자리를 빛내주신 분들께 드리는 격조 높은 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '뜻깊은 자리를 함께 빛내주셔서\n진심으로 감사드립니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'longevity-return-motif',
            name: '전통 장수 모티프',
            tag: '모티프 일러스트',
            description: '전통 장수 모티프 그림과 정갈한 감사 문구',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '소중한 날 함께해 주신 정성에\n머리 숙여 깊이 감사드립니다',
            defaultSenderSuffix: '배상',
            font: 'serif',
            textColor: '#8a6a35',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'longevity-return-peace',
            name: '평안 기원 서식',
            tag: '바탕체',
            description: '가정의 평안을 비는 따뜻하고 정중한 인사말',
            background: '#e3ede7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '보내주신 축하와 사랑에 감사드리며\n가정에 평안이 가득하시길 기원합니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#1f4436',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'longevity-return-modern',
            name: '간결한 감사 사각',
            tag: '고딕 사각',
            description: '사각 프레임에 정돈된 서체로 전하는 정갈한 인사',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '베풀어 주신 은혜에 감사드립니다\n늘 건강하시고 행복하세요',
            defaultSenderSuffix: '드림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        // [회갑·칠순 축하 선물]: 자녀·후배·지인이 어르신께 드리는 선물
        return [
          {
            id: 'longevity-celeb-formal',
            name: '기품 있는 생신 축하',
            tag: '명조체',
            description: '뜻깊은 생신을 축하하며 강녕과 평안을 비는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '뜻깊은 생신을 진심으로 축하드리오며\n늘 강녕하시고 평안하시기를 기원합니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'longevity-celeb-motif',
            name: '만수무강 기원 모티프',
            tag: '모티프 일러스트',
            description: '전통 장수 모티프와 함께 드리는 정성스런 축하',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '어르신의 만수무강을 마음 깊이 기원하며\n생신을 진심으로 축하드립니다',
            defaultSenderSuffix: '배상',
            font: 'serif',
            textColor: '#8a6a35',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'longevity-celeb-warm',
            name: '사랑과 공경 손글씨',
            tag: '손글씨체',
            description: '베풀어 주신 은혜에 감사하며 장수를 기원하는 서식',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '언제나 베풀어 주시는 사랑에 감사드리며\n오래오래 건강하고 행복하세요',
            defaultSenderSuffix: '올림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'longevity-celeb-modern',
            name: '간결한 축하 사각',
            tag: '고딕 사각',
            description: '단정한 사각 스티커에 전하는 정갈한 생신 축하',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '생신을 축하드리며 항상 건강과 웃음이\n가득하시기를 진심으로 소망합니다',
            defaultSenderSuffix: '드림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }

    case 'promotion':
    case 'opening':
      if (purpose === 'return') {
        return [
          {
            id: 'business-return-classic',
            name: '정중한 성원 감사',
            tag: '명조체',
            description: '새 출발을 응원해 주신 분들께 드리는 공식 답례 인사',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: event === 'promotion'
              ? '따뜻한 축하와 성원에 감사드리며\n새로운 자리에서 더욱 정진하겠습니다'
              : '새로운 시작을 함께 축하해 주셔서\n진심으로 감사드립니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'business-return-modern',
            name: '신뢰와 감사의 사각',
            tag: '고딕 사각',
            description: '단정한 사각 스티커에 전하는 신뢰감 있는 메시지',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '보내주신 성원에 힘입어\n최선을 다해 보답하겠습니다',
            defaultSenderSuffix: '드림',
            font: 'sans',
            textColor: '#1f4436',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'business-return-warm',
            name: '온정과 감사 서식',
            tag: '바탕체',
            description: '따뜻한 바탕색 위에 전하는 진솔한 감사 문구',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '귀한 발걸음과 따뜻한 마음에\n깊은 감사를 전합니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        return [
          {
            id: 'business-celeb-classic',
            name: '영광스러운 축하 서식',
            tag: '명조체',
            description: '승진·개업의 기쁨을 축하하며 발전을 기원하는 서식',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: event === 'promotion'
              ? '영광스러운 승진을 진심으로 축하하며\n앞날에 무궁한 발전이 있기를 기원합니다'
              : '새로운 시작과 개업을 진심으로 축하하며\n날마다 번창하시기를 기원합니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'business-celeb-modern',
            name: '도약과 번창 사각',
            tag: '고딕 사각',
            description: '사각 스티커에 전하는 정갈하고 힘찬 응원',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '새로운 도약을 진심으로 축하하며\n더 큰 결실과 성공이 함께하길 빕니다',
            defaultSenderSuffix: '드림',
            font: 'sans',
            textColor: '#1f4436',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'business-celeb-warm',
            name: '온정과 성원 서식',
            tag: '바탕체',
            description: '따뜻한 마음으로 전하는 축하 선물 서식',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '뜻깊은 출발을 축하드리오며\n앞날에 늘 행운과 번영이 가득하길 바랍니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }

    case 'birthday':
      if (purpose === 'return') {
        return [
          {
            id: 'birthday-return-warm',
            name: '생일 축하 감사',
            tag: '손글씨체',
            description: '생일을 축하해 주신 고마운 분들께 드리는 정겨운 답례',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '생일을 축하해 주신 따뜻한 마음에\n진심으로 감사드립니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birthday-return-motif',
            name: '축하 일러스트 서식',
            tag: '모티프 일러스트',
            description: '생일 모티프 그림과 함께 화사하게 전하는 인사',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '소중한 마음 전해주셔서\n정말 감사드립니다',
            defaultSenderSuffix: '올림',
            font: 'serif',
            textColor: '#2f5a4b',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birthday-return-clean',
            name: '깔끔한 모던 사각',
            tag: '고딕 사각',
            description: '심플하고 정돈된 폰트로 깔끔하게',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '함께 축하해 주셔서 감사합니다\n기쁨 가득한 하루 되세요',
            defaultSenderSuffix: '드림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        return [
          {
            id: 'birthday-celeb-warm',
            name: '생일 축하 손글씨',
            tag: '손글씨체',
            description: '소중한 분의 생일을 축하하며 전하는 따뜻한 메시지',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '생일을 진심으로 축하하며\n기쁨과 행복이 가득한 한 해가 되길 바랍니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birthday-celeb-motif',
            name: '축하 일러스트 서식',
            tag: '모티프 일러스트',
            description: '생일 모티프와 함께 드리는 화사한 축하 선물',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '세상에서 가장 특별한 날\n기쁨 가득한 생일 보내세요',
            defaultSenderSuffix: '드림',
            font: 'serif',
            textColor: '#2f5a4b',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'birthday-celeb-clean',
            name: '깔끔한 모던 사각',
            tag: '고딕 사각',
            description: '단정한 사각 스티커에 전하는 생일 축하',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '생신을 진심으로 축하드립니다\n늘 건강하시고 행복하세요',
            defaultSenderSuffix: defaultSuffix,
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }

    case 'thanks':
    default:
      if (purpose === 'return') {
        return [
          {
            id: 'common-return-classic',
            name: '정중한 감사 명조',
            tag: '명조체',
            description: '소중한 분께 마음을 담아 정중하게 전하는 감사 인사',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '소중한 인연에 감사드리며\n따뜻한 마음을 담아 전합니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'common-return-motif',
            name: '전통 명절 모티프',
            tag: '모티프 일러스트',
            description: '단아한 전통 모티프와 함께 드리는 품격 있는 인사',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '풍성하고 따뜻한 마음을 담아\n건강과 행복을 기원합니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#8a6a35',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'common-return-warm',
            name: '따뜻한 손글씨 서식',
            tag: '손글씨체',
            description: '정성스런 손글씨로 전하는 따뜻하고 정겨운 마음',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '항상 베풀어 주시는 사랑과 온정에\n깊이 감사드립니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'common-return-modern',
            name: '모던 심플 사각',
            tag: '고딕 사각',
            description: '단정하고 심플한 사각 스티커로 정갈한 감사',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '함께해 주신 마음에 감사드립니다\n늘 평안하시길 빕니다',
            defaultSenderSuffix: '올림',
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      } else {
        return [
          {
            id: 'common-celeb-classic',
            name: '정성 어린 축하 명조',
            tag: '명조체',
            description: '건강과 평안을 빌며 정성스럽게 전하는 축하 선물',
            background: '#ffffff',
            shape: 'circle',
            sizeCm: 6,
            mainText: '건강과 행복을 기원하며\n정성 어린 마음을 전합니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'serif',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'common-celeb-motif',
            name: '전통 축복 모티프',
            tag: '모티프 일러스트',
            description: '품격 있는 모티프와 함께 전하는 따뜻한 선물',
            background: '#f6edd8',
            shape: 'circle',
            sizeCm: 6,
            mainText: '가정에 언제나 평안과 기쁨이\n가득하시기를 진심으로 기원합니다',
            defaultSenderSuffix: '올림',
            font: 'batang',
            textColor: '#8a6a35',
            imageUrl: eventImg?.imageUrl,
            layout: eventImg ? 'image_top' : 'text_only',
            createLayers(params) {
              return makeLayers({
                imageUrl: this.imageUrl,
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'common-celeb-warm',
            name: '따뜻한 온정 손글씨',
            tag: '손글씨체',
            description: '다정하고 따뜻한 손글씨로 전하는 선물',
            background: '#fdfbf7',
            shape: 'circle',
            sizeCm: 6,
            mainText: '기쁜 날 함께 축하드리며\n행복이 가득하시길 소망합니다',
            defaultSenderSuffix: '드림',
            font: 'pen',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
          {
            id: 'common-celeb-modern',
            name: '모던 심플 사각',
            tag: '고딕 사각',
            description: '단정한 사각 스티커에 전하는 정갈한 축하',
            background: '#ffffff',
            shape: 'square',
            sizeCm: 6,
            mainText: '소중한 날을 진심으로 축하드리며\n언제나 좋은 일만 가득하시길 바랍니다',
            defaultSenderSuffix: defaultSuffix,
            font: 'sans',
            textColor: '#1f2a26',
            layout: 'text_only',
            createLayers(params) {
              return makeLayers({
                mainText: params?.mainText ?? this.mainText,
                defaultSenderSuffix: this.defaultSenderSuffix,
                font: this.font,
                textColor: this.textColor,
                layout: this.layout,
                fields: params?.fields,
              });
            },
          },
        ];
      }
  }
}
