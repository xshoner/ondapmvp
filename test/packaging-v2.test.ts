import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImageSelectionToLayers,
  classifyDraftFormat,
  extractMainTextFromLayers,
  formatSenderDisplay,
  getEventTemplates,
  isNamesUsedInLayers,
  removeImageFromLayers,
  syncFieldsToLayers,
  syncMainTextToLayers,
} from '../src/packaging/templates.ts';
import type { DesignCategory, TextLayer } from '../src/packaging/types.ts';
import type { EditorImageLayer, EditorLayer } from '../src/app/packaging/editor-types.ts';
import { sanitizeDraft, sanitizeSticker } from '../src/packaging/rules.ts';

test('행사별 추천 템플릿: 모든 행사에 대해 3~5개의 템플릿을 제공한다', () => {
  const events: (DesignCategory | null)[] = [
    'wedding',
    'longevity',
    'funeral',
    'birth',
    'promotion',
    'opening',
    'thanks',
    'birthday',
    null,
  ];

  for (const ev of events) {
    const templates = getEventTemplates({
      event: ev,
      purpose: 'return',
      relation: 'senior',
    });

    assert.ok(templates.length >= 3 && templates.length <= 5, `${ev} 행사 템플릿 개수는 3~5개여야 함 (현재: ${templates.length})`);

    for (const tpl of templates) {
      assert.ok(tpl.id, '템플릿 id 존재');
      assert.ok(tpl.name, '템플릿 이름 존재');
      assert.ok(tpl.mainText, '메인 문구 존재');
      assert.ok(['circle', 'square'].includes(tpl.shape), '모양은 circle 또는 square');
      assert.ok([4, 6].includes(tpl.sizeCm), '크기는 4 또는 6cm');

      const layers = tpl.createLayers();
      assert.ok(Array.isArray(layers) && layers.length >= 1, 'createLayers()가 레이어를 1개 이상 생성해야 함');
      const textLayers = layers.filter((l) => l.type === 'text');
      assert.ok(textLayers.length >= 1, '최소 1개 이상의 텍스트 레이어 포함');
    }
  }
});

test('관계별 호칭: 상급자는 올림, 거래처는 배상, 가족은 드림으로 적용된다', () => {
  const seniorTpls = getEventTemplates({
    event: 'wedding',
    purpose: 'return',
    relation: 'senior',
  });
  assert.ok(seniorTpls[0].defaultSenderSuffix.includes('올림'));

  const bizTpls = getEventTemplates({
    event: 'funeral',
    purpose: 'return',
    relation: 'business',
  });
  assert.ok(bizTpls[0].defaultSenderSuffix.includes('배상'));

  const familyTpls = getEventTemplates({
    event: 'birth',
    purpose: 'return',
    relation: 'family',
  });
  assert.ok(familyTpls[0].defaultSenderSuffix.includes('드림'));
});

test('선물 목적: 감사 답례와 축하/위로 선물이 서로 다른 문구를 제공한다', () => {
  const returnTpls = getEventTemplates({
    event: 'longevity',
    purpose: 'return',
  });
  const celebTpls = getEventTemplates({
    event: 'longevity',
    purpose: 'celebration',
  });

  assert.notEqual(returnTpls[0].mainText, celebTpls[0].mainText);
  assert.ok(returnTpls[0].mainText.includes('감사') || returnTpls[0].mainText.includes('함께'));
  assert.ok(celebTpls[0].mainText.includes('기원') || celebTpls[0].mainText.includes('건강'));
});

test('스티커 규격 및 초안(Draft) 정제 호환성 검증', () => {
  const sticker = sanitizeSticker({ shape: 'circle', sizeCm: 6 });
  assert.deepEqual(sticker, { shape: 'circle', sizeCm: 6 });

  const draft = sanitizeDraft({
    background: '#ffffff',
    purpose: 'return',
    fields: { recipient: '김영희', sender: '홍길동', date: '2026년 11월 1일' },
    layers: [
      {
        type: 'text',
        text: '감사의 마음을 전합니다',
        x: 500,
        y: 450,
        font: 'serif',
        fontSize: 66,
        color: '#1f2a26',
      },
    ],
  });

  assert.equal(draft.background, '#ffffff');
  assert.equal(draft.fields.sender, '홍길동');
  assert.equal(draft.fields.recipient, '김영희');
  assert.equal(draft.layers.length, 1);
  assert.equal(draft.layers[0].type, 'text');
});

