'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ApprovalDraft, ApprovalDraftEditable, ApprovalDocumentModel } from '@/approval/types.ts';
import { buildDocumentModel, validateQuantity } from '@/approval/calc.ts';
import { resultHref, won } from '@/lib/result-query.ts';
import { createApprovalAutosave, type SaveStatus } from '@/approval/autosave.ts';
import { ApprovalPreview } from './approval-preview.tsx';

export function ApprovalEditorView({
  initialDraft,
  initialModel,
}: {
  initialDraft: ApprovalDraft;
  initialModel: ApprovalDocumentModel;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ApprovalDraft>(initialDraft);
  const [model, setModel] = useState<ApprovalDocumentModel>(initialModel);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'preview'>('input'); // 모바일 탭 전환

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveRef = useRef<ReturnType<typeof createApprovalAutosave> | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = createApprovalAutosave(initialDraft, async (patch, revision) => {
      const res = await fetch(`/api/approval/${initialDraft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch, expectedRevision: revision }),
      });
      if (!res.ok) {
        const error = new Error('저장 실패');
        if (res.status === 409) error.name = 'RevisionConflictError';
        throw error;
      }
      return (await res.json()).draft;
    }, (next) => {
      setDraft(next);
      try { setModel(buildDocumentModel(next)); } catch {}
    }, (state, message) => {
      setSaveStatus(state);
      setErrorMessage(message);
    });
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (autosaveRef.current?.dirty()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  function handleFieldChange<K extends keyof ApprovalDraftEditable>(key: K, value: ApprovalDraftEditable[K]) {
    autosaveRef.current!.edit({ [key]: value });
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => { void flushSave(); }, 500);
  }

  async function flushSave() { return autosaveRef.current!.flush(); }

  async function ensureSavedBeforeDownload(type: 'docx' | 'pdf' | 'hwpx') {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (await flushSave()) window.location.href = `/api/approval/${draft.id}/${type}`;
  }

  // 클립보드 품의 요약 복사
  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(model.summaryClipboardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert('클립보드 복사에 실패했습니다.');
    }
  }

  // 초안 삭제
  async function handleDelete() {
    if (!confirm('이 결재 문서 초안을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.')) {
      return;
    }
    try {
      const res = await fetch(`/api/approval/${draft.id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('문서가 삭제되었습니다.');
        router.push(resultHref(draft.source.query));
      } else {
        alert('삭제에 실패했습니다.');
      }
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  }

  // 포장·스티커 꾸미기 링크 생성
  const packagingHref = () => {
    const p = new URLSearchParams({
      product: String(draft.editable.selectedProductNo),
      qty: String(draft.editable.quantity),
      event: draft.source.query.event,
      relation: draft.source.query.relation,
    });
    if (draft.source.query.budget !== null) {
      p.set('budget', String(draft.source.query.budget));
    }
    if (draft.source.query.budgetMode) p.set('budgetMode', draft.source.query.budgetMode);
    if (draft.source.query.totalBudget != null) p.set('totalBudget', String(draft.source.query.totalBudget));
    if (draft.source.query.exclude.length) p.set('exclude', draft.source.query.exclude.join(','));
    return `/packaging?${p.toString()}`;
  };

  const backToResultHref = resultHref(draft.source.query);

  const complianceChecks = draft.editable.complianceChecks || {};
  const isAntiGraftChecked = Boolean(complianceChecks.antiGraft);
  const isElectionLawChecked = Boolean(complianceChecks.electionLaw);
  const isContractChecked = Boolean(complianceChecks.contract);

  function handleComplianceCheckChange(key: 'antiGraft' | 'electionLaw' | 'contract', checked: boolean) {
    const updated = {
      ...(draft.editable.complianceChecks || {}),
      [key]: checked,
    };
    handleFieldChange('complianceChecks', updated);
  }

  return (
    <div className="approval-page" style={{ minHeight: '100vh', backgroundColor: '#F8FAFC' }}>
      {/* 최상단 네비게이션 바 */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          padding: '10px 16px',
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <a
              href={backToResultHref}
              style={{
                textDecoration: 'none',
                color: '#475569',
                fontSize: 14,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              ‹ 추천 결과로
            </a>
            <span style={{ color: '#CBD5E1' }}>|</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#0F172A' }}>
              결재 문서 검토·편집
            </span>
            <span
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 12,
                backgroundColor:
                  saveStatus === 'saved'
                    ? '#F0FDF4'
                    : saveStatus === 'saving'
                    ? '#FEFCE8'
                    : '#FEF2F2',
                color:
                  saveStatus === 'saved'
                    ? '#166534'
                    : saveStatus === 'saving'
                    ? '#854D0E'
                    : '#991B1B',
                fontWeight: 500,
              }}
            >
              {saveStatus === 'saved' && '✓ 저장됨'}
              {saveStatus === 'saving' && '⟳ 저장 중…'}
              {saveStatus === 'error' && '⚠ 저장 실패'}
              {saveStatus === 'conflict' && '⚠ 개정 충돌'}
            </span>
          </div>

          {/* 액션 버튼 그룹 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn small"
              onClick={handleCopySummary}
              style={{
                backgroundColor: '#F1F5F9',
                color: '#334155',
                border: '1px solid #CBD5E1',
              }}
            >
              {copied ? '✓ 복사완료' : '📋 품의요약 복사'}
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => ensureSavedBeforeDownload('hwpx')}
              style={{
                backgroundColor: '#2563EB',
                color: '#FFFFFF',
              }}
            >
              한글(.hwpx) 받기
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => ensureSavedBeforeDownload('docx')}
              style={{
                backgroundColor: '#1E3A8A',
                color: '#FFFFFF',
              }}
            >
              Word(.docx) 받기
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => ensureSavedBeforeDownload('pdf')}
              style={{
                backgroundColor: '#0F172A',
                color: '#FFFFFF',
              }}
            >
              PDF 받기
            </button>
            <a
              href={packagingHref()}
              className="btn small"
              style={{
                textDecoration: 'none',
                backgroundColor: '#F97316',
                color: '#FFFFFF',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              포장·스티커 꾸미기 ›
            </a>
            <button
              type="button"
              onClick={handleDelete}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 6px',
              }}
              title="초안 삭제"
            >
              삭제
            </button>
          </div>
        </div>

        {errorMessage && (
          <div
            style={{
              maxWidth: 1400,
              margin: '8px auto 0',
              padding: '8px 12px',
              backgroundColor: '#FEF2F2',
              color: '#991B1B',
              fontSize: 13,
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{errorMessage}</span>
            {saveStatus === 'conflict' ? (
              <button
                type="button"
                className="btn small"
                onClick={() => window.location.reload()}
                style={{ marginLeft: 8 }}
              >
                새로고침
              </button>
            ) : (
              <button
                type="button"
                className="btn small"
                onClick={() => void flushSave()}
                style={{ marginLeft: 8 }}
              >
                다시 시도
              </button>
            )}
          </div>
        )}
      </header>

      {/* 모바일 탭 바 (화면이 좁을 때만 노출) */}
      <div className="mobile-view-tabs" style={{ display: 'none', backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0', padding: 4 }}>
        <button
          type="button"
          onClick={() => setActiveTab('input')}
          style={{
            flex: 1,
            padding: '8px',
            border: 'none',
            background: activeTab === 'input' ? '#F1F5F9' : '#FFFFFF',
            fontWeight: activeTab === 'input' ? 700 : 400,
            borderRadius: 4,
          }}
        >
          ✏️ 보완 입력
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          style={{
            flex: 1,
            padding: '8px',
            border: 'none',
            background: activeTab === 'preview' ? '#F1F5F9' : '#FFFFFF',
            fontWeight: activeTab === 'preview' ? 700 : 400,
            borderRadius: 4,
          }}
        >
          📄 A4 미리보기
        </button>
      </div>

      {/* 메인 2열 그리드 컨테이너 */}
      <main
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '20px 16px',
          display: 'grid',
          gridTemplateColumns: 'minmax(340px, 440px) 1fr',
          gap: 24,
          alignItems: 'flex-start',
        }}
        className="approval-grid"
      >
        {/* 좌측 패널: 보완 입력 및 대안 선택 */}
        <section
          className="approval-form-panel"
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #E2E8F0',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {/* 1. 대안(후보) 선택 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
              선택안 결정 (비교 대안 중 1건 선택)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draft.source.candidates.map((c) => {
                const isSelected = c.productNo === draft.editable.selectedProductNo;
                return (
                  <button
                    key={c.productNo}
                    type="button"
                    onClick={() => handleFieldChange('selectedProductNo', c.productNo)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: isSelected ? '2px solid #1E3A8A' : '1px solid #CBD5E1',
                      backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <input
                      type="radio"
                      name="selectedCandidate"
                      checked={isSelected}
                      readOnly
                      style={{ cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#1E3A8A' : '#475569' }}>
                          {c.rank === 1 ? '1안(추천)' : `${c.rank}안`}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748B' }}>
                          {c.tier} · {c.model === 'core-contract-v1' ? `추천점수 ${(c.recommendationScore ?? c.matchScore).toFixed(1)}` : Math.round(c.matchScore)}점
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                        {c.productName}
                      </div>
                      <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>
                        단가 <b>{won(c.price)}</b> × {draft.editable.quantity}개 = {won(c.price * draft.editable.quantity)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 수량 보완 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              수량 (개)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={1}
                max={100000}
                value={draft.editable.quantity}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (Number.isInteger(val) && val >= 1) {
                    handleFieldChange('quantity', val);
                  }
                }}
                className="num-input"
                style={{
                  width: 120,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 14,
                }}
              />
              <span style={{ fontSize: 13, color: '#64748B' }}>
                합계: <b>{won(model.itemTotal)}</b>
              </span>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #F1F5F9', margin: '4px 0' }} />

          {/* 3. 공식 행사명 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              공식 행사명 <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="text"
              value={draft.editable.eventName}
              onChange={(e) => handleFieldChange('eventName', e.target.value)}
              placeholder="예: 2026년도 하반기 정례 표창 답례품 선정"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 4. 행사일 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              행사일 (선택)
            </label>
            <input
              type="date"
              value={draft.editable.eventDate || ''}
              onChange={(e) => handleFieldChange('eventDate', e.target.value || null)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 5. 기관 / 부서 / 기안자 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                소속 기관
              </label>
              <input
                type="text"
                value={draft.editable.organization}
                onChange={(e) => handleFieldChange('organization', e.target.value)}
                placeholder="예: 서울시청"
                style={{
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 12,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                부서 / 담당
              </label>
              <input
                type="text"
                value={draft.editable.department}
                onChange={(e) => handleFieldChange('department', e.target.value)}
                placeholder="예: 총무과"
                style={{
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 12,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                기안자 성명/직급
              </label>
              <input
                type="text"
                value={draft.editable.author}
                onChange={(e) => handleFieldChange('author', e.target.value)}
                placeholder="예: 홍길동 주무관"
                style={{
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 12,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* 6. 추진 목적 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              추진 목적
            </label>
            <textarea
              rows={2}
              value={draft.editable.purpose}
              onChange={(e) => handleFieldChange('purpose', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 12,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          {/* 7. 작성자 추가 의견 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              작성자 추가 의견 (선택)
            </label>
            <textarea
              rows={2}
              value={draft.editable.additionalNote}
              onChange={(e) => handleFieldChange('additionalNote', e.target.value)}
              placeholder="예: 친환경 포장 필수, 예산 절감 검토 등 (선택안을 변경해도 메모는 보존됩니다)"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 12,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          {/* 8. 내부 가액 기준 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              내부 1인당 가액 상한 (선택)
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                value={draft.editable.internalPerPersonLimit ?? ''}
                onChange={(e) => {
                  const v = e.target.value ? parseInt(e.target.value, 10) : null;
                  handleFieldChange('internalPerPersonLimit', v);
                }}
                placeholder="예: 50000"
                style={{
                  width: 140,
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                }}
              />
              <span style={{ fontSize: 13, color: '#64748B' }}>원</span>
            </div>
            <input
              type="text"
              value={draft.editable.internalRuleMemo}
              onChange={(e) => handleFieldChange('internalRuleMemo', e.target.value)}
              placeholder="가액 근거 메모 (예: 공무원 행동강령 제17조)"
              style={{
                width: '100%',
                marginTop: 6,
                padding: '7px 8px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 9. 결재란 직책 설정 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              결재란 직책명 (쉼표 구분)
            </label>
            <input
              type="text"
              value={draft.editable.approverTitles.join(', ')}
              onChange={(e) => {
                const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                handleFieldChange('approverTitles', parts);
              }}
              placeholder="예: 담당, 팀장, 과장 (비우면 결재란 숨김)"
              style={{
                width: '100%',
                padding: '7px 8px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 구분선 */}
          <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '4px 0' }} />

          {/* 10. 선택형 확인 안내 (자가 확인 체크리스트) */}
          <div
            style={{
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>📋</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                투명한 행정과 집행을 위해 다음 사항을 확인하세요.
              </span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: '#64748B', lineHeight: '1.4' }}>
              ※ 작성자의 자체 확인을 돕기 위한 항목이며, 선택하지 않아도 문서 다운로드 및 다음 단계 진행이 가능합니다.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 법규(청탁금지법) */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  backgroundColor: '#FFFFFF',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: isAntiGraftChecked ? '1px solid #94A3B8' : '1px solid #E2E8F0',
                }}
              >
                <input
                  type="checkbox"
                  checked={isAntiGraftChecked}
                  onChange={(e) => handleComplianceCheckChange('antiGraft', e.target.checked)}
                  style={{
                    marginTop: 2,
                    cursor: 'pointer',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', marginBottom: 2 }}>
                    법규(청탁금지법)
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: '1.45', wordBreak: 'keep-all' }}>
                    청탁금지법상 원활한 직무수행·사교·의례 목적 가액 범위 해당 여부 내부 확인 필요
                  </div>
                </div>
              </label>

              {/* 선거 관련 규정 */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  backgroundColor: '#FFFFFF',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: isElectionLawChecked ? '1px solid #94A3B8' : '1px solid #E2E8F0',
                }}
              >
                <input
                  type="checkbox"
                  checked={isElectionLawChecked}
                  onChange={(e) => handleComplianceCheckChange('electionLaw', e.target.checked)}
                  style={{
                    marginTop: 2,
                    cursor: 'pointer',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', marginBottom: 2 }}>
                    선거 관련 규정
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: '1.45', wordBreak: 'keep-all' }}>
                    공직선거법 등 관련 법령상 기부행위 제한 대상 여부 내부 확인 필요
                  </div>
                </div>
              </label>

              {/* 계약 근거 */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  backgroundColor: '#FFFFFF',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: isContractChecked ? '1px solid #94A3B8' : '1px solid #E2E8F0',
                }}
              >
                <input
                  type="checkbox"
                  checked={isContractChecked}
                  onChange={(e) => handleComplianceCheckChange('contract', e.target.checked)}
                  style={{
                    marginTop: 2,
                    cursor: 'pointer',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', marginBottom: 2 }}>
                    계약 근거
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: '1.45', wordBreak: 'keep-all' }}>
                    기관 계약 규정 및 수의계약 한도·지출 증빙 요건 확인 필요
                  </div>
                </div>
              </label>
            </div>
          </div>
        </section>

        {/* 우측 패널: A4 실시간 미리보기 */}
        <section className="approval-preview-panel">
          <ApprovalPreview model={model} />
        </section>
      </main>

      <style jsx>{`
        @media (max-width: 900px) {
          .approval-grid {
            grid-template-columns: 1fr !important;
          }
          .mobile-view-tabs {
            display: flex !important;
          }
          .approval-form-panel {
            display: ${activeTab === 'input' ? 'flex' : 'none'} !important;
          }
          .approval-preview-panel {
            display: ${activeTab === 'preview' ? 'block' : 'none'} !important;
          }
        }
      `}</style>
    </div>
  );
}
