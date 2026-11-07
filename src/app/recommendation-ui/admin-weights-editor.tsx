'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  EventId,
  FactorId,
  PolicyDocument,
  PurposeId,
  RecommendationPolicy,
  RecommendationServices,
  RelationId,
  SenderId,
} from '../../recommendation/contracts.ts';
import {
  EVENT_IDS,
  FACTOR_IDS,
  PURPOSE_IDS,
  RELATION_IDS,
  SENDER_IDS,
} from '../../recommendation/contracts.ts';
import {
  EVENT_NAMES,
  FACTOR_NAMES,
  PURPOSE_NAMES,
  RELATION_NAMES,
  SENDER_NAMES,
} from './types.ts';

export interface AdminWeightsEditorProps {
  services: RecommendationServices;
  initialPolicyDoc?: PolicyDocument;
}

export function CoreAdminWeightsEditor({ services, initialPolicyDoc }: AdminWeightsEditorProps) {
  const [doc, setDoc] = useState<PolicyDocument | null>(initialPolicyDoc ?? null);
  const [policy, setPolicyState] = useState<RecommendationPolicy | null>(
    initialPolicyDoc ? structuredClone(initialPolicyDoc.policy) : null,
  );
  const editVersionRef = useRef(0);
  const setPolicy = (next: RecommendationPolicy) => {
    editVersionRef.current++;
    setPolicyState(next);
    setSuccessMessage(null);
  };
  const [loading, setLoading] = useState(!initialPolicyDoc);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictRemote, setConflictRemote] = useState<PolicyDocument | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchPolicy = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await services.loadPolicy();
      setLoading(false);
      if (!res.ok) {
        setLoadError(`[${res.error.code}] ${res.error.message}`);
      } else {
        setDoc(res.data);
        setPolicyState(structuredClone(res.data.policy));
      }
    } catch (err) {
      setLoading(false);
      setLoadError(err instanceof Error ? err.message : '정책 데이터를 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    if (!initialPolicyDoc) {
      fetchPolicy();
    }
  }, [services, initialPolicyDoc]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center' }}>정책 데이터를 불러오는 중…</div>;
  }

  if (loadError) {
    return (
      <div style={{ padding: 24, maxWidth: 600, margin: '40px auto', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, color: '#DC2626', margin: '0 0 8px' }}>정책 데이터를 불러오지 못했습니다</h2>
        <p style={{ fontSize: 14, color: 'var(--ink, #333)', margin: '0 0 16px' }}>{loadError}</p>
        <button
          type="button"
          onClick={fetchPolicy}
          style={{ padding: '8px 16px', borderRadius: 6, background: '#DC2626', color: '#FFF', border: 'none', fontWeight: 600, cursor: 'pointer' }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!policy) return null;

  // 저장 처리: force 우회 경로 일절 없음 [P1-3]
  const handleSave = async () => {
    if (!doc) return;

    // 검증: 최소 유효 근거 수 범위 확인 (공통 파서와 일치: 2~5개) [P2-6, P2-8]
    if (policy.minimumEvidenceCount < 2 || policy.minimumEvidenceCount > 5) {
      setSaveError('최소 유효 근거 수는 2개 이상 5개 이하여야 합니다.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setConflictRemote(null);
    setSuccessMessage(null);

    const expectedUpdatedAt = doc.updatedAt;
    const requestedEditVersion = editVersionRef.current;
    try {
      const res = await services.savePolicy({
        policy,
        expectedUpdatedAt,
      });

      setSaving(false);
      if (!res.ok) {
        if (res.error.code === 'revision_conflict') {
          // 충돌 시 원격 최신 데이터 확인
          services.loadPolicy().then((latest) => {
            if (latest.ok) setConflictRemote(latest.data);
          });
        }
        setSaveError(res.error.message);
      } else {
        setDoc(res.data);
        const hasNewEdits = editVersionRef.current !== requestedEditVersion;
        if (!hasNewEdits) setPolicyState(structuredClone(res.data.policy));
        setSuccessMessage(hasNewEdits ? '요청한 설정은 저장했습니다. 이후 수정한 설정은 아직 저장되지 않았습니다.' : '추천 가중치 및 기준 설정을 저장했습니다.');
      }
    } catch (err) {
      setSaving(false);
      setSaveError(err instanceof Error ? err.message : '저장 통신 오류입니다.');
    }
  };

  // 충돌 해결: 현재 사용자 입력(policy)을 보존한 채 최신 updatedAt을 수락하여 재저장 준비 [P1-3]
  const handleAcceptLatestRevision = () => {
    if (!conflictRemote) return;
    setDoc({
      ...doc!,
      updatedAt: conflictRemote.updatedAt,
    });
    setConflictRemote(null);
    setSaveError(null);
    setSuccessMessage('서버의 최신 개정 번호를 수락했습니다. 저장 버튼을 누르면 정상 저장됩니다.');
  };

  return (
    <div className="admin-weights-editor" style={{ display: 'grid', gap: 20, maxWidth: 840, margin: '0 auto' }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>추천 엔진 기준 및 가중치 설정</h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft, #555)' }}>
          행사 격식 기준, 5대 희소 속성 가중치, 그리고 2차 추천점수(E/V) 비중을 설정합니다.
        </p>
      </header>

      {/* 성공/오류 알림 */}
      {successMessage && (
        <div style={{ padding: '10px 14px', background: '#ECFDF5', color: '#047857', borderRadius: 6, fontSize: 13 }}>
          {successMessage}
        </div>
      )}

      {/* 충돌 안내 및 해결 패널 (강제 덮어쓰기 완전 제거) [P1-3] */}
      {conflictRemote && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 6,
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            color: '#B45309',
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠️ 정책 개정 충돌: 다른 관리자가 이미 정책 기준을 수정했습니다.
          </div>
          <div style={{ marginBottom: 8 }}>
            작성 중이신 설정값은 안전하게 보존되었습니다. 서버의 최신 갱신 시각: {conflictRemote.updatedAt}
          </div>
          <button
            type="button"
            onClick={handleAcceptLatestRevision}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              background: '#B45309',
              color: '#FFF',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            내 설정 유지한 채 최신 개정 수락 (재저장 준비)
          </button>
        </div>
      )}

      {saveError && !conflictRemote && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', color: '#DC2626', borderRadius: 6, fontSize: 13 }}>
          <b>저장 실패:</b> {saveError} (작성하신 설정은 안전하게 보존되었습니다)
        </div>
      )}

      {/* 1. 추천점수(S) 가중치 설정 (E vs V) */}
      <section style={{ padding: '18px 20px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px' }}>
          종합 추천점수 산식 가중치 (E / V)
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>행사 적합도(E) 비중</span>
            <input
              type="number"
              min={0}
              max={100}
              value={policy.scoreWeights.eventFit}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  scoreWeights: { ...policy.scoreWeights, eventFit: e.target.value === '' ? 0 : Number(e.target.value) },
                })
              }
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line, #E6E1D8)', fontSize: 14 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>가격 실속(V) 비중</span>
            <input
              type="number"
              min={0}
              max={100}
              value={policy.scoreWeights.priceValue}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  scoreWeights: { ...policy.scoreWeights, priceValue: e.target.value === '' ? 0 : Number(e.target.value) },
                })
              }
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line, #E6E1D8)', fontSize: 14 }}
            />
          </label>
        </div>
      </section>

      {/* 2. 상품 희소 속성 가중치 (5대 속성) */}
      <section style={{ padding: '18px 20px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>5대 희소 속성 가중치</h2>
        <p style={{ fontSize: 12, color: 'var(--muted, #666)', margin: '0 0 14px' }}>
          희소값 R = 10 × Σ(속성점수 × 가중치) / Σ(가중치) 계산에 반영됩니다.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          {FACTOR_IDS.map((f) => (
            <label key={f} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{FACTOR_NAMES[f]}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={policy.rarityWeights[f] ?? 1}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    rarityWeights: { ...policy.rarityWeights, [f]: e.target.value === '' ? 0 : Number(e.target.value) },
                  })
                }
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line, #E6E1D8)', fontSize: 14 }}
              />
            </label>
          ))}
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line, #E6E1D8)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>최소 유효 근거 수 (개):</span>
            <input
              type="number"
              min={2}
              max={5}
              value={policy.minimumEvidenceCount}
              onChange={(e) => {
                const val = e.target.value === '' ? 2 : Number(e.target.value);
                setPolicy({
                  ...policy,
                  minimumEvidenceCount: val,
                });
              }}
              style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line, #E6E1D8)', fontSize: 14 }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted, #888)' }}>
              (공통 규격상 최소 2개 이상 5개 이하 필수)
            </span>
          </label>
        </div>
      </section>

      {/* 3. 행사 기준 점수 (eventBase) */}
      <section style={{ padding: '18px 20px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>행사별 기본 격식 점수 (F)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {EVENT_IDS.map((e) => (
            <label key={e} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft, #555)' }}>{EVENT_NAMES[e]}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={policy.eventBase[e] ?? 70}
                onChange={(ev) =>
                  setPolicy({
                    ...policy,
                    eventBase: { ...policy.eventBase, [e]: ev.target.value === '' ? 0 : Number(ev.target.value) },
                  })
                }
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line, #E6E1D8)', fontSize: 13 }}
              />
            </label>
          ))}
        </div>
      </section>

      {/* 4. 관계 보정 (relationShift) */}
      <section style={{ padding: '18px 20px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>받는 분 관계 보정값</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {RELATION_IDS.map((r) => (
            <label key={r} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft, #555)' }}>{RELATION_NAMES[r]}</span>
              <input
                type="number"
                min={-50}
                max={50}
                value={policy.relationShift[r] ?? 0}
                onChange={(ev) =>
                  setPolicy({
                    ...policy,
                    relationShift: { ...policy.relationShift, [r]: ev.target.value === '' ? 0 : Number(ev.target.value) },
                  })
                }
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line, #E6E1D8)', fontSize: 13 }}
              />
            </label>
          ))}
        </div>
      </section>

      {/* 저장 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '12px 24px',
            borderRadius: 6,
            background: 'var(--pine, #2D5A43)',
            color: '#FFF',
            border: 'none',
            fontSize: 15,
            fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '저장 중…' : '가중치 및 기준 저장'}
        </button>
      </div>
    </div>
  );
}