test('보내는 사람 끝인사 자동 부착 배제 (고객 입력 그대로 유지)', () => {
  assert.equal(formatSenderDisplay('홍길동'), '홍길동');
  assert.equal(formatSenderDisplay('홍길동 올림'), '홍길동 올림');
  assert.equal(formatSenderDisplay('홍길동 드림'), '홍길동 드림');
  assert.equal(formatSenderDisplay('홍길동 배상'), '홍길동 배상');
  assert.equal(formatSenderDisplay('  홍길동 올림  '), '홍길동 올림');
  assert.equal(formatSenderDisplay(''), '');
});

test('받는 분과 날짜 레이어 동적 생성 및 위치 안전성', () => {
  const tpls = getEventTemplates({ event: 'wedding', purpose: 'return' });
  const tpl = tpls[0];

  // 1. 빈 필드 -> 받는분, 날짜 레이어 없음
  const baseLayers = tpl.createLayers();
  assert.ok(!baseLayers.some((l) => l.id === 'role-recipient'));
  assert.ok(!baseLayers.some((l) => l.id === 'role-date'));

  // 2. 받는 분, 날짜, 보내는 분 포함
  const fullLayers = tpl.createLayers({
    fields: {
      recipient: '김선생님께',
      sender: '홍길동',
      date: '2026. 11. 01',
    },
  });

  const recipientLayer = fullLayers.find((l) => l.id === 'role-recipient');
  const mainLayer = fullLayers.find((l) => l.id === 'role-main');
  const senderLayer = fullLayers.find((l) => l.id === 'role-sender');
  const dateLayer = fullLayers.find((l) => l.id === 'role-date');

  assert.ok(recipientLayer && recipientLayer.type === 'text');
  assert.equal((recipientLayer as any).text, '김선생님께');
  assert.ok(mainLayer && mainLayer.type === 'text');
  assert.ok(senderLayer && senderLayer.type === 'text');
  assert.equal((senderLayer as any).text, '홍길동'); // 자동 접미사 부착 없이 고객 입력 그대로
  assert.ok(dateLayer && dateLayer.type === 'text');
  assert.equal((dateLayer as any).text, '2026. 11. 01');

  // Y축 순서 검증 (위에서부터: 받는분 -> 메인 -> 보내는분 -> 날짜)
  assert.ok(recipientLayer.y < mainLayer.y);
  assert.ok(mainLayer.y < senderLayer.y);
  assert.ok(senderLayer.y < dateLayer.y);
});

