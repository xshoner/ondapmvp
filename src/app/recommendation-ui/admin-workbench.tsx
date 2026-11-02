'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminWorkspace,
  FactorAssessment,
  FactorId,
  ProductAssessment,
  RecommendationServices,
} from '../../recommendation/contracts.ts';
import { FACTOR_IDS } from '../../recommendation/contracts.ts';
import { FACTOR_NAMES, won } from './types.ts';

export interface AdminWorkbenchProps {
  services: RecommendationServices;
  initialWorkspace?: AdminWorkspace;
  loadDescription?: (productNo: number) => Promise<{ ok: boolean; text?: string; error?: string }>;
}

async function fetchDescriptionDefault(no: number): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const mod = await import('../admin/formality/intake-actions.ts');
    return await mod.loadDescription(no);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '상품 설명 조회 실패' };
  }
}

export function CoreAdminWorkbench({ services, initialWorkspace, loadDescription: loadDescriptionProp }: AdminWorkbenchProps) {
  const [workspace, setWorkspace] = useState<AdminWorkspace | null>(initialWorkspace ?? null);
  const [workspaceLoading, setWorkspaceLoading] = useState(!initialWorkspace);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [selectedNo, setSelectedNo] = useState<number>(initialWorkspace?.products[0]?.productNo ?? 0);
  const [filter, setFilter] = useState<'all' | 'reviewed' | 'unreviewed'>('all');
  const [search, setSearch] = useState('');

  // 상품별 미저장 작성 초안 보관 맵: 상품 전환 시에도 입력 내용 유실 방지 [P1-2]
  const draftsByProductRef = useRef<Map<number, ProductAssessment>>(new Map());
  const editVersionsRef = useRef(new Map<number, number>());
  const loadedProductRef = useRef<number | null>(initialWorkspace?.products[0]?.productNo ?? null);

  const getInitialDraft = (): ProductAssessment | null => {
    if (!initialWorkspace || initialWorkspace.products.length === 0) return null;
    const pNo = initialWorkspace.products[0].productNo;
    const existing = initialWorkspace.assessments.find((a) => a.productNo === pNo);
    if (existing) return structuredClone(existing);
    const prod = initialWorkspace.products[0];
    const rVersion = initialWorkspace.rubric.version ?? 'numeric-draft-1';
    const factors = Object.fromEntries(
      FACTOR_IDS.map((f) => [
        f,
        { score: null, basis: '', method: 'numeric', rubricVersion: rVersion } as FactorAssessment,
      ]),
    ) as Record<FactorId, FactorAssessment>;
    return {
      productNo: pNo,
      description: prod?.name ?? '',
      factors,
      reviewed: false,
      updatedAt: null,
      reviewedAt: null,
    };
  };

  // 현재 선택된 상품의 편집 초안
  const [draft, setDraft] = useState<ProductAssessment | null>(getInitialDraft);
  const [dirty, setDirty] = useState(false);

  // 충돌 발생 시 원격 최신 데이터 보관
  const [conflictRemote, setConflictRemote] = useState<ProductAssessment | null>(null);

  // 비동기 요청 추적 및 세대 번호 (Race condition 방어)
  const activeProductNoRef = useRef(selectedNo);
  activeProductNoRef.current = selectedNo;
  const aiReqIdRef = useRef(0);
  const saveReqIdRef = useRef(0);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestedKeys, setAiSuggestedKeys] = useState<Set<FactorId>>(new Set());

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // 카페24 상세 설명 자동 조회 및 비동기 추적 [Requirement 1]
  const descReqIdRef = useRef(0);
  const [descLoading, setDescLoading] = useState(false);
  const [descNotice, setDescNotice] = useState<{ type: 'diff' | 'applied' | 'empty' | 'error'; message: string } | null>(null);
  const [latestCafe24Desc, setLatestCafe24Desc] = useState<string | null>(null);

  // 1. 초기 작업공간 로드 (오류 및 재시도 상태 완비) [P2-7]
  const loadWorkspaceData = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const res = await services.loadWorkspace();
      setWorkspaceLoading(false);
      if (!res.ok) {
        setWorkspaceError(`[${res.error.code}] ${res.error.message}`);
      } else {
        setWorkspace(res.data);
        if (res.data.products.length > 0 && selectedNo === 0) {
          setSelectedNo(res.data.products[0].productNo);
        }
      }
    } catch (err) {
      setWorkspaceLoading(false);
      setWorkspaceError(err instanceof Error ? err.message : '작업공간 통신 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    if (!initialWorkspace) {
      loadWorkspaceData();
    }
  }, [services, initialWorkspace]);

  // 기본 빈 평가 생성 헬퍼
  const createEmptyAssessment = (pNo: number, desc = ''): ProductAssessment => {
    const rVersion = workspace?.rubric.version ?? 'numeric-draft-1';
    const factors = Object.fromEntries(
      FACTOR_IDS.map((f) => [
        f,
        { score: null, basis: '', method: 'numeric', rubricVersion: rVersion } as FactorAssessment,
      ]),
    ) as Record<FactorId, FactorAssessment>;
    return {
      productNo: pNo,
      description: desc,
      factors,
      reviewed: false,
      updatedAt: null,
      reviewedAt: null,
    };
  };

  // 2. 상품 선택 변경 시 draft 동기화: 보관된 초안이 있으면 복원하여 입력 유실 방지 [P1-2]
  useEffect(() => {
    if (!workspace || selectedNo === 0) return;
    // 저장 기준 갱신으로 현재 입력·상태를 다시 초기화하지 않는다.
    if (loadedProductRef.current === selectedNo) return;
    loadedProductRef.current = selectedNo;

    // 만약 이 상품에 대해 이미 작성 중인 초안이 메모리에 보관되어 있다면 그것을 우선 복원
    if (draftsByProductRef.current.has(selectedNo)) {
      setDraft(structuredClone(draftsByProductRef.current.get(selectedNo)!));
      setDirty(true);
    } else {
      const existing = workspace.assessments.find((a) => a.productNo === selectedNo);
      if (existing) {
        setDraft(structuredClone(existing));
      } else {
        const prod = workspace.products.find((p) => p.productNo === selectedNo);
        setDraft(createEmptyAssessment(selectedNo, prod?.name ?? ''));
      }
      setDirty(false);
    }

    setAiError(null);
    setSaveError(null);
    setConflictRemote(null);
    setStatusMessage(null);
    setAiSuggestedKeys(new Set());
    setDescNotice(null);
    setLatestCafe24Desc(null);

    // 상품 선택 시 카페24 상세 설명 자동 조회 트리거
    fetchCafe24Description(selectedNo);
  }, [selectedNo, workspace]);

  const selectedProduct = workspace?.products.find((p) => p.productNo === selectedNo);

  // 초안 업데이트 헬퍼 (상품별 맵에도 즉시 반영하여 전환 시 보존)
  const updateDraft = (next: ProductAssessment) => {
    editVersionsRef.current.set(next.productNo, (editVersionsRef.current.get(next.productNo) ?? 0) + 1);
    setDraft(next);
    setDirty(true);
    draftsByProductRef.current.set(next.productNo, structuredClone(next));
    setStatusMessage(null);
  };

  const updateBaseline = (assessment: ProductAssessment) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const assessments = prev.assessments.some((a) => a.productNo === assessment.productNo)
        ? prev.assessments.map((a) => a.productNo === assessment.productNo ? structuredClone(assessment) : a)
        : [...prev.assessments, structuredClone(assessment)];
      return { ...prev, assessments };
    });
  };

  // 카페24 상품 상세 설명 자동 조회 (레이스 컨디션 및 기존 자료 덮어쓰기 방어) [Requirement 1]
  const fetchCafe24Description = async (targetProductNo: number) => {
    if (!targetProductNo || targetProductNo === 0) return;
    const currentDescReqId = ++descReqIdRef.current;
    setDescLoading(true);
    setDescNotice(null);
    setLatestCafe24Desc(null);

    try {
      const fetchFn = loadDescriptionProp ?? fetchDescriptionDefault;
      const res = await fetchFn(targetProductNo);

      // 비동기 지연 응답 방어: 다른 상품으로 전환되었거나 이전 요청이면 무시
      if (currentDescReqId !== descReqIdRef.current || activeProductNoRef.current !== targetProductNo) {
        return;
      }
      setDescLoading(false);

      if (!res.ok) {
        setDescNotice({ type: 'error', message: res.error || '카페24 상세 설명 조회에 실패했습니다.' });
        return;
      }

      const fetchedText = (res.text ?? '').trim();
      if (!fetchedText) {
        setDescNotice({ type: 'empty', message: '카페24에 등록된 상품 상세 설명이 없습니다.' });
        return;
      }

      // 기존 사용자 작성 초안, 검수 완료 데이터, 또는 저장된 설명이 있는지 확인
      const curDraft = draftsByProductRef.current.get(targetProductNo) ?? draft;
      const curDesc = (curDraft?.description ?? '').trim();
      const existing = workspace?.assessments.find((a) => a.productNo === targetProductNo);
      const prod = workspace?.products.find((p) => p.productNo === targetProductNo);
      const defaultDesc = prod?.name?.trim() ?? '';
      const hasSavedContent = Boolean(existing && existing.description?.trim() && existing.description.trim() !== defaultDesc);
      const isReviewed = Boolean(curDraft?.reviewed || existing?.reviewed);
      const hasUnsavedEdits = draftsByProductRef.current.has(targetProductNo);

      // 기존 검수 자료나 저장/작성된 내용이 이미 있는 경우 자동으로 덮어쓰지 않고 관리자가 선택할 수 있는 버튼 제공
      if (isReviewed || hasUnsavedEdits || hasSavedContent || (curDesc && curDesc !== defaultDesc)) {
        if (fetchedText !== curDesc) {
          setLatestCafe24Desc(fetchedText);
          setDescNotice({ type: 'diff', message: '카페24에 최신 상세 설명이 있습니다.' });
        }
      } else {
        // 미검수 및 초기 기본 상태인 경우에만 안전하게 자동 채움
        const nextDraft: ProductAssessment = {
          ...(curDraft ?? createEmptyAssessment(targetProductNo, fetchedText)),
          description: fetchedText,
        };
        draftsByProductRef.current.set(targetProductNo, structuredClone(nextDraft));
        if (activeProductNoRef.current === targetProductNo) {
          setDraft(nextDraft);
          setDescNotice({ type: 'applied', message: '카페24 최신 상세 설명을 불러왔습니다.' });
        }
      }
    } catch (err) {
      if (currentDescReqId !== descReqIdRef.current || activeProductNoRef.current !== targetProductNo) return;
      setDescLoading(false);
      setDescNotice({
        type: 'error',
        message: err instanceof Error ? err.message : '카페24 상세 설명 조회 중 오류가 발생했습니다.',
      });
    }
  };

  const handleApplyCafe24Desc = () => {
    if (!latestCafe24Desc || !draft) return;
    updateDraft({
      ...draft,
      description: latestCafe24Desc,
    });
    setLatestCafe24Desc(null);
    setDescNotice({ type: 'applied', message: '카페24 최신 상세 설명을 적용했습니다.' });
  };

  // 3. 지표 통계 계산 (실시간 프리뷰)
  const stats = useMemo(() => {
    if (!draft || !workspace) return { evidenceCount: 0, rarityValue: 0, method: 'numeric' as const };
    const policy = workspace.policy.policy;

    const used = FACTOR_IDS.flatMap((id) => {
      const f = draft.factors[id];
      const weight = policy.rarityWeights[id] ?? 1;
      return f.score !== null && f.basis.trim() && weight > 0 && (f.method === 'legacy-level' || f.rubricVersion?.trim())
        ? [{ score: f.score, weight, method: f.method }]
        : [];
    });

    const evidenceCount = used.length;
    const totalWeight = used.reduce((s, f) => s + f.weight, 0);
    const rarityValue =
      totalWeight > 0 ? Math.round((10 * used.reduce((s, f) => s + f.score * f.weight, 0)) / totalWeight * 10) / 10 : 0;

    const methods = new Set(used.map((f) => f.method));
    const method = methods.size > 1 ? ('mixed' as const) : used[0]?.method ?? ('numeric' as const);

    return { evidenceCount, rarityValue, method };
  }, [draft, workspace]);

  // 4. 점수 변경: 점수를 새로 지정하면 method = 'numeric'으로 판정 갱신 [P1-4]
  const handleScoreChange = (factorId: FactorId, score: number | null) => {
    if (!draft || !workspace) return;
    const prev = draft.factors[factorId];
    updateDraft({
      ...draft,
      factors: {
        ...draft.factors,
        [factorId]: {
          ...prev,
          score,
          method: 'numeric', // 수치 재평가이므로 신규 수치형으로 전환
          rubricVersion: workspace.rubric.version,
        },
      },
    });
  };

  // 5. 근거 텍스트 변경: 과거 평가의 근거 문장만 수정할 때는 method를 numeric으로 왜곡하지 않고 기존 method 유지 [P1-4]
  const handleBasisChange = (factorId: FactorId, basis: string) => {
    if (!draft || !workspace) return;
    const prev = draft.factors[factorId];
    updateDraft({
      ...draft,
      factors: {
        ...draft.factors,
        [factorId]: {
          ...prev,
          basis,
          // 과거 방식(legacy-level) 근거 문장 수정 시 method를 유지함
          method: prev.method,
          rubricVersion: prev.method === 'numeric' ? workspace.rubric.version : prev.rubricVersion,
        },
      },
    });
  };

  // 6. 상품 원자료 description 변경 [P1-4]
  const handleDescriptionChange = (desc: string) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      description: desc,
    });
  };

  // 7. AI 제안 요청: 세대 번호 확인 및 유효 제안만 선택 병합 (미확인 null로 기존 근거 삭제 금지) [P1-2, P1-4]
  const handleAiSuggest = async () => {
    if (!draft || !selectedProduct) return;
    const targetProductNo = selectedProduct.productNo;
    const currentAiReqId = ++aiReqIdRef.current;
    const requestedEditVersion = editVersionsRef.current.get(targetProductNo) ?? 0;

    const rawDesc = draft.description?.trim() || '';
    if (!rawDesc) {
      setAiError('상품 상세 설명 원자료가 비어 있습니다. 원자료를 입력하거나 확인한 후 AI 분석을 실행하세요.');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setStatusMessage(null);

    try {
      const res = await services.suggestAssessment({
        productNo: targetProductNo,
        description: rawDesc,
      });

      // 늦게 도착했거나 다른 상품으로 전환된 경우 처리 방어
      if (currentAiReqId !== aiReqIdRef.current) return;
      setAiLoading(false);

      if (!res.ok) {
        // AI 실패 시 기존 작성 내용 안전 보존
        if (activeProductNoRef.current === targetProductNo) setAiError(res.error.message);
      } else {
        if ((editVersionsRef.current.get(targetProductNo) ?? 0) !== requestedEditVersion) {
          if (activeProductNoRef.current === targetProductNo) setStatusMessage('AI 분석 중 작성 내용이 변경되어 제안을 적용하지 않았습니다. 현재 내용으로 다시 분석해 주세요.');
          return;
        }
        const suggestion = res.data;
        const currentTargetDraft = draftsByProductRef.current.get(targetProductNo) ?? draft;
        const nextFactors = { ...currentTargetDraft.factors };
        const appliedKeys = new Set<FactorId>();

        // [핵심]: 유효한 제안(score !== null 및 basis 존재)만 선택 반영하며, AI 미확인(null) 항목으로 기존 자료를 덮어쓰지 않음
        for (const id of FACTOR_IDS) {
          const s = suggestion.factors[id];
          if (s && s.score !== null && typeof s.score === 'number' && s.basis?.trim()) {
            nextFactors[id] = { ...s };
            appliedKeys.add(id);
          }
        }

        const nextDraft: ProductAssessment = {
          ...currentTargetDraft,
          factors: nextFactors,
        };

        draftsByProductRef.current.set(targetProductNo, structuredClone(nextDraft));
        editVersionsRef.current.set(targetProductNo, requestedEditVersion + 1);

        // 현재 보고 있는 상품과 일치할 때만 화면 상태 갱신
        if (activeProductNoRef.current === targetProductNo) {
          setDraft(nextDraft);
          setAiSuggestedKeys(appliedKeys);
          setDirty(true);
          setStatusMessage(
            appliedKeys.size > 0
              ? `AI 제안 (${appliedKeys.size}개 속성)을 반영했습니다. 내용을 검토한 후 저장해 주세요.`
              : '원자료에서 새로 확인할 수 있는 추가 근거가 없어 기존 평가를 유지했습니다.',
          );
        }
      }
    } catch (err) {
      if (currentAiReqId !== aiReqIdRef.current) return;
      setAiLoading(false);
      if (activeProductNoRef.current === targetProductNo) setAiError(err instanceof Error ? err.message : 'AI 제안 서비스 통신 오류입니다.');
    }
  };

  // 8. 저장 처리: 강제 덮어쓰기 경로(null 우회) 일절 배제 [P1-3]
  const handleSave = async (markReviewed: boolean) => {
    if (!draft || !workspace) return;
    const targetProductNo = draft.productNo;
    const currentSaveReqId = ++saveReqIdRef.current;
    const requestedEditVersion = editVersionsRef.current.get(targetProductNo) ?? 0;

    setSaveLoading(true);
    setSaveError(null);
    setConflictRemote(null);
    setStatusMessage(null);

    // 공통 계약 준수: 기존 자료의 updatedAt을 정확히 전달 (null 강제 우회 금지)
    const expectedUpdatedAt = draft.updatedAt;

    const assessmentToSave: ProductAssessment = {
      ...draft,
      reviewed: markReviewed,
      reviewedAt: markReviewed ? (draft.reviewedAt ?? new Date().toISOString()) : null,
    };

    try {
      const res = await services.saveAssessment({
        assessment: assessmentToSave,
        expectedUpdatedAt,
      });

      if (currentSaveReqId !== saveReqIdRef.current) return;
      setSaveLoading(false);

      if (!res.ok) {
        if (activeProductNoRef.current !== targetProductNo) return;
        if (res.error.code === 'revision_conflict') {
          // 충돌 시 현재 입력은 완전히 보존하고 최신 원격 자료를 비동기 확인
          services.loadAssessment(targetProductNo).then((latestRes) => {
            if (latestRes.ok && currentSaveReqId === saveReqIdRef.current && activeProductNoRef.current === targetProductNo && latestRes.data.productNo === targetProductNo) {
              setConflictRemote(latestRes.data);
            }
          }).catch(() => {
            if (currentSaveReqId === saveReqIdRef.current && activeProductNoRef.current === targetProductNo) setSaveError('최신 평가를 읽지 못했습니다. 작성 내용을 유지하고 다시 시도해 주세요.');
          });
        }
        setSaveError(res.error.message);
        // 저장 실패 시에도 작성 내용은 draft에 온전히 보존됨!
      } else {
        const saved = res.data;

        // 저장 요청 도중 추가 입력이 있었는지 확인하여 유실 방지 [P1-2]
        const currentInMemory = draftsByProductRef.current.get(targetProductNo);
        const hasNewEdits = (editVersionsRef.current.get(targetProductNo) ?? 0) !== requestedEditVersion;
        const merged: ProductAssessment = {
          ...(hasNewEdits && currentInMemory ? currentInMemory : saved),
          updatedAt: saved.updatedAt,
          reviewedAt: saved.reviewedAt,
          reviewed: hasNewEdits ? false : saved.reviewed,
        };

        if (hasNewEdits) draftsByProductRef.current.set(targetProductNo, structuredClone(merged));
        else draftsByProductRef.current.delete(targetProductNo);

        if (activeProductNoRef.current === targetProductNo) {
          setDraft(structuredClone(merged));
          setDirty(hasNewEdits);
          setAiSuggestedKeys(new Set());
          setStatusMessage(hasNewEdits ? '요청한 내용은 저장했습니다. 이후 수정한 내용은 아직 저장되지 않았습니다.' : markReviewed ? '검수를 완료하고 저장했습니다.' : '임시 저장했습니다.');
        }

        // 워크스페이스 목록 업데이트 (최신 updatedAt 반영)
        updateBaseline(saved);
      }
    } catch (err) {
      if (currentSaveReqId !== saveReqIdRef.current) return;
      setSaveLoading(false);
      if (activeProductNoRef.current === targetProductNo) setSaveError(err instanceof Error ? err.message : '저장 통신 오류가 발생했습니다.');
    }
  };

  // 9. 충돌 해결: 현재 작성 내용을 유지한 채 최신 updatedAt으로 갱신 후 재저장 준비 [P1-3]
  const handleResolveConflictWithMyEdits = () => {
    if (!draft || !conflictRemote || conflictRemote.productNo !== draft.productNo) return;
    // 최신 서버 개정 시각을 채택하여 다음 저장 시 충돌이 나지 않도록 조정
    const resolved: ProductAssessment = {
      ...draft,
      updatedAt: conflictRemote.updatedAt,
    };
    updateDraft(resolved);
    updateBaseline(conflictRemote);
    setSaveError(null);
    setConflictRemote(null);
    setStatusMessage('최신 개정 번호를 수락했습니다. 저장 버튼을 누르면 정상 저장됩니다.');
  };

  // 충돌 시 서버 최신 내용으로 덮어쓰기 (사용자가 명시적으로 선택할 때만)
  const handleAcceptRemoteContent = () => {
    if (!draft || !conflictRemote || conflictRemote.productNo !== draft.productNo) return;
    updateDraft(structuredClone(conflictRemote));
    updateBaseline(conflictRemote);
    draftsByProductRef.current.delete(conflictRemote.productNo);
    setDirty(false);
    setSaveError(null);
    setConflictRemote(null);
    setStatusMessage('서버의 최신 내용으로 갱신했습니다.');
  };

  // 작성 내용 초기화 (저장된 상태로 되돌리기)
  const handleDiscardDraft = () => {
    if (!workspace || !draft) return;
    const existing = workspace.assessments.find((a) => a.productNo === draft.productNo);
    if (existing) {
      updateDraft(structuredClone(existing));
    } else {
      updateDraft(createEmptyAssessment(draft.productNo, selectedProduct?.name ?? ''));
    }
    draftsByProductRef.current.delete(draft.productNo);
    setDirty(false);
    setStatusMessage('저장되지 않은 작성 내용을 취소하고 원본으로 되돌렸습니다.');
  };

  if (workspaceLoading) {
    return <div style={{ padding: 24, textAlign: 'center' }}>작업공간을 불러오는 중…</div>;
  }

  if (workspaceError) {
    return (
      <div style={{ padding: 24, maxWidth: 600, margin: '40px auto', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, color: '#DC2626', margin: '0 0 8px' }}>작업공간을 불러오지 못했습니다</h2>
        <p style={{ fontSize: 14, color: 'var(--ink, #333)', margin: '0 0 16px' }}>{workspaceError}</p>
        <button
          type="button"
          onClick={loadWorkspaceData}
          style={{ padding: '8px 16px', borderRadius: 6, background: '#DC2626', color: '#FFF', border: 'none', fontWeight: 600, cursor: 'pointer' }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!workspace) return null;

  // 필터 및 검색된 상품 목록
  const filteredProducts = workspace.products.filter((p) => {
    const a = draftsByProductRef.current.get(p.productNo) ?? workspace.assessments.find((x) => x.productNo === p.productNo);
    const isReviewed = Boolean(a?.reviewed);
    if (filter === 'reviewed' && !isReviewed) return false;
    if (filter === 'unreviewed' && isReviewed) return false;
    if (search.trim() && !p.name.includes(search.trim())) return false;
    return true;
  });

  const reviewedCount = workspace.products.filter((p) => {
    const a = draftsByProductRef.current.get(p.productNo) ?? workspace.assessments.find((x) => x.productNo === p.productNo);
    return Boolean(a?.reviewed);
  }).length;

  return (
    <div className="admin-workbench" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
      {/* 좌측 사이드바: 상품 목록 */}
      <aside
        style={{
          borderRight: '1px solid var(--line, #E6E1D8)',
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>상품 목록</h2>
          <span style={{ fontSize: 12, color: 'var(--muted, #666)' }}>
            검수 {reviewedCount} / {workspace.products.length}
          </span>
        </div>

        {/* 검색창 */}
        <input
          type="text"
          placeholder="상품명 검색…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--line, #E6E1D8)',
            fontSize: 13,
          }}
        />

        {/* 상태 필터 탭 */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'unreviewed', 'reviewed'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilter(mode)}
              style={{
                flex: 1,
                padding: '4px 6px',
                borderRadius: 4,
                border: '1px solid var(--line, #E6E1D8)',
                background: filter === mode ? 'var(--pine, #2D5A43)' : '#FFF',
                color: filter === mode ? '#FFF' : 'var(--ink-soft, #555)',
                fontSize: 11,
                fontWeight: filter === mode ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {mode === 'all' ? '전체' : mode === 'unreviewed' ? '미검수' : '검수완료'}
            </button>
          ))}
        </div>

        {/* 상품 리스트 */}
        <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 220px)', display: 'grid', gap: 6 }}>
          {filteredProducts.map((p) => {
            const hasDraft = draftsByProductRef.current.has(p.productNo);
            const a = draftsByProductRef.current.get(p.productNo) ?? workspace.assessments.find((x) => x.productNo === p.productNo);
            const isReviewed = Boolean(a?.reviewed);
            const isSelected = p.productNo === selectedNo;

            return (
              <button
                key={p.productNo}
                type="button"
                data-product-btn={p.productNo}
                onClick={() => setSelectedNo(p.productNo)}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: isSelected ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                  background: isSelected ? 'var(--paper-deep, #F6F4EF)' : '#FFF',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {/* 카페24 상품 이미지 썸네일 [Requirement 1] */}
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 4,
                    overflow: 'hidden',
                    background: '#F3F4F6',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--line, #E6E1D8)',
                  }}
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt=""
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        if (e.currentTarget.parentElement) {
                          e.currentTarget.parentElement.innerHTML = '<span style="font-size:10px;color:#888;">사진없음</span>';
                        }
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--muted, #888)' }}>사진없음</span>
                  )}
                </div>

                {/* 상품 정보 (긴 상품명은 2줄까지 표시) */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted, #888)' }}>#{p.productNo}</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {hasDraft && (
                        <span style={{ fontSize: 10, color: '#D97706', fontWeight: 600 }}>✎편집중</span>
                      )}
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: isReviewed ? '#ECFDF5' : '#FEF2F2',
                          color: isReviewed ? '#047857' : '#DC2626',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {isReviewed ? '검수 완료' : '미검수'}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.35,
                      fontWeight: isSelected ? 600 : 400,
                      marginTop: 2,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #666)', marginTop: 2 }}>{won(p.price)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* 우측 본문: 5대 속성 판정 에디터 */}
      <main style={{ minWidth: 0 }}>
        {selectedProduct && draft ? (
          <div>
            {/* 상품 정보 헤더 */}
            <div
              style={{
                padding: '16px 20px',
                background: '#FFF',
                border: '1px solid var(--line, #E6E1D8)',
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted, #888)' }}>#{selectedProduct.productNo}</span>
                    <span
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: draft.reviewed ? '#ECFDF5' : '#FEF2F2',
                        color: draft.reviewed ? '#047857' : '#DC2626',
                        fontWeight: 700,
                      }}
                    >
                      {draft.reviewed ? '검수 완료' : '미검수'}
                    </span>
                    {stats.method === 'legacy-level' && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          background: '#FFFBEB',
                          color: '#B45309',
                          borderRadius: 4,
                        }}
                      >
                        과거 방식 평가 (low/medium/high 변환)
                      </span>
                    )}
                    {stats.method === 'mixed' && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          background: '#F3E8FF',
                          color: '#7E22CE',
                          borderRadius: 4,
                        }}
                      >
                        혼합 평가
                      </span>
                    )}
                    {dirty && (
                      <span style={{ fontSize: 11, padding: '2px 6px', background: '#FEF3C7', color: '#D97706', borderRadius: 4 }}>
                        미저장 변경사항 있음
                      </span>
                    )}
                  </div>
                  <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', wordBreak: 'break-word' }}>{selectedProduct.name}</h1>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft, #555)' }}>
                    판매가 {won(selectedProduct.price)} · 진열 {selectedProduct.display ? 'O' : 'X'} · 판매 {selectedProduct.selling ? 'O' : 'X'}
                  </div>
                </div>

                {/* 지표 통계 요약 박스 */}
                <div
                  style={{
                    textAlign: 'right',
                    padding: '8px 14px',
                    background: 'var(--paper-deep, #F6F4EF)',
                    borderRadius: 6,
                    minWidth: 120,
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--muted, #666)' }}>희소값 R (실시간 추정)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--pine, #2D5A43)' }}>
                    {stats.rarityValue.toFixed(1)}점
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
                    유효 근거 {stats.evidenceCount} / 5개 충족
                  </div>
                </div>
              </div>

              {/* 액션 툴바: 상품 선택·원자료·검수 완료 및 저장 버튼을 쉽게 찾고 누를 수 있도록 단순화 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--line, #E6E1D8)',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleAiSuggest}
                    disabled={aiLoading}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 6,
                      border: '1px solid #7E22CE',
                      background: '#F3E8FF',
                      color: '#7E22CE',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: aiLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {aiLoading ? 'AI 분석 중…' : '✦ AI 제안 받기'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--muted, #888)' }}>
                    ※ AI는 제안일 뿐 자동 저장되지 않습니다.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {dirty && (
                    <button
                      type="button"
                      onClick={handleDiscardDraft}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--line, #E6E1D8)',
                        background: '#FFF',
                        fontSize: 13,
                        color: 'var(--muted, #666)',
                        cursor: 'pointer',
                      }}
                    >
                      되돌리기
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSave(false)}
                    disabled={saveLoading}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #E6E1D8)',
                      background: '#FFF',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: saveLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    임시 저장 (미검수)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave(true)}
                    disabled={saveLoading}
                    style={{
                      padding: '9px 18px',
                      borderRadius: 6,
                      background: 'var(--pine, #2D5A43)',
                      color: '#FFF',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: saveLoading ? 'not-allowed' : 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }}
                  >
                    {saveLoading ? '저장 중…' : '검수 완료 및 저장'}
                  </button>
                </div>
              </div>

              {/* 상품 원자료 (상세 설명) 확인 및 입력란 [Requirement 1] */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line, #E6E1D8)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label htmlFor="product-desc" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink, #333)' }}>
                      상품 원자료 (상세 설명 문구)
                    </label>
                    {descLoading && (
                      <span style={{ fontSize: 11, color: 'var(--pine, #2D5A43)' }}>
                        카페24 설명 불러오는 중…
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchCafe24Description(selectedProduct.productNo)}
                    disabled={descLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted, #666)',
                      fontSize: 11,
                      textDecoration: 'underline',
                      cursor: descLoading ? 'not-allowed' : 'pointer',
                      padding: 0,
                    }}
                  >
                    카페24 설명 다시 불러오기
                  </button>
                </div>

                {/* 카페24 설명 안내 및 적용 배너 */}
                {descNotice && (
                  <div
                    style={{
                      marginBottom: 8,
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background:
                        descNotice.type === 'diff'
                          ? '#FEF3C7'
                          : descNotice.type === 'applied'
                          ? '#ECFDF5'
                          : descNotice.type === 'empty'
                          ? '#F3F4F6'
                          : '#FEF2F2',
                      color:
                        descNotice.type === 'diff'
                          ? '#92400E'
                          : descNotice.type === 'applied'
                          ? '#047857'
                          : descNotice.type === 'empty'
                          ? '#4B5563'
                          : '#DC2626',
                      border:
                        descNotice.type === 'diff'
                          ? '1px solid #FDE68A'
                          : descNotice.type === 'applied'
                          ? '1px solid #A7F3D0'
                          : descNotice.type === 'empty'
                          ? '1px solid #E5E7EB'
                          : '1px solid #FECACA',
                    }}
                  >
                    <span>{descNotice.message}</span>
                    {descNotice.type === 'diff' && latestCafe24Desc && (
                      <button
                        type="button"
                        onClick={handleApplyCafe24Desc}
                        style={{
                          marginLeft: 10,
                          padding: '4px 10px',
                          borderRadius: 4,
                          background: '#B45309',
                          color: '#FFF',
                          border: 'none',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        카페24 설명 적용하기
                      </button>
                    )}
                  </div>
                )}

                <textarea
                  id="product-desc"
                  rows={3}
                  value={draft.description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder="상품 상세페이지 설명문, 제조사 연혁, 산지 및 생산 방식 자료를 입력하세요."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line, #E6E1D8)',
                    fontSize: 13,
                    lineHeight: 1.45,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* 상태/오류 알림 */}
              {statusMessage && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#ECFDF5',
                    color: '#047857',
                    fontSize: 13,
                  }}
                >
                  {statusMessage}
                </div>
              )}
              {aiError && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#FEF2F2',
                    color: '#DC2626',
                    fontSize: 13,
                  }}
                >
                  <b>AI 제안 오류:</b> {aiError} (기존 입력 내용은 보존되었습니다)
                  <button
                    type="button"
                    onClick={handleAiSuggest}
                    style={{ marginLeft: 8, fontSize: 12, textDecoration: 'underline', border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer' }}
                  >
                    다시 시도
                  </button>
                </div>
              )}

              {/* 저장 충돌 발생 시 안전한 조정 패널 (강제 덮어쓰기 경로 완전 배제) [P1-3] */}
              {conflictRemote && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '12px 14px',
                    borderRadius: 6,
                    background: '#FFFBEB',
                    border: '1px solid #FCD34D',
                    color: '#B45309',
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    ⚠️ 개정 충돌: 다른 관리자가 이미 이 상품의 평가를 수정했습니다.
                  </div>
                  <div style={{ marginBottom: 8, lineHeight: 1.4 }}>
                    작성 중이신 내용은 안전하게 보존되었습니다. 서버의 최신 갱신 시각: {conflictRemote.updatedAt}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleResolveConflictWithMyEdits}
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
                      내 작성 내용 유지한 채 최신 개정 수락 (재저장 준비)
                    </button>
                    <button
                      type="button"
                      onClick={handleAcceptRemoteContent}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: '1px solid #B45309',
                        background: '#FFF',
                        color: '#B45309',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      서버 최신 내용으로 덮어쓰기
                    </button>
                  </div>
                </div>
              )}

              {saveError && !conflictRemote && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: '#FEF2F2',
                    color: '#DC2626',
                    fontSize: 13,
                  }}
                >
                  <b>저장 오류:</b> {saveError} (작성하신 내용은 보존되었습니다)
                </div>
              )}
            </div>

            {/* 5대 속성 평가 카드 목록 */}
            <div style={{ display: 'grid', gap: 14 }}>
              {FACTOR_IDS.map((factorId) => {
                const factorName = FACTOR_NAMES[factorId];
                const fa = draft.factors[factorId];
                const rubricInfo = workspace.rubric.factors[factorId];
                const isSuggested = aiSuggestedKeys.has(factorId);

                return (
                  <div
                    key={factorId}
                    style={{
                      padding: '16px 18px',
                      background: '#FFF',
                      border: isSuggested ? '2px solid #D8B4FE' : '1px solid var(--line, #E6E1D8)',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{factorName}</h3>
                        {fa.method === 'legacy-level' && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: '#FFFBEB',
                              color: '#B45309',
                            }}
                          >
                            과거 수준형
                          </span>
                        )}
                        {isSuggested && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: '#F3E8FF',
                              color: '#7E22CE',
                              fontWeight: 600,
                            }}
                          >
                            AI 제안값
                          </span>
                        )}
                      </div>

                      {/* 현재 점수 라벨 */}
                      <div style={{ fontSize: 14 }}>
                        현재 점수:{' '}
                        <b style={{ color: fa.score === null ? 'var(--muted, #888)' : 'var(--pine, #2D5A43)' }}>
                          {fa.score === null ? '미평가' : `${fa.score}점`}
                        </b>
                      </div>
                    </div>

                    <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted, #666)' }}>
                      {rubricInfo?.guide}
                    </p>

                    {/* 점수 선택 버튼들 (0~10 정수 및 미평가 구분) */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft, #555)', marginBottom: 4 }}>
                        점수 선택 (확인된 0점과 미평가 null 구분)
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleScoreChange(factorId, null)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 4,
                            border: fa.score === null ? '2px solid #4B5563' : '1px solid var(--line, #E6E1D8)',
                            background: fa.score === null ? '#4B5563' : '#FFF',
                            color: fa.score === null ? '#FFF' : 'var(--ink-soft, #555)',
                            fontSize: 12,
                            fontWeight: fa.score === null ? 700 : 400,
                            cursor: 'pointer',
                          }}
                        >
                          미평가 (자료 없음)
                        </button>

                        <button
                          type="button"
                          onClick={() => handleScoreChange(factorId, 0)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 4,
                            border: fa.score === 0 ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                            background: fa.score === 0 ? 'var(--pine, #2D5A43)' : '#FFF',
                            color: fa.score === 0 ? '#FFF' : 'var(--ink-soft, #555)',
                            fontSize: 12,
                            fontWeight: fa.score === 0 ? 700 : 400,
                            cursor: 'pointer',
                          }}
                        >
                          0점 (확인됨)
                        </button>

                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                          const active = fa.score === num;
                          return (
                            <button
                              key={num}
                              type="button"
                              onClick={() => handleScoreChange(factorId, num)}
                              style={{
                                width: 34,
                                height: 32,
                                borderRadius: 4,
                                border: active ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                                background: active ? 'var(--pine, #2D5A43)' : '#FFF',
                                color: active ? '#FFF' : 'var(--ink, #333)',
                                fontSize: 13,
                                fontWeight: active ? 700 : 400,
                                cursor: 'pointer',
                              }}
                            >
                              {num}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 평가 근거 입력란 */}
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft, #555)', marginBottom: 4 }}>
                        확인 근거 (자료 출처 및 확인 내용)
                      </div>
                      <textarea
                        aria-label={`${factorName} 확인 근거`}
                        rows={2}
                        data-factor-basis={factorId}
                        value={fa.basis}
                        onChange={(e) => handleBasisChange(factorId, e.target.value)}
                        placeholder="상세페이지 연혁, 산지 표기, 생산 공정 등 구체적인 확인 근거를 적어 주세요."
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--line, #E6E1D8)',
                          fontSize: 13,
                          lineHeight: 1.4,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {/* 루브릭 기준 앵커 참조 토글 */}
                    {rubricInfo?.anchors && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--muted, #888)' }}>
                          평가 기준표 (0 / 2 / 5 / 8 / 10 앵커) 보기
                        </summary>
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-soft, #666)', lineHeight: 1.5 }}>
                          {rubricInfo.anchors.map((a) => (
                            <div key={a.score}>
                              <b>{a.score}점:</b> {a.description}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted, #888)' }}>
            상품을 선택해 주세요.
          </div>
        )}
      </main>
    </div>
  );
}
