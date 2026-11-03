'use client';

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  FONTS,
  MAX_LAYERS,
  STICKER_SIZES,
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
  onRemoveImage: () => void;
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
    onRemoveImage,
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
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [showRecipient, setShowRecipient] = useState(Boolean(fields.recipient));
  const [showDate, setShowDate] = useState(Boolean(fields.date));
  const [showMoreTexts, setShowMoreTexts] = useState(false);
  const [showMoreImages, setShowMoreImages] = useState(false);

  // 현재 적용된 이미지 레이어 파악
  const currentImage = layers.find((l): l is EditorImageLayer => l.type === 'image') ?? null;
  const uploads = layers.filter((l): l is EditorImageLayer => l.type === 'image' && Boolean(l.uploaded));

  // 현재 서식 편집 대상 텍스트 레이어 (선택된 레이어가 텍스트면 해당 레이어, 아니면 role-main 또는 첫 번째 텍스트)
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const activeText = selected?.type === 'text'
    ? selected
    : layers.find((l): l is TextLayer => l.id === 'role-main') ?? layers.find((l): l is TextLayer => l.type === 'text');

  // 활성 텍스트 레이어 서식 패치
  const updateActiveText = (patch: Partial<TextLayer>) => {
    if (!activeText) return;
    onUpdateLayer(activeText.id, patch);
  };

  return (
    <div className="pkg-step-content">
      <div className="pkg-step-intro">
        <h2 className="pkg-step-heading">
          <span className="pkg-step-num">STEP 2</span>
          메시지 꾸미기
        </h2>
        <p className="pkg-step-desc">
          원하시는 문구와 이미지를 간편하게 적용해 나만의 포장 스티커를 완성해 보세요.
        </p>
      </div>

      {/* (a) 함께 제작할 인쇄물 선택 및 인쇄물 없음 */}
      <div className="pkg-sticker-toggle card">
        <div className="pkg-toggle-header">
          <span className="pkg-toggle-title">함께 넣을 인쇄물 선택</span>
          <span className="pill green">무료 서비스</span>
        </div>
        <div className="pkg-print-choice-grid" role="group" aria-label="인쇄물 선택">
          <button
            type="button"
            className={`pkg-choice-card ${withSticker ? 'active' : ''}`}
            aria-pressed={withSticker}
            onClick={() => setWithSticker(true)}
          >
            <div className="pkg-choice-icon">🏷️</div>
            <div className="pkg-choice-text">
              <span className="pkg-choice-title">메시지 스티커 포함</span>
              <span className="small muted">감사·축하 문구와 이미지를 인쇄하여 포장에 부착합니다</span>
            </div>
            <div className="pkg-choice-badge">{withSticker ? '선택됨' : '선택'}</div>
          </button>

          <button
            type="button"
            className={`pkg-choice-card ${!withSticker ? 'active' : ''}`}
            aria-pressed={!withSticker}
            onClick={() => setWithSticker(false)}
          >
            <div className="pkg-choice-icon">📦</div>
            <div className="pkg-choice-text">
              <span className="pkg-choice-title">인쇄물 없음</span>
              <span className="small muted">스티커 없이 포장지만 단정하고 깔끔하게 적용합니다</span>
            </div>
            <div className="pkg-choice-badge">{!withSticker ? '선택됨' : '선택'}</div>
          </button>
        </div>
      </div>

      {!withSticker ? (
        <div className="pkg-no-sticker-banner card">
          <div className="pkg-no-sticker-content">
            <span style={{ fontSize: 32 }}>🎁</span>
            <div>
              <b style={{ fontSize: 16 }}>스티커 없이 단정한 포장만 적용됩니다</b>
              <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
                메시지 인쇄물 없이 정갈한 선물 포장 상태로 안전하게 전달해 드립니다.
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
          {/* 행사 컨텍스트 안내 */}
          <div className="pkg-context-strip card">
            <div className="pkg-context-info">
              <span className="pkg-context-icon">💡</span>
              <div className="small">
                {eventName ? (
                  <>
                    <b>{eventName}</b>
                    {relationName ? ` (${relationName})` : ''} 행사에 어울리는 추천 문구와 이미지를 준비했어요.
                  </>
                ) : (
                  <>마음에 어울리는 추천 문구와 이미지를 준비했어요.</>
                )}
              </div>
            </div>
          </div>

          {/* 1. 문구 꾸미기 ((c) 추천 문구 적용·삭제 + (d) 직접 편집 + 폰트·크기·색·외곽선·그림자 기본 제공) */}
          <div className="pkg-basic-edit-card card">
            <div className="pkg-section-header spread" style={{ alignItems: 'center' }}>
              <div>
                <span className="pkg-section-title">1. 문구 작성 및 서식 꾸미기</span>
                <span className="small muted" style={{ display: 'block', marginTop: 2 }}>
                  문구를 입력하거나 추천 문구를 누르면 즉시 스티커에 반영됩니다
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {mainText.trim() && (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => onMainTextChange('')}
                    title="입력한 메인 문구를 삭제합니다 (이미지는 유지)"
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger-weak)' }}
                  >
                    문구 지우기
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={!canUndo}
                  onClick={onUndo}
                  title="이전 편집 상태로 되돌립니다"
                >
                  되돌리기
                </button>
              </div>
            </div>

            {/* (d) 메인 문구 직접 편집 */}
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
                placeholder="감사의 마음이나 전하고 싶은 메시지를 직접 입력하세요"
                onChange={(e) => onMainTextChange(e.target.value)}
              />
              <div className="pkg-input-hint small muted">
                {mainText.length} / 120자
              </div>
            </div>

            {/* (c) 추천 문구 적용·삭제 */}
            <div className="pkg-recommended-phrases">
              <div className="pkg-sub-label">
                <span>💡 추천 문구 적용</span>
                <span className="small muted">누르면 바로 문구에 적용됩니다</span>
              </div>
              <div className="pkg-phrase-chips">
                {nearTexts.slice(0, showMoreTexts ? undefined : 4).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="pkg-phrase-btn"
                    onClick={() => onPickText(t)}
                  >
                    {fillPlaceholders(t.text, fields).replace(/\n/g, ' ')}
                  </button>
                ))}
              </div>
              {nearTexts.length > 4 && (
                <button
                  type="button"
                  className="link-btn small"
                  style={{ marginTop: 6 }}
                  onClick={() => setShowMoreTexts((v) => !v)}
                >
                  {showMoreTexts ? '추천 문구 접기 ▲' : `추천 문구 더보기 (${nearTexts.length - 4}개) ▼`}
                </button>
              )}
            </div>

            {/* (d) 문구 서식 기본 제공: 폰트, 글자 크기, 글자색, 외곽선, 그림자 */}
            <div className="pkg-typography-box">
              <div className="pkg-sub-label">
                <span>✏️ 글자 모양 및 서식</span>
                {activeText && activeText.id !== 'role-main' && (
                  <span className="pill gray" style={{ fontSize: 11 }}>
                    선택: {activeText.id === 'role-recipient' ? '받는 분' : activeText.id === 'role-sender' ? '보내는 사람' : activeText.id === 'role-date' ? '날짜' : '추가 문구'}
                  </span>
                )}
              </div>

              {/* 폰트 선택 */}
              <div className="pkg-style-row">
                <span className="pkg-style-label">서체(폰트)</span>
                <div className="chips">
                  {FONTS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="chip"
                      aria-pressed={activeText?.font === f.id}
                      onClick={() => updateActiveText({ font: f.id })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 글자 크기 조절 (터치 친화적 버튼 + 슬라이더) */}
              <div className="pkg-style-row">
                <span className="pkg-style-label">글자 크기</span>
                <div className="pkg-size-controls">
                  <button
                    type="button"
                    className="pkg-step-btn"
                    onClick={() => activeText && updateActiveText({ fontSize: Math.max(28, (activeText.fontSize || 64) - 4), scaleX: 1, scaleY: 1 })}
                    aria-label="글자 크기 축소"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={28}
                    max={140}
                    value={activeText?.fontSize ?? 64}
                    onChange={(e) => updateActiveText({ fontSize: Number(e.target.value), scaleX: 1, scaleY: 1 })}
                    className="pkg-size-slider"
                  />
                  <button
                    type="button"
                    className="pkg-step-btn"
                    onClick={() => activeText && updateActiveText({ fontSize: Math.min(140, (activeText.fontSize || 64) + 4), scaleX: 1, scaleY: 1 })}
                    aria-label="글자 크기 확대"
                  >
                    +
                  </button>
                  <span className="pkg-size-badge num">{activeText?.fontSize ?? 64}px</span>
                </div>
              </div>

              {/* 글자색 선택 */}
              <div className="pkg-style-row">
                <span className="pkg-style-label">글자색</span>
                <div className="pkg-swatch-list">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`swatch ${activeText?.color === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      aria-pressed={activeText?.color === c}
                      aria-label={`글자색 ${c}`}
                      onClick={() => updateActiveText({ color: c })}
                    />
                  ))}
                </div>
              </div>

              {/* 외곽선 및 그림자 효과 */}
              <div className="pkg-style-row pkg-effects-row">
                <label className="pkg-check-label" style={{ minHeight: 36 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeText?.stroke)}
                    onChange={(e) =>
                      updateActiveText({
                        stroke: e.target.checked
                          ? activeText?.color === '#ffffff'
                            ? '#1f2a26'
                            : '#ffffff'
                          : null,
                      })
                    }
                  />
                  <span>글자 외곽선</span>
                </label>

                {activeText?.stroke && (
                  <div className="pkg-swatch-list small" style={{ marginLeft: 8 }}>
                    {COLORS.slice(0, 5).map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`swatch small ${activeText.stroke === c ? 'selected' : ''}`}
                        style={{ background: c }}
                        aria-pressed={activeText.stroke === c}
                        aria-label={`외곽선색 ${c}`}
                        onClick={() => updateActiveText({ stroke: c })}
                      />
                    ))}
                  </div>
                )}

                <label className="pkg-check-label" style={{ minHeight: 36, marginLeft: 16 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeText?.shadow)}
                    onChange={(e) => updateActiveText({ shadow: e.target.checked })}
                  />
                  <span>그림자</span>
                </label>
              </div>
            </div>

          </div>

          {/* 2. 이미지 꾸미기 ((b) 추천 이미지 적용·삭제 + (e) 이미지 직접 등록) */}
          <div className="pkg-image-card card">
            <div className="pkg-section-header spread" style={{ alignItems: 'center' }}>
              <div>
                <span className="pkg-section-title">2. 이미지 꾸미기</span>
                <span className="small muted" style={{ display: 'block', marginTop: 2 }}>
                  사진을 올리거나 추천 이미지를 선택할 수 있습니다 (문구는 그대로 유지됩니다)
                </span>
              </div>
              {currentImage && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={onRemoveImage}
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger-weak)' }}
                  title="현재 적용된 이미지를 삭제합니다 (문구는 유지)"
                >
                  이미지 삭제
                </button>
              )}
            </div>

            {/* 현재 이미지 적용 상태 표시 */}
            {currentImage ? (
              <div className="pkg-current-image-status">
                <div className="pkg-applied-image-preview">
                  <img src={currentImage.src} alt="현재 적용된 이미지" />
                </div>
                <div className="pkg-applied-image-info">
                  <b>{currentImage.uploaded ? '직접 올린 사진 적용 중' : '추천 디자인 이미지 적용 중'}</b>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    이미지를 교체하거나 삭제해도 작성하신 문구는 안전하게 유지됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={onRemoveImage}
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger-weak)', flexShrink: 0 }}
                >
                  삭제
                </button>
              </div>
            ) : (
              <div className="pkg-applied-image-empty">
                <span className="small muted">현재 적용된 이미지 없음 (글자 전용 스티커)</span>
              </div>
            )}

            {/* (e) 이미지 직접 등록 */}
            <div className="pkg-upload-section" style={{ marginTop: 14 }}>
              <div className="pkg-upload-row">
                <button
                  type="button"
                  className="btn large"
                  style={{ flex: 1 }}
                  onClick={() => fileRef.current?.click()}
                >
                  📷 내 사진/이미지 직접 올리기
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
              </div>
              <span className="small muted" style={{ display: 'block', marginTop: 4 }}>
                JPG, PNG 형식 지원 (최대 10MB)
              </span>

              {uploads.length > 0 && (
                <label className="pkg-check-label" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>올린 사진은 직접 촬영했거나 사용 권한이 있는 사진입니다.</span>
                </label>
              )}
            </div>

            {/* (b) 추천 이미지 적용·삭제 */}
            <div className="pkg-recommended-images-wrap" style={{ marginTop: 18 }}>
              <span className="pkg-sub-label">추천 디자인 이미지</span>
              <div className="pkg-image-grid">
                {images.map((img) => {
                  const isCurrent = currentImage?.src === img.imageUrl;
                  return (
                    <button
                      key={img.id}
                      type="button"
                      className={`pkg-img-thumb ${isCurrent ? 'selected' : ''}`}
                      onClick={() => onPickImage(img)}
                      aria-pressed={isCurrent}
                      title={img.name}
                    >
                      <Image
                        src={img.imageUrl}
                        alt={img.name}
                        width={120}
                        height={120}
                        sizes="100px"
                      />
                      <span>{img.name || categoryNames[img.category] || '추천'}</span>
                      {isCurrent && <span className="pkg-img-check">✓</span>}
                    </button>
                  );
                })}
              </div>

              {otherImages.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() => setShowMoreImages((v) => !v)}
                  >
                    {showMoreImages ? '다른 행사 이미지 접기 ▲' : `다른 행사 이미지 더보기 (${otherImages.length}개) ▼`}
                  </button>
                  {showMoreImages && (
                    <div className="pkg-image-grid" style={{ marginTop: 8 }}>
                      {otherImages.map((img) => {
                        const isCurrent = currentImage?.src === img.imageUrl;
                        return (
                          <button
                            key={img.id}
                            type="button"
                            className={`pkg-img-thumb ${isCurrent ? 'selected' : ''}`}
                            onClick={() => onPickImage(img)}
                            aria-pressed={isCurrent}
                          >
                            <Image
                              src={img.imageUrl}
                              alt={img.name}
                              width={120}
                              height={120}
                              sizes="100px"
                              loading="lazy"
                            />
                            <span>{img.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. 스티커 규격 및 바탕색 */}
          <div className="pkg-specs-card card">
            <span className="pkg-section-title">3. 스티커 규격 및 배경</span>

            <div className="pkg-shape-size-row" style={{ marginTop: 12, borderTop: 'none', paddingTop: 0 }}>
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
                문구를 조금 줄이거나 미리보기에서 글자를 안쪽으로 옮겨주세요.
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