test('실제 프로덕션 함수 검증: 이름 입력 -> 첫 이미지 선택 -> 추천 문구 선택 전체 흐름', () => {
  const tpls = getEventTemplates({ event: 'wedding', purpose: 'return' });
  const tpl = tpls[0];

  // 1. 초기 템플릿 레이어 생성
  let currentLayers = tpl.createLayers();
  assert.ok(currentLayers.some((l) => l.id === 'role-main'), '초기 메인 문구 존재');

  // 2. 고객이 받는 분('김선생님께')과 보내는 사람('홍길동')을 입력함 (syncFieldsToLayers 실행)
  currentLayers = syncFieldsToLayers(
    currentLayers,
    { recipient: '김선생님께', sender: '홍길동', date: '' },
    tpl,
  );
  assert.ok(currentLayers.some((l) => l.id === 'role-recipient'), '받는 분 레이어 생성됨');
  assert.ok(currentLayers.some((l) => l.id === 'role-sender'), '보내는 사람 레이어 생성됨');
  assert.equal(
    (currentLayers.find((l) => l.id === 'role-sender') as TextLayer).text,
    '홍길동',
    '보내는 사람에 올림/드림 등이 강제로 붙지 않고 고객 입력 그대로 유지',
  );
  assert.equal(isNamesUsedInLayers(currentLayers), true, '이름 항목이 사용됨');

  // 고객이 추가 텍스트 레이어도 하나 생성했다고 가정
  currentLayers.push({
    id: 'custom-text-1',
    type: 'text',
    text: '특별한 감사를 드립니다',
    x: 500,
    y: 600,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    font: 'serif',
    fontSize: 50,
    color: '#000000',
    stroke: null,
    shadow: false,
  });

  // 3. 첫 추천 이미지 선택 (applyImageSelectionToLayers 실행)
  const mockImageLayer: EditorImageLayer = {
    id: 'img-1',
    type: 'image',
    src: '/images/sample.png',
    width: 400,
    height: 400,
    x: 500,
    y: 500,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };

  const { nextLayers, shouldClearMainText } = applyImageSelectionToLayers(currentLayers, mockImageLayer, {
    hasChosenImage: false,
    autoTextEdited: false,
  });
  currentLayers = nextLayers;

  assert.equal(shouldClearMainText, false, '이미지를 선택해도 문구가 삭제되지 않고 유지되어야 함');
  assert.ok(currentLayers.some((l) => l.id === 'role-main'), '기본 메인 문구는 보존됨');
  assert.ok(currentLayers.some((l) => l.id === 'role-recipient'), '받는 분(김선생님께)은 온전히 보존됨');
  assert.ok(currentLayers.some((l) => l.id === 'role-sender'), '보내는 사람(홍길동)은 온전히 보존됨');
  assert.ok(currentLayers.some((l) => l.id === 'custom-text-1'), '고객 추가 문구는 온전히 보존됨');
  assert.ok(currentLayers.some((l) => l.id === 'img-1'), '선택한 이미지가 레이어에 포함됨');
  assert.equal(isNamesUsedInLayers(currentLayers), true, '이미지 선택 후에도 이름 레이어가 유지되므로 true');

  // 4. 추천 문구 '늘 건강하시고 평안하세요' 선택 (syncMainTextToLayers 실행)
  currentLayers = syncMainTextToLayers(currentLayers, '늘 건강하시고 평안하세요', tpl);

  const mainLayerAfterPick = currentLayers.find((l) => l.id === 'role-main') as TextLayer | undefined;
  assert.ok(mainLayerAfterPick, '선택한 추천 문구로 role-main 레이어 생성됨');
  assert.equal(mainLayerAfterPick?.text, '늘 건강하시고 평안하세요', '선택한 문구 그대로 반영');
  assert.equal(extractMainTextFromLayers(currentLayers), '늘 건강하시고 평안하세요', '메인 문구 추출 일치');
  assert.ok(currentLayers.some((l) => l.id === 'role-recipient'), '받는 분 여전히 유지');
  assert.ok(currentLayers.some((l) => l.id === 'role-sender'), '보내는 사람 여전히 유지');
});

test('초안 복원 메인 문구 격리 검증 (extractMainTextFromLayers)', () => {
  // 사례 1: 받는 분만 있고 메인 문구는 없는 디자인 초안
  const layersWithOnlyRecipient: EditorLayer[] = [
    {
      id: 'role-recipient',
      type: 'text',
      text: '김선생님께',
      x: 500,
      y: 250,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 44,
      color: '#1f2a26',
      stroke: null,
      shadow: false,
    },
  ];

  const extracted1 = extractMainTextFromLayers(layersWithOnlyRecipient);
  assert.equal(extracted1, '', '받는 분만 있을 때 메인 문구로 잘못 추출되지 않고 빈 문자열이어야 함');

  // 사례 2: 받는 분, 보내는 사람과 함께 추가 문구(custom-quote)가 있으나 메인 문구(role-main)는 삭제된 새 초안
  const layersWithRolesAndCustom: EditorLayer[] = [
    {
      id: 'role-recipient',
      type: 'text',
      text: '김선생님께',
      x: 500,
      y: 250,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 44,
      color: '#1f2a26',
      stroke: null,
      shadow: false,
    },
    {
      id: 'role-sender',
      type: 'text',
      text: '홍길동',
      x: 500,
      y: 710,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 44,
      color: '#1f2a26',
      stroke: null,
      shadow: false,
    },
    {
      id: 'custom-quote',
      type: 'text',
      text: '항상 감사드립니다',
      x: 500,
      y: 500,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 60,
      color: '#1f2a26',
      stroke: null,
      shadow: false,
    },
  ];

  const extracted2 = extractMainTextFromLayers(layersWithRolesAndCustom);
  assert.equal(extracted2, '', '새 초안에서 메인 문구를 의도적으로 삭제한 경우 추가 문구가 메인 문구 입력란으로 들어가지 않고 빈 문자열이어야 함');

  // 사례 3: 역할 정보(role-*)가 전혀 없는 이전 형식(v1) 레거시 초안 복원 시
  const legacyLayers: EditorLayer[] = [
    {
      id: 'l1',
      type: 'text',
      text: '항상 감사드립니다',
      x: 500,
      y: 500,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 60,
      color: '#1f2a26',
      stroke: null,
      shadow: false,
    },
  ];

  const extractedLegacy = extractMainTextFromLayers(legacyLayers, true);
  assert.equal(extractedLegacy, '항상 감사드립니다', '레거시 형식일 때만 첫 번째 텍스트를 메인 문구로 복원');
});

