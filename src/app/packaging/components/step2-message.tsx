'use client';

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  FONTS,
  MAX_LAYERS,
  MIN_PRINT_DPI,
  STICKER_SIZES,
  effectiveDpi,
  fillPlaceholders,
  printPixels,
  type FontId,
} from '@/packaging/rules.ts';
import type { DesignCategory, DesignDraft, DesignImage, DesignText, StickerShape, StickerSizeCm, TextLayer } from '@/packaging/types.ts';
import type { EditorImageLayer, EditorLayer } from '../editor-types.ts';
import type { StickerTemplate } from '@/packaging/templates.ts';
import { todayLabel } from '../editor-store.ts';

const COLORS = ['#1f2a26', '#ffffff', '#2f5a4b', '#b8903a', '#b5523b', '#1d3557', '#7a2e3a', '#e8a0b4'];
const BACKGROUNDS = ['#ffffff', '#f6edd8', '#e3ede7', '#f7e6e1', '#1f3f34'];

interface Props {
  withSticker: boolean;
  setWithSticker: (v: boolean) => void;
  event: DesignCategory | null;
  setEvent: (e: DesignCategory) => void;
  events: { id: DesignCategory; name: string }[];
  eventName?: string | null;
  relationName?: string | null;
  templates: StickerTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (t: StickerTemplate) => void;
  mainText: string;
  onMainTextChange: (t: string) => void;
  fields: DesignDraft['fields'];
  onFieldsChange: (f: DesignDraft['fields']) => void;
  shape: StickerShape;
  setShape: (s: StickerShape) => void;
  sizeCm: StickerSizeCm;
  setSizeCm: (s: StickerSizeCm) => void;
  background: string;
  setBackground: (b: string) => void;
  layers: EditorLayer[];
  selectedId: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, patch: Partial<EditorLayer>) => void;
  onAddText: () => void;
  onRemoveSelected: () => void;
  onMoveSelected: (dir: 1 | -1) => void;
  onUpload: (file: File | undefined) => void;
  consent: boolean;
  setConsent: (c: boolean) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClearAll: () => void;
  images: DesignImage[];
  otherImages: DesignImage[];
  categoryNames: Record<string, string>;
  onPickImage: (img: DesignImage) => void;
  nearTexts: DesignText[];
  otherTexts: DesignText[];
  onPickText: (t: DesignText) => void;
  overflowBoxes: unknown[];
  overlapBoxes: unknown[];
  caution: string[];
  lowRes: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function Step2Message(props: Props) {
  const {
    withSticker,
    setWithSticker,
    event,
    setEvent,
    events,
    eventName,
    relationName,
    templates,
    selectedTemplateId,
    onSelectTemplate,
    mainText,
    onMainTextChange,
    fields,
    onFieldsChange,
    shape,
    setShape,
    sizeCm,
    setSizeCm,
    background,
    setBackground,
    layers,
    selectedId,
    onSelectLayer,
    onUpdateLayer,
    onAddText,
    onRemoveSelected,
    onMoveSelected,
    onUpload,
    consent,
    setConsent,
    canUndo,
    onUndo,
    onClearAll,
    images,
    otherImages,
    categoryNames,
    onPickImage,
    nearTexts,
    otherTexts,
    onPickText,
    overflowBoxes,
    overlapBoxes,
    caution,
    lowRes,
    onPrev,
    onNext,
  } = props;

  const fileRef = useRef<HTMLInputElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<'image' | 'font' | 'layer'>('image');
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [showRecipient, setShowRecipient] = useState(Boolean(fields.recipient));
  const [showDate, setShowDate] = useState(Boolean(fields.date));

  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const uploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));

  return (
    <div className="pkg-step-content">
      <div className="pkg-step-intro">
        <h2 className="pkg-step-heading">
          <span className="pkg-step-num">STEP 2</span>
          메시지 스티커 꾸미기
        </h2>
        <p className="pkg-step-desc">
          전문 디자이너가 조판한 추천 템플릿을 선택하고 문구만 입력하면 고급스러운 스티커가 완성됩니다.
        </p>
      </div>

      {/* 스티커 부착 여부 선택 */}
      <div className="pkg-sticker-toggle card">
        <div className="pkg-toggle-header">
          <span className="pkg-toggle-title">함께 넣을 인쇄물</span>
          <span className="pill green">무료 혜택</span>
        </div>
        <div className="chips" role="group" aria-label="스티커 부착 여부">
          <button
            type="button"
            className="chip large"
            aria-pressed={withSticker}
            onClick={() => setWithSticker(true)}
          >
            ● 메시지 스티커 포함 (무료)
          </button>
          <button
            type="button"
            className="chip large"
            aria-pressed={!withSticker}
            onClick={() => setWithSticker(false)}
          >
            인쇄물 없이 포장지만 단정하게
          </button>
        </div>
      </div>

      {!withSticker ? (
        <div className="pkg-no-sticker-banner card">
          <div className="pkg-no-sticker-content">
            <span style={{ fontSize: 28 }}>📦</span>
            <div>
              <b>스티커 없이 포장지만 적용합니다</b>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                메시지 인쇄물 없이 깔끔하고 단아한 포장 상태로 배송해 드립니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn block large"
            style={{ marginTop: 20 }}
            onClick={onNext}
          >
            다음: 최종 확인으로 이동 ›
          </button>
        </div>
      ) : (
        <>
          {/* 행사 / 관계 기본값 안내 */}
          <div className="pkg-context-strip card">
            <div className="pkg-context-info">
              <span className="pkg-context-icon">💡</span>
              <div className="small">
                {eventName ? (
                  <>
                    <b>{eventName}</b>
                    {relationName ? ` (${relationName})` : ''} 행사에 맞는 추천 템플릿을 준비했어요.
                  </>
                ) : (
                  <>소중한 마음에 어울리는 추천 템플릿을 준비했어요.</>
                )}
              </div>
            </div>
            <button
              type="button"
              className="link-btn small"
              onClick={() => setShowEventPicker((v) => !v)}
            >
              {showEventPicker ? '행사 닫기' : '행사 변경'}
            </button>
          </div>

          {showEventPicker && (
            <div className="pkg-event-selector card">
              <span className="small muted" style={{ fontWeight: 600 }}>다른 행사 기준 보기</span>
              <div className="chips event-chips" style={{ marginTop: 8 }}>
                {events.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="chip"
                    aria-pressed={event === e.id}
                    onClick={() => {
                      setEvent(e.id);
                      setShowEventPicker(false);
                    }}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 1. 추천 템플릿 선택 (3~5개) */}
          <div className="pkg-template-section">
            <div className="pkg-section-header">
              <span className="pkg-section-title">1. 추천 스티커 템플릿</span>
              <span className="small muted">원하는 서식을 고르면 즉시 적용돼요</span>
            </div>

            <div className="pkg-template-list">
              {templates.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`pkg-template-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectTemplate(tpl)}
                    aria-pressed={isSelected}
                  >
                    <div className="pkg-template-preview-badge">
                      <span
                        className={`pkg-template-shape-preview ${tpl.shape}`}
                        style={{ background: tpl.background }}
                      >
                        <span className="pkg-preview-mini-font" style={{ color: tpl.textColor }}>
                          {tpl.shape === 'circle' ? '●' : '■'}
                        </span>
                      </span>
                    </div>

                    <div className="pkg-template-details">
                      <div className="pkg-template-title-line">
                        <span className="pkg-template-name">{tpl.name}</span>
                        {tpl.tag && <span className="pill gray">{tpl.tag}</span>}
                        {isSelected && <span className="pill green">선택중</span>}
                      </div>
                      <p className="pkg-template-text-sample">{tpl.mainText.replace(/\n/g, ' ')}</p>
                      <span className="pkg-template-desc small muted">{tpl.description}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 필수 문구 간편 편집 */}
          <div className="pkg-basic-edit-card card">
            <div className="pkg-section-header spread" style={{ alignItems: 'center' }}>
              <div>
                <span className="pkg-section-title">2. 문구 입력</span>
                <span className="small muted" style={{ display: 'block' }}>입력한 문구가 실시간으로 스티커에 반영됩니다</span>
              </div>
              <button
                type="button"
                className="btn ghost small"
                disabled={!canUndo}
                onClick={onUndo}
                style={{ flexShrink: 0 }}
                title="이전 편집 상태로 되돌립니다"
              >
                실행 취소
              </button>
            </div>

            <div className="pkg-input-group">
              <label className="pkg-label">
                메인 문구
                <span className="small muted" style={{ fontWeight: 400 }}> (줄바꿈 가능)</span>
              </label>
              <textarea
                className="pkg-textarea"
                rows={3}
                value={mainText}
                maxLength={120}
                placeholder="감사의 마음을 전할 문구를 입력하세요"
                onChange={(e) => onMainTextChange(e.target.value)}
              />
              <div className="pkg-input-hint small muted">
                {mainText.length} / 120자
              </div>
            </div>

            <div className="pkg-input-group">
              <label className="pkg-label">
                보내는 사람
                <span className="small muted" style={{ fontWeight: 400 }}> (성함 또는 호칭)</span>
              </label>
              <input
                type="text"
                className="num-input pkg-text-input"
                value={fields.sender}
                maxLength={30}
                placeholder="예: 홍길동 (또는 홍길동 올림)"
                onChange={(e) => onFieldsChange({ ...fields, sender: e.target.value })}
              />
              <div className="small muted" style={{ fontSize: 12, marginTop: -2 }}>
                스티커에 인쇄될 보내시는 분 성함이나 문구를 그대로 입력해 주세요.
              </div>
            </div>

            {/* 선택적 추가 항목 (받는 분, 날짜) */}
            <div className="pkg-optional-fields-wrap">
              <div className="pkg-optional-toggles">
                {!showRecipient && (
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() => setShowRecipient(true)}
                  >
                    + 받는 분 추가
                  </button>
                )}
                {!showDate && (
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() => setShowDate(true)}
                  >
                    + 날짜 추가
                  </button>
                )}
              </div>

              {showRecipient && (
                <div className="pkg-input-group" style={{ marginTop: 10 }}>
                  <div className="spread">
                    <label className="pkg-label">받는 분</label>
                    <button
                      type="button"
                      className="link-btn small muted"
                      onClick={() => {
                        setShowRecipient(false);
                        onFieldsChange({ ...fields, recipient: '' });
                      }}
                    >
                      숨기기
                    </button>
                  </div>
                  <input
                    type="text"
                    className="num-input pkg-text-input"
                    value={fields.recipient}
                    maxLength={30}
                    placeholder="받는 분 성함 (예: 김선생님께)"
                    onChange={(e) => onFieldsChange({ ...fields, recipient: e.target.value })}
                  />
                </div>
              )}

              {showDate && (
                <div className="pkg-input-group" style={{ marginTop: 10 }}>
                  <div className="spread">
                    <label className="pkg-label">날짜</label>
                    <button
                      type="button"
                      className="link-btn small muted"
                      onClick={() => {
                        setShowDate(false);
                        onFieldsChange({ ...fields, date: '' });
                      }}
                    >
                      숨기기
                    </button>
                  </div>
                  <div className="date-row">
                    <input
                      type="text"
                      className="num-input pkg-text-input"
                      value={fields.date}
                      maxLength={30}
                      placeholder="예: 2026년 11월 1일"
                      onChange={(e) => onFieldsChange({ ...fields, date: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => onFieldsChange({ ...fields, date: todayLabel() })}
                    >
                      오늘
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3. 스티커 모양 및 크기 선택 */}
            <div className="pkg-shape-size-row" style={{ marginTop: 16 }}>
              <div>
                <label className="pkg-label">스티커 형태</label>
                <div className="chips">
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={shape === 'circle'}
                    onClick={() => setShape('circle')}
                  >
                    ● 원형
                  </button>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={shape === 'square'}
                    onClick={() => setShape('square')}
                  >
                    ■ 사각
                  </button>
                </div>
              </div>

              <div>
                <label className="pkg-label">인쇄 규격</label>
                <div className="chips">
                  {STICKER_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip"
                      aria-pressed={sizeCm === s}
                      onClick={() => setSizeCm(s)}
                    >
                      {s}×{s}cm
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 실시간 유효성 경고 피드백 */}
          {overflowBoxes.length > 0 && (
            <div className="pkg-alert-box danger card">
              <span className="pkg-alert-icon">⚠️</span>
              <div className="small">
                <b>글자 잘림 주의:</b> 빨간 점선(자르는 선) 밖으로 글자가 나갈 수 있습니다.
                문구를 조금 줄이거나 우측 미리보기에서 글자를 안쪽으로 옮겨주세요.
              </div>
            </div>
          )}

          {overlapBoxes.length > 0 && (
            <div className="pkg-alert-box warning card">
              <span className="pkg-alert-icon">⚠️</span>
              <div className="small">
                <b>문구 겹침:</b> 글자 상자가 서로 겹쳐 있어 읽기 어려울 수 있습니다.
                미리보기에서 문구를 끌어 위치를 조정해주세요.
              </div>
            </div>
          )}

          {caution.length > 0 && (
            <div className="pkg-alert-box warning card">
              <span className="pkg-alert-icon">💡</span>
              <div className="small">
                ‘{caution.join('’, ‘')}’ 단어는 {eventName ?? '행사'} 자리에 어울리지 않을 수 있으니 확인해 주세요.
              </div>
            </div>
          )}

          {lowRes && (
            <div className="pkg-alert-box danger card">
              <span className="pkg-alert-icon">⚠️</span>
              <div className="small">
                올린 사진 해상도가 낮아 인쇄 시 흐릿할 수 있습니다. 가로 {printPixels(sizeCm)}px 이상 사진을 권장합니다.
              </div>
            </div>
          )}

          {/* 더 자세히 꾸미기 (접을 수 있는 패널) */}
          <div className="pkg-advanced-accordion card">
            <button
              type="button"
              className="pkg-accordion-header"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              <div className="pkg-accordion-title-wrap">
                <span className="pkg-accordion-title">🎨 더 자세히 꾸미기</span>
                <span className="small muted">폰트, 색상, 사진 업로드, 레이어 조정</span>
              </div>
              <span className="pkg-accordion-arrow">{showAdvanced ? '▲ 접기' : '▼ 펼치기'}</span>
            </button>

            {showAdvanced && (
              <div className="pkg-accordion-body">
                <div className="tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={advancedTab === 'image'}
                    onClick={() => setAdvancedTab('image')}
                  >
                    사진·배경
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={advancedTab === 'font'}
                    onClick={() => setAdvancedTab('font')}
                  >
                    폰트·스타일
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={advancedTab === 'layer'}
                    onClick={() => setAdvancedTab('layer')}
                  >
                    레이어·도구
                  </button>
                </div>

                {advancedTab === 'image' && (
                  <div className="tab-body">
                    <div className="pkg-upload-row">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => fileRef.current?.click()}
                      >
                        내 사진 올리기 (JPG, PNG)
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        hidden
                        onChange={(e) => {
                          onUpload(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                      <span className="small muted">최대 10MB</span>
                    </div>

                    {uploads.length > 0 && (
                      <label className="small row" style={{ gap: 6, marginTop: 8 }}>
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        올린 사진은 직접 촬영했거나 사용 권한이 있는 사진입니다.
                      </label>
                    )}

                    <div className="field-label" style={{ marginTop: 16 }}>바탕색 선택</div>
                    <div className="row" style={{ gap: 8 }}>
                      {BACKGROUNDS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="swatch"
                          style={{ background: c }}
                          aria-pressed={background === c}
                          aria-label={`바탕색 ${c}`}
                          onClick={() => setBackground(c)}
                        />
                      ))}
                    </div>

                    <div className="field-label" style={{ marginTop: 16 }}>추천 디자인 이미지</div>
                    <div className="sticker-grid">
                      {images.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          className="thumb"
                          onClick={() => onPickImage(img)}
                          aria-pressed={layers[0]?.type === 'image' && layers[0].src === img.imageUrl}
                        >
                          <Image
                            src={img.imageUrl}
                            alt={img.name}
                            width={160}
                            height={160}
                            sizes="(max-width: 480px) 22vw, 100px"
                          />
                          <span>{img.name || categoryNames[img.category] || '추천 이미지'}</span>
                        </button>
                      ))}
                    </div>

                    {otherImages.length > 0 && (
                      <details style={{ marginTop: 12 }}>
                        <summary className="small muted" style={{ cursor: 'pointer' }}>다른 행사 이미지 보기</summary>
                        <div className="sticker-grid" style={{ marginTop: 8 }}>
                          {otherImages.map((img) => (
                            <button
                              key={img.id}
                              type="button"
                              className="thumb"
                              onClick={() => onPickImage(img)}
                              aria-pressed={layers[0]?.type === 'image' && layers[0].src === img.imageUrl}
                            >
                              <Image
                                src={img.imageUrl}
                                alt={img.name}
                                width={160}
                                height={160}
                                sizes="(max-width: 480px) 22vw, 100px"
                                loading="lazy"
                              />
                              <span>{img.name || '이미지'}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {advancedTab === 'font' && (
                  <div className="tab-body">
                    {selected?.type === 'text' ? (
                      <div className="pkg-font-editor">
                        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                          선택한 문구 스타일 변경:
                        </div>
                        <div className="chips">
                          {FONTS.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className="chip"
                              aria-pressed={selected.font === f.id}
                              onClick={() => onUpdateLayer(selected.id, { font: f.id })}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>

                        <label className="small row" style={{ gap: 8, marginTop: 12 }}>
                          글자 크기 ({selected.fontSize}px)
                          <input
                            type="range"
                            min={28}
                            max={200}
                            value={selected.fontSize}
                            onChange={(e) =>
                              onUpdateLayer(selected.id, {
                                fontSize: Number(e.target.value),
                                scaleX: 1,
                                scaleY: 1,
                              })
                            }
                            style={{ flex: 1 }}
                          />
                        </label>

                        <div className="row" style={{ gap: 6, marginTop: 12 }}>
                          <span className="small" style={{ width: 44 }}>글자색</span>
                          {COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className="swatch"
                              style={{ background: c }}
                              aria-pressed={selected.color === c}
                              aria-label={`글자색 ${c}`}
                              onClick={() => onUpdateLayer(selected.id, { color: c })}
                            />
                          ))}
                        </div>

                        <div className="row" style={{ gap: 6, marginTop: 12 }}>
                          <label className="small row" style={{ gap: 4, width: 70 }}>
                            <input
                              type="checkbox"
                              checked={Boolean(selected.stroke)}
                              onChange={(e) =>
                                onUpdateLayer(selected.id, {
                                  stroke: e.target.checked
                                    ? selected.color === '#ffffff'
                                      ? '#1f2a26'
                                      : '#ffffff'
                                    : null,
                                })
                              }
                            />
                            외곽선
                          </label>
                          {selected.stroke &&
                            COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                className="swatch small"
                                style={{ background: c }}
                                aria-pressed={selected.stroke === c}
                                aria-label={`외곽선색 ${c}`}
                                onClick={() => onUpdateLayer(selected.id, { stroke: c })}
                              />
                            ))}
                        </div>

                        <label className="small row" style={{ gap: 4, marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={selected.shadow}
                            onChange={(e) => onUpdateLayer(selected.id, { shadow: e.target.checked })}
                          />
                          그림자 효과
                        </label>
                      </div>
                    ) : (
                      <p className="small muted">
                        우측 미리보기 캔버스에서 수정할 문구를 클릭하면 세부 글꼴과 색상을 변경할 수 있습니다.
                      </p>
                    )}

                    <div className="spread" style={{ marginTop: 16 }}>
                      <span className="field-label">추천 문구 모음</span>
                      <button type="button" className="btn ghost small" onClick={onAddText}>
                        + 새 문구 추가
                      </button>
                    </div>
                    <div className="text-list">
                      {nearTexts.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="text-choice"
                          onClick={() => onPickText(t)}
                        >
                          <span style={{ whiteSpace: 'pre-line' }}>{fillPlaceholders(t.text, fields)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {advancedTab === 'layer' && (
                  <div className="tab-body">
                    {selected ? (
                      <div className="pkg-layer-control-box">
                        <div className="small" style={{ fontWeight: 600 }}>
                          선택 요소: {selected.type === 'text' ? '문구 레이어' : '이미지 레이어'}
                        </div>
                        <div className="row" style={{ gap: 6, marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() => onMoveSelected(-1)}
                          >
                            뒤로 보내기
                          </button>
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() => onMoveSelected(1)}
                          >
                            앞으로 보내기
                          </button>
                          <button
                            type="button"
                            className="btn ghost small"
                            style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                            onClick={onRemoveSelected}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="small muted">우측 캔버스에서 수정할 요소를 먼저 선택해 주세요.</p>
                    )}

                    <div className="row" style={{ gap: 8, marginTop: 16 }}>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={!canUndo}
                        onClick={onUndo}
                      >
                        되돌리기 (실행 취소)
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={layers.length === 0}
                        onClick={onClearAll}
                      >
                        모두 지우기
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* 하단 내비게이션 버튼 */}
      <div className="pkg-step-actions spread">
        <button type="button" className="btn ghost large" onClick={onPrev}>
          ‹ 이전: 포장지 선택
        </button>
        <button type="button" className="btn large" onClick={onNext}>
          다음: 최종 확인 ›
        </button>
      </div>
    </div>
  );
}
