'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { Cafe24Product } from '@/engine/types.ts';
import { RARE_FACTORS, type RareFactor } from '@/engine/eligibility.ts';
import { LEVELS, type IntakeFactors, type Level } from '@/engine/formality-intake.ts';
import { importPilotProducts, loadDescription, savePilotItem, suggestIntake } from './intake-actions.ts';
import { EventTest } from './event-test.tsx';
import './intake.css';

type Item = { description: string; factors: IntakeFactors; reviewed: boolean; rarity: number | null };
type Pilot = { products: Cafe24Product[]; items: Record<string, Item> };
const empty = (): Item => ({ description: '', factors: {}, reviewed: false, rarity: null });
const keys = Object.keys(RARE_FACTORS) as RareFactor[];

export function Intake({ initial, eventTest = true, mode }: { initial: Pilot; eventTest?: boolean; mode: 'local' | 'supabase' }) {
  const [pilot, setPilot] = useState(initial);
  const [selected, setSelected] = useState(initial.products[0]?.productNo ?? 0);
  const [draft, setDraft] = useState<Item>(() => structuredClone(initial.items[String(initial.products[0]?.productNo)] ?? empty()));
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'reviewed' | 'unreviewed'>('all');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error'>('info');
  const [pending, start] = useTransition();

  // 최신 draft를 비동기 콜백에서 즉시 참조하기 위한 ref
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 카페24 동기화 상태 (인라인 표시)
  const [syncState, setSyncState] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    time?: string;
    message?: string;
  }>({ status: 'idle' });

  // 카페24 설명 자동 조회 상태 및 새로운 설명 대기 상태
  const [descLoading, setDescLoading] = useState(false);
  const [descNotice, setDescNotice] = useState<string | null>(null);
  const [incomingDesc, setIncomingDesc] = useState<string | null>(null);

  // AI 검토평가 상태 및 실제로 적용된 AI 제안 항목 추적
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestedKeys, setAiSuggestedKeys] = useState<Set<RareFactor>>(new Set());

  // 플로팅 판정 완료 알림 (스크롤 내려도 볼 수 있는 토스트)
  const [toast, setToast] = useState<{ message: string; score: number } | null>(null);

  // 경쟁 상태(Race Condition) 방어용 refs
  const activeProductRef = useRef(selected);
  activeProductRef.current = selected;
  const descRequestIdRef = useRef(0);
  const aiRequestIdRef = useRef(0);

  const selectedProduct = pilot.products.find((p) => p.productNo === selected);
  const completed = keys.filter((key) => draft.factors[key]?.basis?.trim()).length;

  // 필터 및 검색 적용 상품 목록
  const list = pilot.products.filter((p) => {
    const isReviewed = Boolean(pilot.items[String(p.productNo)]?.reviewed);
    if (filter === 'reviewed' && !isReviewed) return false;
    if (filter === 'unreviewed' && isReviewed) return false;
    if (query.trim() && !p.name.includes(query.trim())) return false;
    return true;
  });

  const reviewedCount = pilot.products.filter((p) => pilot.items[String(p.productNo)]?.reviewed).length;
  const unreviewedCount = pilot.products.length - reviewedCount;

  const update = (next: Item) => {
    setDraft({ ...next, reviewed: false, rarity: null });
    setDirty(true);
    setMessage('');
  };

  // 카페24 설명 비동기 자동 조회 (최신 입력 상태 기준 보존 및 순서 경합 방어)
  const autoFetchDescription = async (no: number) => {
    const reqId = ++descRequestIdRef.current;
    setDescLoading(true);
    setDescNotice(null);
    setIncomingDesc(null);

    try {
      const res = await loadDescription(no);
      // 상품이 바뀌었거나 더 최신 조회 요청이 있으면 오래된 응답 폐기
      if (activeProductRef.current !== no || descRequestIdRef.current !== reqId) return;

      if (!res.ok) {
        setDescNotice(`상세 설명 조회 실패: ${res.error}`);
        return;
      }

      const fetched = res.text.trim();
      if (!fetched) {
        setDescNotice('카페24 상세설명에서 텍스트를 찾을 수 없습니다 (상세페이지가 이미지로만 구성되었거나 설명이 비어 있음). 아래 입력창에 확인한 내용을 직접 입력해 주세요.');
        return;
      }

      // 응답 도착 시점의 최신 입력 내용을 기준으로 판단
      const currentDesc = draftRef.current.description.trim();
      if (!currentDesc && !draftRef.current.reviewed && !Object.keys(draftRef.current.factors).length) {
        // 응답 시점에도 입력창이 완전히 비어있을 때만 자동 반영
        setDraft((prev) => prev.description.trim() ? prev : ({ ...prev, description: fetched }));
        setDescNotice('카페24 상품 설명을 자동으로 가져왔습니다.');
      } else if (currentDesc !== fetched) {
        // 관리자가 이미 글을 썼거나 저장된 내용과 다르면 절대 덮어쓰지 않고 비교 선택 제공
        setIncomingDesc(fetched);
      }
    } catch (e) {
      if (activeProductRef.current === no && descRequestIdRef.current === reqId) {
        setDescNotice(e instanceof Error ? e.message : '상세 설명 조회 중 오류가 발생했습니다.');
      }
    } finally {
      if (activeProductRef.current === no && descRequestIdRef.current === reqId) {
        setDescLoading(false);
      }
    }
  };

  // 첫 마운트 시 최초 선택 상품의 설명 자동 조회
  useEffect(() => {
    if (initial.products[0]?.productNo) {
      autoFetchDescription(initial.products[0].productNo);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (no: number) => {
    if (no === selected) return;
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 다른 상품으로 이동하시겠습니까?')) return;

    setSelected(no);
    activeProductRef.current = no;

    // 상품 전환 시 이전 요청 무효화 및 AI 로딩 상태 즉시 해제
    descRequestIdRef.current++;
    aiRequestIdRef.current++;
    setAiLoading(false);
    setDescLoading(false);
    setToast(null);

    const item = structuredClone(pilot.items[String(no)] ?? empty());
    setDraft(item);
    setDirty(false);
    setMessage('');
    setAiSuggestedKeys(new Set());
    autoFetchDescription(no);
  };

  // 관리자가 특정 속성을 수정하면 해당 속성의 'AI 제안' 뱃지를 제거하고 운영자 입력으로 전환
  const changeFactor = (key: RareFactor, value: { level: Level; basis: string } | null) => {
    setAiSuggestedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    const factors = { ...draft.factors };
    if (value) factors[key] = value; else delete factors[key];
    update({ ...draft, factors });
  };

  // 상품 가져오기
  const handleImportProducts = () => {
    if (dirty && !window.confirm('입력 중인 내용은 저장되지 않습니다. 상품 목록을 가져올까요?')) return;
    setSyncState({ status: 'loading' });
    setMessage('');

    start(async () => {
      try {
        const next = await importPilotProducts();
        setPilot(next);
        const no = next.products.some((p) => p.productNo === selected) ? selected : next.products[0]?.productNo ?? 0;
        setSelected(no);
        activeProductRef.current = no;
        descRequestIdRef.current++;
        aiRequestIdRef.current++;
        setAiLoading(false);

        const item = structuredClone(next.items[String(no)] ?? empty());
        setDraft(item);
        setDirty(false);
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        setSyncState({
          status: 'success',
          time: timeStr,
          message: `카페24 상품 ${next.products.length}개를 가져왔습니다.`,
        });
        autoFetchDescription(no);
      } catch (e) {
        setSyncState({
          status: 'error',
          message: e instanceof Error ? e.message : '상품 목록을 불러오지 못했습니다.',
        });
      }
    });
  };

  // AI 검토평가 실행 (최신 상태 보존 및 설명 변경 시 덮어쓰기 방어)
  const handleAiSuggest = async () => {
    const reqDesc = draftRef.current.description.trim();
    if (!reqDesc || aiLoading) return;

    const reqId = ++aiRequestIdRef.current;
    const reqNo = selected;
    setAiLoading(true);
    setMessage('');

    try {
      const factors = await suggestIntake(reqNo, reqDesc);
      // 상품이 바뀌었거나 최신 요청이 아니면 폐기
      if (activeProductRef.current !== reqNo || aiRequestIdRef.current !== reqId) return;

      // 요청 도중 관리자가 상품 설명을 바꿨다면 이전 AI 결과를 자동 적용하지 않음
      if (draftRef.current.description.trim() !== reqDesc) {
        setMessageType('info');
        setMessage('AI 검토 중 상품 설명이 수정되어 이전 분석 결과를 적용하지 않았습니다. 새 설명으로 다시 검토해 주세요.');
        return;
      }

      // 최신 상태를 보존하면서 비어 있는 항목에만 AI 제안을 적용
      const currentFactors = draftRef.current.factors;
      const actuallyAdded: RareFactor[] = [];
      const nextFactors = { ...currentFactors };

      for (const [k, v] of Object.entries(factors)) {
        const key = k as RareFactor;
        if (!currentFactors[key]) {
          nextFactors[key] = v;
          actuallyAdded.push(key);
        }
      }

      setAiSuggestedKeys(new Set(actuallyAdded));
      if (actuallyAdded.length) update({ ...draftRef.current, factors: nextFactors });
      setMessageType('info');
      setMessage(
        actuallyAdded.length
          ? `AI가 원문에서 ${actuallyAdded.length}개 항목의 근거 문장을 제안했습니다. [AI 제안] 표시를 확인하고 검토해 주세요.`
          : '원문에서 추가할 수 있는 새로운 근거를 찾지 못했습니다. 부족한 항목은 직접 입력해 주세요.',
      );
    } catch (e) {
      if (activeProductRef.current === reqNo && aiRequestIdRef.current === reqId) {
        setMessageType('error');
        setMessage(e instanceof Error ? e.message : 'AI 정리 중 오류가 발생했습니다.');
      }
    } finally {
      if (activeProductRef.current === reqNo && aiRequestIdRef.current === reqId) {
        setAiLoading(false);
      }
    }
  };

  // 저장 및 판정
  const handleSave = (reviewed: boolean) => {
    setMessage('');
    start(async () => {
      let res: Awaited<ReturnType<typeof savePilotItem>>;
      try {
        res = await savePilotItem(selected, draft.description, draft.factors, reviewed);
      } catch {
        setMessageType('error');
        setMessage('저장하지 못했습니다. 로그인 상태와 연결을 확인한 뒤 다시 시도해 주세요.');
        return;
      }
      if (!res.ok) {
        setMessageType('error');
        setMessage(res.error);
        return;
      }

      setPilot((p) => ({ ...p, items: { ...p.items, [selected]: res.item } }));
      setDraft(res.item);
      setDirty(false);
      setMessageType('success');

      const score = Math.round((res.item.rarity ?? 0) * 100);
      const successMsg = reviewed
        ? `판정을 완료했습니다. (상품 희소값: ${score}점) 이제 아래에서 추천 행사와 적합성을 확인할 수 있습니다.`
        : '입력 내용을 임시 저장했습니다 (아직 미검수 상태입니다).';
      setMessage(successMsg);

      if (reviewed) {
        setToast({ message: `판정을 완료했습니다. (희소값: ${score}점)`, score });
      }
    });
  };

  return (
    <>
      <header className="page-head spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>격식지수 v2 (특허출원 구조) 상품 평가</h1>
          <p>
            카페24 상품 정보를 이해·평가하여 희소 속성값을 산출하고, 행사 조건별 적합성을 검증합니다.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn ghost small" href="/admin/formality/lab">격식 기준 검증실 (전체 시뮬레이션) →</a>
        </div>
      </header>

      <section className="notice" style={{ marginBottom: 16 }}>
        <b>업무 흐름 안내</b>
        <p style={{ margin: '4px 0 0' }} className="small">
          ① 카페24 상품 목록 및 설명 가져오기 → ② AI 검토평가(원문 일치 문장만 추출) → ③ 운영자 확인·수정 및 희소값 계산(근거 2개 이상 필요) → ④ 추천 행사 및 조건별 적합성 확인 → ⑤ 검증실에서 전체 상품 평가.
        </p>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)' }} className="small">
          {mode === 'local' ? '로컬 시험 자료에 저장됩니다. 기존 고객 추천이나 운영 DB에는 영향을 주지 않습니다.' : '운영 DB에 상품 근거를 저장합니다. 상품 가져오기는 운영 상품 목록을 갱신하며 기존 고객 추천에도 영향을 줄 수 있습니다. 새 격식지수는 아직 고객 추천에 적용되지 않습니다.'}
        </p>
      </section>

      <div className="intake-layout">
        {/* 좌측 상품 목록 패널 */}
        <aside className="intake-list panel" aria-label="시험 상품 목록">
          <div className="spread" style={{ alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>상품 <span className="small muted">{pilot.products.length}개</span></h2>
            <button className="btn ghost small" disabled={pending || syncState.status === 'loading'} onClick={handleImportProducts}>
              {syncState.status === 'loading' ? (
                <>
                  <span className="inline-spinner" />
                  가져오는 중…
                </>
              ) : '카페24 상품 가져오기'}
            </button>
          </div>

          {/* 상품 가져오기 인라인 상태 표시 */}
          {syncState.status === 'loading' && (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              <span className="inline-spinner" />
              카페24 상품 목록을 가져오는 중입니다…
            </p>
          )}
          {syncState.status === 'success' && (
            <p className="small" style={{ margin: '6px 0 0', color: 'var(--green, #2e7d32)' }}>
              ✓ 동기화 완료 ({syncState.time} 확인)
            </p>
          )}
          {syncState.status === 'error' && (
            <p className="small" style={{ margin: '6px 0 0', color: 'var(--red, #d32f2f)' }}>
              ✗ {syncState.message}
            </p>
          )}

          {/* 검색 및 검수 상태 필터 */}
          <label className="intake-search">
            <span className="small">상품 검색</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품명 검색" />
          </label>

          <div className="filter-chips" role="tablist" aria-label="검수 상태 필터">
            <button
              type="button"
              className={filter === 'all' ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilter('all')}
            >
              전체 ({pilot.products.length})
            </button>
            <button
              type="button"
              className={filter === 'reviewed' ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilter('reviewed')}
            >
              ✓ 검수 완료 ({reviewedCount})
            </button>
            <button
              type="button"
              className={filter === 'unreviewed' ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilter('unreviewed')}
            >
              ✗ 미검수 ({unreviewedCount})
            </button>
          </div>

          <div className="intake-product-list">
            {list.map((p) => {
              const isReviewed = Boolean(pilot.items[String(p.productNo)]?.reviewed);
              return (
                <button
                  key={p.productNo}
                  type="button"
                  className={selected === p.productNo ? 'intake-product active' : 'intake-product'}
                  onClick={() => choose(p.productNo)}
                  disabled={pending}
                  aria-current={selected === p.productNo ? 'true' : undefined}
                >
                  {p.image ? (
                    <img
                      src={p.image}
                      alt=""
                      width={44}
                      height={44}
                      className="intake-thumb"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <span className="intake-thumb-fallback" aria-hidden="true" />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 13, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name}
                    </span>
                    <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 2 }}>
                      <small className="muted">#{p.productNo}</small>
                      {isReviewed ? (
                        <span className="intake-badge intake-badge-reviewed">✓ 검수 완료</span>
                      ) : (
                        <span className="intake-badge intake-badge-unreviewed">✗ 미검수</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {list.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>검색 또는 필터 조건에 맞는 상품이 없습니다.</p>}
        </aside>

        {/* 우측 메인 상세 영역 */}
        <main className="intake-main">
          {!selectedProduct ? (
            <section className="panel">
              <h2>상품이 없습니다</h2>
              <p>카페24 상품 가져오기를 누르거나 로컬 카탈로그를 확인해 주세요.</p>
            </section>
          ) : (
            <>
              {/* 상단 요약 카드 (상품 이미지 포함) */}
              <section className="panel intake-head">
                <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                  {selectedProduct.image ? (
                    <img
                      src={selectedProduct.image}
                      alt=""
                      width={72}
                      height={72}
                      className="intake-hero-img"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <span className="intake-hero-img-fallback" aria-hidden="true" />
                  )}
                  <div>
                    <p className="small muted">상품번호 {selectedProduct.productNo} · {selectedProduct.price.toLocaleString('ko-KR')}원</p>
                    <h2 style={{ margin: '2px 0 4px', fontSize: 18 }}>{selectedProduct.name}</h2>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      {draft.reviewed ? (
                        <span className="intake-badge intake-badge-reviewed" style={{ fontSize: 12 }}>✓ 운영자 검수 완료</span>
                      ) : (
                        <span className="intake-badge intake-badge-unreviewed" style={{ fontSize: 12 }}>✗ 미검수 (근거 확인 필요)</span>
                      )}
                      {dirty && <span className="small" style={{ color: 'var(--red, #d32f2f)' }}>⚠ 저장되지 않은 수정이 있습니다</span>}
                    </div>
                  </div>
                </div>

                <div className="intake-result">
                  <span>상품 희소 속성값</span>
                  <strong>{draft.rarity == null ? '미산출' : `${Math.round(draft.rarity * 100)}점`}</strong>
                  <small>{completed}개 항목 근거 입력 · {draft.reviewed ? '확인 완료' : '확인 전'}</small>
                </div>
              </section>

              {/* 1단계: 상품 정보 및 설명 */}
              <section className="panel intake-section">
                <div className="spread intake-section-title">
                  <div>
                    <h2>1. 상품 정보 및 확인 자료</h2>
                    <p className="small muted">
                      상품을 선택하면 카페24 상세설명이 자동으로 조회됩니다. 생산자·산지·원재료 등 확인한 자료를 직접 보완할 수도 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={pending || descLoading}
                    onClick={() => autoFetchDescription(selected)}
                  >
                    {descLoading ? (
                      <>
                        <span className="inline-spinner" />
                        조회 중…
                      </>
                    ) : '카페24 설명 다시 확인'}
                  </button>
                </div>

                {/* 자동 조회 안내 및 상태 표시 */}
                {descLoading && (
                  <p className="small muted" style={{ margin: '0 0 8px' }}>
                    <span className="inline-spinner" />
                    카페24에서 최신 상품 설명을 불러오는 중입니다…
                  </p>
                )}
                {descNotice && !descLoading && (
                  <p className="small" style={{ margin: '0 0 8px', color: 'var(--muted)' }}>ℹ {descNotice}</p>
                )}

                {/* 카페24 최신 설명이 기존과 다를 때 비교/반영 알림 배너 */}
                {incomingDesc && (
                  <div className="notice" style={{ marginBottom: 12, background: 'var(--pine-weak, #e8f3ed)', borderColor: 'var(--pine-deep, #1b4d3e)' }}>
                    <b style={{ color: 'var(--pine-deep, #1b4d3e)' }}>💡 카페24 쇼핑몰에 최신 상세설명이 있습니다</b>
                    <p className="small" style={{ margin: '4px 0 8px' }}>
                      현재 입력창에 저장된 내용과 카페24 최신 내용이 다릅니다. 최신 설명을 반영하시겠습니까?
                    </p>
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn small"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          update({ ...draftRef.current, description: incomingDesc });
                          setIncomingDesc(null);
                        }}
                      >
                        카페24 최신 설명 반영하기
                      </button>
                      <button
                        type="button"
                        className="btn ghost small"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => setIncomingDesc(null)}
                      >
                        현재 내용 유지
                      </button>
                    </div>
                  </div>
                )}

                <label className="field">
                  <span>상품 설명 및 원자료 (텍스트)</span>
                  <textarea
                    disabled={pending}
                    aria-label="상품 설명 및 확인 자료"
                    rows={5}
                    maxLength={12000}
                    value={draft.description}
                    onChange={(e) => update({ ...draft, description: e.target.value })}
                    placeholder="확인한 내용 및 출처 (원문 근거) 또는 추가 의견을 입력하세요."
                  />
                </label>

                <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending || aiLoading || !draft.description.trim()}
                    onClick={handleAiSuggest}
                  >
                    {aiLoading ? (
                      <>
                        <span className="inline-spinner" />
                        AI 검토 중…
                      </>
                    ) : 'AI 검토평가'}
                  </button>
                  <span className="small muted">
                    * AI는 원문에 명시된 근거만 추출합니다. 사실 여부와 수준은 운영자가 검토해야 하며, 찾지 못한 항목은 직접 입력할 수 있습니다.
                  </span>
                </div>
              </section>

              {/* 2단계: 5대 희소 속성 검토 및 평가 */}
              <section className="panel intake-section">
                <h2>2. 5대 희소 속성 검토와 평가</h2>
                <p className="small muted">
                  특허출원서(청구항 4)의 5개 속성에 대해 실제 근거와 수준을 검토합니다. 근거가 있는 항목이 최소 2개 이상이어야 격식지수(희소값)를 판정할 수 있습니다. 모르는 항목은 미확인으로 남겨두세요.
                </p>

                <div className="intake-factors">
                  {keys.map((key) => {
                    const f = draft.factors[key];
                    const hasBasis = Boolean(f?.basis?.trim());
                    const isAiSuggested = aiSuggestedKeys.has(key);

                    return (
                      <div key={key} className="intake-factor">
                        <div>
                          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>{RARE_FACTORS[key].name}</h3>
                            {isAiSuggested ? (
                              <span className="intake-badge intake-badge-ai">AI 제안</span>
                            ) : hasBasis ? (
                              <span className="intake-badge intake-badge-user">운영자 입력</span>
                            ) : (
                              <span className="intake-badge intake-badge-missing">미확인</span>
                            )}
                          </div>
                          <p className="small muted">{RARE_FACTORS[key].guide}</p>
                        </div>

                        <label>
                          <span className="small">수준</span>
                          <select
                            disabled={pending}
                            aria-label={`${RARE_FACTORS[key].name} 수준`}
                            value={f?.level ?? ''}
                            onChange={(e) => {
                              const level = e.target.value as Level | '';
                              changeFactor(key, level ? { level, basis: f?.basis ?? '' } : null);
                            }}
                          >
                            <option value="">미확인 (평가 제외)</option>
                            {Object.entries(LEVELS).map(([value, entry]) => (
                              <option key={value} value={value}>{entry.label} ({entry.score}점)</option>
                            ))}
                          </select>
                        </label>

                        {f && (
                          <label className="intake-basis">
                            <span className="small">확인한 내용 및 출처 (원문 근거) 또는 추가 의견</span>
                            <textarea
                              disabled={pending}
                              aria-label={`${RARE_FACTORS[key].name} 확인한 내용`}
                              rows={2}
                              maxLength={2000}
                              value={f.basis}
                              onChange={(e) => changeFactor(key, { ...f, basis: e.target.value })}
                              placeholder="확인한 내용 및 출처 (원문 근거) 또는 추가 의견을 입력하세요."
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="intake-actions">
                  <button type="button" className="btn ghost small" disabled={pending} onClick={() => handleSave(false)}>
                    임시 저장 (미검수)
                  </button>
                  <button type="button" className="btn small" disabled={pending || completed < 2} onClick={() => handleSave(true)}>
                    격식지수 판정하기 (검수 완료)
                  </button>
                  <span className="small muted">
                    {pending ? '저장 및 계산 중…' : completed < 2 ? '⚠ 근거가 있는 속성이 2개 이상 필요합니다' : '✓ 판정 완료 시 아래에서 추천 행사와 적합성을 확인할 수 있습니다'}
                  </span>
                </div>

                {message && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="notice"
                    style={{
                      marginTop: 14,
                      background: messageType === 'error' ? 'var(--red-weak, #fdf0f0)' : messageType === 'success' ? 'var(--green-weak, #eaf5ea)' : undefined,
                      borderColor: messageType === 'error' ? 'var(--red, #d32f2f)' : messageType === 'success' ? 'var(--green, #2e7d32)' : undefined,
                      color: messageType === 'error' ? 'var(--red, #d32f2f)' : messageType === 'success' ? 'var(--green, #2e7d32)' : undefined,
                    }}
                  >
                    {message}
                  </p>
                )}
              </section>

              {/* 3단계: 행사 적합성 시험 및 추천 Top 3 */}
              {eventTest ? (
                <EventTest
                  key={selected}
                  productNo={selected}
                  ready={draft.reviewed && !dirty}
                />
              ) : (
                <p className="small muted">
                  수준과 점수는 시험용 가안입니다. 확인된 상품의 행사별 적합 여부는 <a href="/admin/formality/lab">격식 기준 검증실</a>에서 별도 시험할 수 있습니다.
                </p>
              )}
            </>
          )}
        </main>
      </div>

      {/* 화면 아래에 있어도 볼 수 있는 작은 플로팅 판정 완료 알림 */}
      {toast && (
        <div className="intake-toast" role="status" aria-live="polite">
          <div style={{ flex: 1 }}>
            <b style={{ color: 'var(--green, #2e7d32)', display: 'block', fontSize: 13 }}>
              ✓ {toast.message}
            </b>
            <span className="small muted" style={{ fontSize: 11 }}>
              아래 3단계에서 적격 행사 예시를 확인하세요.
            </span>
          </div>
          <button
            type="button"
            className="btn ghost small"
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => setToast(null)}
            aria-label="알림 닫기"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