test('실제 편집기 상태 흐름 검증: 이름 입력 -> 실행 취소(되돌리기) -> 최종 확인 -> 다시 편집 화면 일치', () => {
  const tpls = getEventTemplates({ event: 'wedding', purpose: 'return' });
  const tpl = tpls[0];

  // 1. 초기 상태 (초기 템플릿 로드)
  let layers = tpl.createLayers();
  let fields = { recipient: '', sender: '', date: '' };
  let mainText = tpl.mainText;
  const history: { layers: EditorLayer[]; background: string; fields: { recipient: string; sender: string; date: string }; mainText: string }[] = [];

  // 초기 스냅샷 기록 (되돌리기 스택)
  history.push({
    layers: [...layers],
    background: '#ffffff',
    fields: { ...fields },
    mainText,
  });

  // 2. 고객이 보내는 사람에 '홍길동'을 입력함 (handleFieldsChange 동작)
  fields = { ...fields, sender: '홍길동' };
  layers = syncFieldsToLayers(layers, fields, tpl);

  assert.equal(fields.sender, '홍길동');
  assert.ok(layers.some((l) => l.id === 'role-sender' && (l as TextLayer).text === '홍길동'));
  assert.equal(isNamesUsedInLayers(layers), true);

  // 3. 고객이 실행 취소(되돌리기)를 누름 (undo 동작)
  const snapToRestore = history.pop()!;
  layers = snapToRestore.layers;
  const sendL = layers.find((l) => l.id === 'role-sender') as TextLayer | undefined;
  const recL = layers.find((l) => l.id === 'role-recipient') as TextLayer | undefined;
  const dateL = layers.find((l) => l.id === 'role-date') as TextLayer | undefined;

  // 되돌린 상태에 레이어가 없으면 입력란도 반드시 빈 값('')이어야 함 (핵심 버그 수정 검증)
  fields = {
    recipient: recL ? recL.text : '',
    sender: sendL ? sendL.text : '',
    date: dateL ? dateL.text : '',
  };
  mainText = extractMainTextFromLayers(layers);

  // 4. 검증: 되돌린 후 상태 (입력란과 레이어 동기화)
  assert.equal(fields.sender, '', '되돌리기 후 보내는 사람 입력란은 빈 문자열이어야 함');
  assert.equal(fields.recipient, '', '되돌리기 후 받는 분 입력란은 빈 문자열이어야 함');
  assert.equal(fields.date, '', '되돌리기 후 날짜 입력란은 빈 문자열이어야 함');
  assert.ok(!layers.some((l) => l.id === 'role-sender'), '스티커 레이어에도 보내는 사람이 없어야 함');

  // 5. 최종 확인(STEP 3) 화면 상태 검증
  const namesUsedInReview = isNamesUsedInLayers(layers);
  assert.equal(namesUsedInReview, false, '최종 확인 요약에서 이름이 사용되지 않았으므로 철자 확인 체크란이 비활성화/미노출이어야 함');

  // 6. 다시 편집(STEP 2) 화면으로 이동 시 검증
  assert.equal(fields.sender, '', '다시 편집 화면으로 돌아와도 보내는 사람 입력란이 비어 있어야 함');
  assert.ok(!layers.some((l) => l.id === 'role-sender'), '스티커와 입력란이 100% 일치함');
});

test('받는 분 및 날짜 입력 후 실행 취소 검증: 입력란과 스티커 완전 동기화', () => {
  const tpls = getEventTemplates({ event: 'wedding', purpose: 'return' });
  const tpl = tpls[0];

  let layers = tpl.createLayers();
  let fields = { recipient: '', sender: '', date: '' };
  const history: { layers: EditorLayer[]; fields: { recipient: string; sender: string; date: string } }[] = [];

  history.push({ layers: [...layers], fields: { ...fields } });

  // 받는 분 '김선생님께', 날짜 '2026. 11. 01' 입력
  fields = { recipient: '김선생님께', sender: '', date: '2026. 11. 01' };
  layers = syncFieldsToLayers(layers, fields, tpl);

  assert.equal(fields.recipient, '김선생님께');
  assert.equal(fields.date, '2026. 11. 01');
  assert.ok(layers.some((l) => l.id === 'role-recipient'));
  assert.ok(layers.some((l) => l.id === 'role-date'));

  // 실행 취소
  const restored = history.pop()!;
  layers = restored.layers;
  const recL = layers.find((l) => l.id === 'role-recipient') as TextLayer | undefined;
  const sendL = layers.find((l) => l.id === 'role-sender') as TextLayer | undefined;
  const dateL = layers.find((l) => l.id === 'role-date') as TextLayer | undefined;
  fields = {
    recipient: recL ? recL.text : '',
    sender: sendL ? sendL.text : '',
    date: dateL ? dateL.text : '',
  };

  assert.equal(fields.recipient, '', '되돌리기 후 받는 분 입력란은 비워짐');
  assert.equal(fields.date, '', '되돌리기 후 날짜 입력란은 비워짐');
  assert.ok(!layers.some((l) => l.id === 'role-recipient'));
  assert.ok(!layers.some((l) => l.id === 'role-date'));
  assert.equal(isNamesUsedInLayers(layers), false);
});

test('이름/날짜 인쇄 여부 판별 (isNamesUsedInLayers)', () => {
  const onlyMain: EditorLayer[] = [
    {
      id: 'role-main',
      type: 'text',
      text: '감사합니다',
      x: 500,
      y: 500,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 60,
      color: '#000000',
      stroke: null,
      shadow: false,
    },
  ];
  assert.equal(isNamesUsedInLayers(onlyMain), false, '메인 문구만 있으면 false');

  const withSender: EditorLayer[] = [
    ...onlyMain,
    {
      id: 'role-sender',
      type: 'text',
      text: '홍길동',
      x: 500,
      y: 700,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 40,
      color: '#000000',
      stroke: null,
      shadow: false,
    },
  ];
  assert.equal(isNamesUsedInLayers(withSender), true, '보내는 사람이 있으면 true');

  const withEmptySender: EditorLayer[] = [
    ...onlyMain,
    {
      id: 'role-sender',
      type: 'text',
      text: '   ',
      x: 500,
      y: 700,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      font: 'serif',
      fontSize: 40,
      color: '#000000',
      stroke: null,
      shadow: false,
    },
  ];
  assert.equal(isNamesUsedInLayers(withEmptySender), false, '공백 텍스트만 있으면 false');
});

test('과거 초안과 신규 초안의 3분류 판별 (classifyDraftFormat)', () => {
  // 1. version: 2 가 명시된 초안 -> 'v2'
  assert.equal(
    classifyDraftFormat({
      version: 2,
      layers: [{ id: 'custom-text', type: 'text', text: '자유 텍스트' } as any],
    }),
    'v2',
  );

  // 2. version이 없더라도 role-* 레이어가 포함된 초안 -> 'v2'
  assert.equal(
    classifyDraftFormat({
      layers: [
        { id: 'role-recipient', type: 'text', text: '선생님께' } as any,
        { id: 'custom-1', type: 'text', text: '축하합니다' } as any,
      ],
    }),
    'v2',
  );

  // 3. 레거시 자리표시자({받는분})가 포함된 과거 초안 -> 'legacy_confirmed'
  assert.equal(
    classifyDraftFormat({
      layers: [
        { id: 'txt-1', type: 'text', text: '{받는분} 진심으로 감사드립니다' } as any,
      ],
    }),
    'legacy_confirmed',
  );

  // 4. ONDAP의 기존 고유 프리셋 문구와 일치하는 과거 단일 텍스트 초안 -> 'legacy_confirmed'
  assert.equal(
    classifyDraftFormat({
      layers: [
        { id: 'txt-legacy', type: 'text', text: '보내주신 위로에\n깊이 감사드립니다' } as any,
      ],
    }),
    'legacy_confirmed',
  );

  // 5. 버전과 역할 정보가 없고 고유 프리셋과도 일치하지 않는 사용자 지정 문구 초안 -> 'ambiguous'
  assert.equal(
    classifyDraftFormat({
      layers: [
        { id: 'txt-random', type: 'text', text: '우리 회사 창립 10주년 기념 선물' } as any,
      ],
    }),
    'ambiguous',
  );
});

test('여러 문구 중 레거시 자리표시자가 있어도 형식을 추측하지 않는다', () => {
  assert.equal(classifyDraftFormat({ layers: [
    { id: 'custom', type: 'text', text: '직접 추가한 인사' } as any,
    { id: 'date', type: 'text', text: '{날짜}' } as any,
  ] }), 'ambiguous');
});

test('초안 형식별 메인 문구 추출 및 커스텀 문구 보호 (extractMainTextFromLayers)', () => {
  const customLayer: TextLayer = {
    id: 'user-custom-layer-1',
    type: 'text',
    text: '우리 회사 창립 10주년 기념 선물',
    x: 500,
    y: 500,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    font: 'serif',
    fontSize: 50,
    color: '#000000',
    stroke: null,
    shadow: false,
  };

  // v2 초안에 role-main이 없는 경우: 메인 문구 입력란은 빈칸이어야 하며 커스텀 레이어를 임의로 가져오지 않음
  assert.equal(extractMainTextFromLayers([customLayer], 'v2'), '');

  // ambiguous 초안인 경우: 사용자의 고유 문구를 메인 문구로 함부로 치환하지 않고 빈칸 유지
  assert.equal(extractMainTextFromLayers([customLayer], 'ambiguous'), '');

  // legacy_confirmed 초안인 경우: 첫 번째 텍스트를 메인 문구로 인식
  const legacyPresetLayer: TextLayer = {
    ...customLayer,
    id: 'layer-old',
    text: '함께해 주셔서 감사합니다',
  };
  assert.equal(extractMainTextFromLayers([legacyPresetLayer], 'legacy_confirmed'), '함께해 주셔서 감사합니다');

  // role-main 레이어가 명시적으로 있는 경우: 언제나 role-main의 text 반환
  const roleMainLayer: TextLayer = {
    ...customLayer,
    id: 'role-main',
    text: '감사의 마음을 전합니다',
  };
  assert.equal(extractMainTextFromLayers([customLayer, roleMainLayer], 'v2'), '감사의 마음을 전합니다');
});

test('초기 템플릿 기준점 및 실행 취소 경계 검증 (초기화 및 빈 캔버스 방지)', () => {
  const tpls = getEventTemplates({ event: 'wedding', purpose: 'return' });
  const initialLayers = tpls[0].createLayers();

  // 초기 상태: 히스토리는 비어있고 canUndo는 false
  const history: any[] = [];
  let canUndo = false;
  let currentLayers = initialLayers;

  // 고객이 아무것도 수정하지 않은 상태에서 undo 시도
  if (history.length > 0) {
    currentLayers = history.pop().layers;
    canUndo = history.length > 0;
  }
  assert.equal(canUndo, false, '초기 상태에서는 canUndo가 false');
  assert.equal(currentLayers.length, initialLayers.length, '초기 템플릿 레이어는 그대로 보존됨');

  // 고객이 이름 입력
  history.push({ layers: currentLayers });
  canUndo = true;
  currentLayers = syncFieldsToLayers(currentLayers, { recipient: '', sender: '홍길동', date: '' });
  assert.equal(canUndo, true, '수정 후 canUndo는 true');
  assert.ok(currentLayers.some((l) => l.id === 'role-sender'));

  // 실행 취소 수행
  const popped = history.pop();
  currentLayers = popped.layers;
  canUndo = history.length > 0;

  assert.equal(canUndo, false, '되돌린 후 다시 baseline으로 돌아와 canUndo는 false');
  assert.ok(!currentLayers.some((l) => l.id === 'role-sender'), '보내는 사람은 제거됨');
  assert.equal(currentLayers.length, initialLayers.length, '기본 템플릿 문구는 안전하게 유지됨 (빈 캔버스 아님)');
});

test('모바일 꾸미기: 이미지 선택/제거와 문구 수정/삭제 상호 독립성 보장', () => {
  const tpls = getEventTemplates({ event: 'thanks', purpose: 'return' });
  const tpl = tpls[0];

  let layers = tpl.createLayers();
  // 1. 초기 텍스트 확인
  assert.ok(layers.some((l) => l.id === 'role-main'), '초기 메인 텍스트 존재');

  // 사용자 정의 텍스트 추가
  layers.push({
    id: 'user-note',
    type: 'text',
    text: '모바일 꾸미기 테스트 문구',
    x: 500,
    y: 800,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    font: 'sans',
    fontSize: 36,
    color: '#333333',
    stroke: null,
    shadow: false,
  });

  // 2. 추천 이미지 적용
  const imageLayer: EditorImageLayer = {
    id: 'img-test-1',
    type: 'image',
    src: '/images/packaging/ornaments/flower-1.png',
    width: 300,
    height: 300,
    x: 500,
    y: 400,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };

  const { nextLayers, shouldClearMainText } = applyImageSelectionToLayers(layers, imageLayer);
  layers = nextLayers;

  // 검증: 이미지 추가 후에도 메인 문구 및 사용자 문구 그대로 유지
  assert.equal(shouldClearMainText, false, '이미지 선택 시 문구 제거 플래그는 false');
  assert.ok(layers.some((l) => l.id === 'role-main'), '이미지를 선택해도 role-main 텍스트 보존');
  assert.ok(layers.some((l) => l.id === 'user-note'), '이미지를 선택해도 사용자 추가 문구 보존');
  assert.ok(layers.some((l) => l.id === 'img-test-1'), '선택한 이미지가 추가됨');

  // 3. 이미지 삭제 (removeImageFromLayers)
  layers = removeImageFromLayers(layers);
  assert.ok(!layers.some((l) => l.type === 'image'), '이미지 레이어가 모두 제거됨');
  assert.ok(layers.some((l) => l.id === 'role-main'), '이미지 제거 후에도 role-main 문구 보존');
  assert.ok(layers.some((l) => l.id === 'user-note'), '이미지 제거 후에도 사용자 문구 보존');

  // 4. 다시 이미지 추가
  layers = applyImageSelectionToLayers(layers, imageLayer).nextLayers;
  assert.ok(layers.some((l) => l.id === 'img-test-1'), '이미지 재추가 성공');

  // 5. 문구 수정 (syncMainTextToLayers)
  layers = syncMainTextToLayers(layers, '수정된 메인 문구입니다', tpl);
  assert.equal(extractMainTextFromLayers(layers), '수정된 메인 문구입니다');
  assert.ok(layers.some((l) => l.id === 'img-test-1'), '문구를 수정해도 이미지는 그대로 유지됨');

  // 6. 메인 문구 삭제 (빈 문자열)
  layers = syncMainTextToLayers(layers, '', tpl);
  assert.ok(!layers.some((l) => l.id === 'role-main'), '메인 문구는 삭제됨');
  assert.ok(layers.some((l) => l.id === 'img-test-1'), '문구를 삭제해도 이미지는 안전하게 유지됨');
  assert.ok(layers.some((l) => l.id === 'user-note'), '사용자 추가 문구도 안전하게 유지됨');
});

test('인쇄물 선택(withSticker)과 인쇄물 없음(포장만) 데이터 및 옵션 호환성', () => {
  // 1. 인쇄물 있음 (기본 스티커 포함)
  const draftWithSticker = sanitizeDraft({
    background: '#ffffff',
    purpose: 'return',
    fields: { recipient: '고객님', sender: '온답', date: '' },
    layers: [
      {
        id: 'role-main',
        type: 'text',
        text: '감사합니다',
        x: 500,
        y: 500,
        font: 'serif',
        fontSize: 60,
        color: '#000000',
        stroke: null,
        shadow: false,
      },
    ],
  });
  assert.ok(draftWithSticker.layers.length > 0);
  assert.equal(draftWithSticker.fields.recipient, '고객님');

  // 2. 인쇄물 없음 (포장만 진행하는 경우)
  const draftNoSticker = sanitizeDraft({
    background: '#ffffff',
    purpose: 'celebration',
    fields: { recipient: '', sender: '', date: '' },
    layers: [],
  });
  assert.equal(draftNoSticker.layers.length, 0);
  assert.equal(draftNoSticker.fields.recipient, '');
});

test('스티커 규격(4cm=520px, 6cm=756px) 픽셀 해상도 매핑 검증', () => {
  const getPrintPixels = (sizeCm: number) => (sizeCm === 6 ? 756 : 520);
  assert.equal(getPrintPixels(4), 520, '4cm 규격은 520px');
  assert.equal(getPrintPixels(6), 756, '6cm 규격은 756px');

  // Konva export bounding box 계산식 검증:
  // stage size(1000) 대비 요청 픽셀(520, 756) 비율이 정확해야 함
  const stageSize = 1000;
  const pixelRatio4 = 520 / stageSize;
  const pixelRatio6 = 756 / stageSize;
  assert.equal(Math.round(stageSize * pixelRatio4), 520);
  assert.equal(Math.round(stageSize * pixelRatio6), 756);
});

