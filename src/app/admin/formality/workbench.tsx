'use client';

import { useMemo, useState } from 'react';
import type { Catalog, Relation } from '@/engine/types.ts';
import {
  evaluateFormality,
  initialPolicy,
  OCCASIONS,
  parseWorkspace,
  PURPOSES,
  RANK_FACTORS,
  RARE_FACTORS,
  SENDERS,
  type FormalityInput,
  type FormalityWorkspace,
  type ProductEvidence,
  type RareFactor,
} from '@/engine/eligibility.ts';
import { formalitySamples, SAMPLE_INPUT } from '@/engine/formality-samples.ts';
import { saveBlob } from '@/lib/device.ts';
import { won } from '@/lib/result-query.ts';
import './lab.css';

const RELATIONS = {
  senior: '상급자/어르신',
  business: '거래처/공식',
  peer: '동료/친구',
  family: '가족/친밀',
} as const;

function Num({
  label,
  value,
  min,
  max,
  step = 1,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValue: (n: number) => void;
}) {
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value !== '') onValue(Number(e.target.value));
      }}
      style={{ width: 90 }}
    />
  );
}

export function FormalityWorkbench({
  catalog,
  pilotEvidence = [],
}: {
  catalog: Catalog;
  pilotEvidence?: ProductEvidence[];
}) {
  const samples = useMemo(() => formalitySamples(catalog), [catalog]);
  const [workspace, setWorkspace] = useState<FormalityWorkspace>(() => samples.workspace);
  const [input, setInput] = useState<FormalityInput>({ ...SAMPLE_INPUT });
  const [selectedNo, setSelectedNo] = useState(samples.catalog.products[0].productNo);
  const [message, setMessage] = useState('');
  const [tableFilter, setTableFilter] = useState<'all' | 'eligible' | 'ineligible' | 'unreviewed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const active = workspace.source === 'sample' ? samples.catalog : catalog;
  const evidence = workspace.evidence.find((e) => e.productNo === selectedNo) ?? {
    productNo: selectedNo,
    reviewed: false,
    factors: {},
  };

  const evaluation = useMemo(() => {
    try {
      return { result: evaluateFormality(active, workspace, input), error: '' };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : '설정을 확인해 주세요.' };
    }
  }, [active, workspace, input]);

  const reviewedCount = pilotEvidence.filter((e) => e.reviewed).length;
  const totalCatalogCount = catalog.products.length;

  function edit(fn: (w: FormalityWorkspace) => void) {
    setWorkspace((w) => {
      const next = structuredClone(w);
      fn(next);
      return next;
    });
    setMessage('');
  }

  function editEvidence(fn: (e: ProductEvidence) => void, review = false) {
    edit((w) => {
      let item = w.evidence.find((e) => e.productNo === selectedNo);
      if (!item) {
        item = { productNo: selectedNo, reviewed: false, factors: {} };
        w.evidence.push(item);
      }
      if (!review) item.reviewed = false;
      fn(item);
    });
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('검증 파일은 2MB까지 불러올 수 있습니다.');
      const next = parseWorkspace(JSON.parse(await file.text()));
      const products = next.source === 'sample' ? samples.catalog.products : catalog.products;
      const known = new Set(products.map((p) => p.productNo));
      if (next.evidence.some((e) => !known.has(e.productNo))) {
        throw new Error('현재 상품 목록에 없는 상품번호가 있습니다. 상품을 확인해 주세요.');
      }
      setWorkspace(next);
      setSelectedNo(products[0]?.productNo ?? 0);
      setMessage('기준과 근거를 불러왔습니다. 행사 조건은 현재 선택을 유지합니다.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    }
  }

  function download(result = false) {
    try {
      const value = result ? evaluation.result : parseWorkspace(workspace);
      if (!value) throw new Error('유효한 계산 결과가 없습니다.');
      saveBlob(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
        result ? 'ondap-formality-result.json' : 'ondap-formality-workspace.json',
      );
      setMessage('파일로 내보냈습니다. 결과 파일에는 당시 카탈로그·기준·근거가 포함됩니다.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '내보내지 못했습니다.');
    }
  }

  // 전체 판정 결과 필터링
  const filteredDecisions = useMemo(() => {
    if (!evaluation.result) return [];
    return evaluation.result.decisions.filter((d) => {
      if (tableFilter === 'eligible' && !d.eligible) return false;
      if (tableFilter === 'ineligible' && d.eligible) return false;
      if (tableFilter === 'unreviewed' && (d.rarity.reviewed && d.rarity.value !== null)) return false;
      if (searchQuery.trim() && !d.product.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
      return true;
    });
  }, [evaluation.result, tableFilter, searchQuery]);

  return (
    <>
      <header className="page-head spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>격식지수 v2 검증실</h1>
          <p>
            특허출원 구조(행사 분석부 → 상품 속성 평가부 → 매칭 필터부 → 상품 추천부)에 따른 전체 시뮬레이션 및 기준표 검증입니다.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn ghost small" href="/admin/formality">
            ← 상품 평가·검수로 돌아가기
          </a>
        </div>
      </header>

      {/* 상단 자료 안내 및 전환 배너 */}
      <section
        className={`lab-source-banner ${workspace.source === 'sample' ? 'lab-source-sample' : 'lab-source-catalog'}`}
        aria-label="검증 자료 안내"
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="row" style={{ alignItems: 'center', marginBottom: 4 }}>
            <span className="lab-source-badge">
              {workspace.source === 'sample' ? '가상 시험 상품' : '실제 쇼핑몰 카탈로그'}
            </span>
            <strong style={{ fontSize: 15 }}>
              {workspace.source === 'sample'
                ? '가상 샘플 3개로 검증 중입니다'
                : `실제 카탈로그 총 ${totalCatalogCount}개 상품 검증 중`}
            </strong>
          </div>
          <p className="small" style={{ margin: 0, opacity: 0.9 }}>
            {workspace.source === 'sample'
              ? '이름·가격·경력·생산량·점수는 모두 가상 예시입니다. 알고리즘의 매칭·필터 동작을 빠르게 시험할 수 있습니다.'
              : `실제 상품 근거 검수가 완료된 ${reviewedCount}건만 적격 후보가 될 수 있습니다. 미검수 상품은 검수 전까지 후보에서 자동 제외됩니다.`}
          </p>
        </div>

        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {workspace.source === 'catalog' && (
            <a className="btn small" href="/admin/formality" style={{ fontSize: 12 }}>
              👉 상품 근거 검수하기
            </a>
          )}
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            검증 대상:{' '}
            <select
              aria-label="검증 대상 자료 선택"
              value={workspace.source}
              onChange={(e) => {
                const source = e.target.value as FormalityWorkspace['source'];
                setWorkspace(
                  source === 'sample'
                    ? structuredClone(samples.workspace)
                    : {
                        format: 'ondap-formality-v2',
                        source,
                        policy: initialPolicy(catalog),
                        evidence: structuredClone(pilotEvidence),
                      },
                );
                setSelectedNo((source === 'sample' ? samples.catalog : catalog).products[0]?.productNo ?? 0);
                setMessage('');
              }}
              style={{
                borderRadius: 6,
                padding: '6px 10px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontWeight: 600,
              }}
            >
              <option value="sample">가상 샘플 3개</option>
              <option value="catalog">실제 카탈로그 전체 ({totalCatalogCount}개)</option>
            </select>
          </label>
        </div>
      </section>

      {/* 기본 흐름 1단계: 행사 조건 선택 */}
      <section className="lab-step-panel">
        <h2>1. 행사 조건 선택</h2>
        <p className="small muted" style={{ margin: '0 0 12px' }}>
          선물을 주고받는 상황 조건을 지정하면, 행사 격식지수 산출 및 허용 기준 필터링이 즉시 시뮬레이션됩니다.
        </p>

        <div className="lab-fields-grid">
          <label>
            <span>행사 종류</span>
            <select
              aria-label="행사"
              value={input.event}
              onChange={(e) => setInput({ ...input, event: e.target.value as FormalityInput['event'] })}
            >
              {Object.entries(OCCASIONS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>받는 분과의 관계</span>
            <select
              aria-label="관계"
              value={input.relation}
              onChange={(e) => setInput({ ...input, relation: e.target.value as Relation })}
            >
              {Object.entries(RELATIONS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>보내는 주체</span>
            <select
              aria-label="발신 주체"
              value={input.sender}
              onChange={(e) => setInput({ ...input, sender: e.target.value as FormalityInput['sender'] })}
            >
              {Object.entries(SENDERS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>행사 목적</span>
            <select
              aria-label="목적"
              value={input.purpose}
              onChange={(e) => setInput({ ...input, purpose: e.target.value as FormalityInput['purpose'] })}
            >
              {Object.entries(PURPOSES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>1개당 예산 (원)</span>
            <Num
              label="1개당 예산"
              min={1}
              max={100000000}
              value={input.budget ?? 50000}
              onValue={(budget) => setInput({ ...input, budget })}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
            <input
              type="checkbox"
              checked={input.budget === null}
              onChange={(e) => setInput({ ...input, budget: e.target.checked ? null : 50000 })}
            />
            <span>예산 제한 없음</span>
          </label>
          <label>
            <span>검증 수량 (개)</span>
            <Num
              label="검증 수량"
              min={1}
              max={100000}
              value={input.quantity}
              onValue={(quantity) => setInput({ ...input, quantity })}
            />
          </label>
        </div>

        {evaluation.error && (
          <p role="alert" className="notice" style={{ marginTop: 14 }}>
            {evaluation.error}
          </p>
        )}
      </section>

      {/* 기본 흐름 2단계: 그 행사의 격식 점수와 허용 기준 확인 + 추천 후보 확인 */}
      {evaluation.result && (
        <section className="lab-step-panel">
          <h2>2. 행사 격식 점수 및 추천 후보</h2>
          <p className="small muted" style={{ margin: '0 0 16px' }}>
            입력된 행사 조건을 바탕으로 산출된 행사 격식 점수와 요구되는 상품 희소값 구간, 그리고 최종 선정된 추천 후보 상품입니다.
          </p>

          <div className="lab-event-summary">
            <div className="lab-event-score-card">
              <span className="small muted">행사 격식 점수</span>
              <strong>{evaluation.result.event.score}점</strong>
              <span className="small" style={{ color: 'var(--pine-deep, #1b4d3e)', fontWeight: 600 }}>
                요구 희소값 구간: {Math.round(evaluation.result.event.band.min * 100)}~
                {Math.round(evaluation.result.event.band.max * 100)}점
              </span>
            </div>

            <div>
              <p className="small" style={{ margin: '0 0 6px' }}>
                <b>산출 구성:</b> 행사 {evaluation.result.event.parts.event}점 + 관계{' '}
                {evaluation.result.event.parts.relation > 0 ? '+' : ''}
                {evaluation.result.event.parts.relation}점 + 발신 주체{' '}
                {evaluation.result.event.parts.sender > 0 ? '+' : ''}
                {evaluation.result.event.parts.sender}점 + 목적{' '}
                {evaluation.result.event.parts.purpose > 0 ? '+' : ''}
                {evaluation.result.event.parts.purpose}점 (0~100점 범위)
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                * 행사 점수에 따라 매칭 필터가 작동하여, 희소 속성이 이 구간에 부합하는 상품만 1차 적격 후보가 됩니다.
              </p>
              {evaluation.result.event.incomplete && (
                <p className="notice" style={{ marginTop: 8, padding: '6px 10px', fontSize: 12 }}>
                  ⚠ 발신 주체 또는 행사 목적이 미입력 상태입니다. 공식 제안 문서 작성 전 보완이 필요합니다.
                </p>
              )}
            </div>
          </div>

          <h3 style={{ fontSize: 15, margin: '20px 0 10px' }}>
            추천 후보 상품 <span className="small muted">(적격 필터 통과 후 실속·신뢰·실용성 종합 상위 최대 3개)</span>
          </h3>

          {evaluation.result.selected.length === 0 ? (
            <div className="notice" style={{ margin: 0 }}>
              <p className="small muted" style={{ margin: 0 }}>
                현재 조건의 허용 기준을 만족하는 검수 상품이 없습니다. 아래 3단계 ‘전체 상품 판정 결과’에서 제외 사유를 확인해 보세요.
              </p>
            </div>
          ) : (
            <div className="lab-candidates-grid">
              {evaluation.result.selected.map((d, idx) => (
                <div key={d.product.productNo} className="lab-candidate-card">
                  <div>
                    <div className="row spread" style={{ alignItems: 'center' }}>
                      <span className="lab-rank-pill">추천 {idx + 1}위</span>
                      <span className="small muted">#{d.product.productNo}</span>
                    </div>
                    <div className="lab-candidate-title">{d.product.name}</div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      단가 {won(d.product.price)} · {input.quantity}개 합계 {won(d.product.price * input.quantity)}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 10, marginTop: 4 }}>
                    <div className="row spread" style={{ fontSize: 12, marginBottom: 4 }}>
                      <span className="muted">순위 평가 점수</span>
                      <b style={{ color: 'var(--pine-deep, #1b4d3e)' }}>{d.rankScore}점</b>
                    </div>
                    <div className="row spread" style={{ fontSize: 12, marginBottom: 6 }}>
                      <span className="muted">상품 희소값</span>
                      <b>{d.rarity.value !== null ? `${Math.round(d.rarity.value * 100)}점` : '미산출'}</b>
                    </div>
                    <p className="small muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4 }}>
                      ✓ {d.reason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {evaluation.result.notice && (
            <p className="small muted" style={{ marginTop: 12 }}>
              ℹ {evaluation.result.notice}
            </p>
          )}
        </section>
      )}

      {/* 기본 흐름 3단계: 모든 상품의 판정 결과와 제외 사유 비교 */}
      {evaluation.result && (
        <section className="lab-step-panel">
          <h2>3. 전체 상품 판정 결과 및 제외 사유 비교</h2>
          <p className="small muted" style={{ margin: '0 0 12px' }}>
            모든 상품의 희소 기준 통과 여부와 제외 사유를 한눈에 비교합니다. 미검수나 근거 부족으로 제외된 상품을 쉽게 확인하고 보강할 수 있습니다.
          </p>

          <div className="lab-filter-bar">
            <div className="lab-filter-chips" role="tablist" aria-label="판정 결과 필터">
              <button
                type="button"
                className={tableFilter === 'all' ? 'lab-filter-chip active' : 'lab-filter-chip'}
                onClick={() => setTableFilter('all')}
              >
                전체 ({evaluation.result.decisions.length})
              </button>
              <button
                type="button"
                className={tableFilter === 'eligible' ? 'lab-filter-chip active' : 'lab-filter-chip'}
                onClick={() => setTableFilter('eligible')}
              >
                ✓ 적격 후보 ({evaluation.result.decisions.filter((d) => d.eligible).length})
              </button>
              <button
                type="button"
                className={tableFilter === 'ineligible' ? 'lab-filter-chip active' : 'lab-filter-chip'}
                onClick={() => setTableFilter('ineligible')}
              >
                ✗ 제외 상품 ({evaluation.result.decisions.filter((d) => !d.eligible).length})
              </button>
              <button
                type="button"
                className={tableFilter === 'unreviewed' ? 'lab-filter-chip active' : 'lab-filter-chip'}
                onClick={() => setTableFilter('unreviewed')}
              >
                ⚠ 미검수/근거부족 ({evaluation.result.decisions.filter((d) => !d.rarity.reviewed || d.rarity.value === null).length})
              </button>
            </div>

            <div style={{ minWidth: 200 }}>
              <input
                type="search"
                placeholder="상품명 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 12.5,
                }}
              />
            </div>
          </div>

          <div className="lab-table-container">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>상품</th>
                  <th>상품 희소값</th>
                  <th>근거 충족도</th>
                  <th>판정</th>
                  <th>순위 평가</th>
                  <th>판정 및 제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {filteredDecisions.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--muted)' }}>
                      조건에 일치하는 상품이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredDecisions.map((d) => (
                    <tr key={d.product.productNo}>
                      <td>
                        <div>
                          <span>{d.product.name}</span>
                          <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 2 }}>
                            <span className="small muted">#{d.product.productNo} · {won(d.product.price)}</span>
                            {workspace.source === 'catalog' && (
                              <a
                                href="/admin/formality"
                                className="small"
                                style={{ color: 'var(--pine-deep, #1b4d3e)', textDecoration: 'underline' }}
                                title="상품 평가 화면에서 근거 확인 및 검수하기"
                              >
                                [검수 화면]
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <b>
                          {d.rarity.value !== null
                            ? `${Math.round(d.rarity.value * 100)}점 (${d.rarity.value.toFixed(2)})`
                            : '산출 보류'}
                        </b>
                      </td>
                      <td>
                        <span className="small">
                          {d.rarity.used.length}/5개 ·{' '}
                          {d.rarity.reviewed ? (
                            <span className="lab-badge lab-badge-reviewed">검수 확인</span>
                          ) : (
                            <span className="lab-badge lab-badge-unreviewed">미검수</span>
                          )}
                        </span>
                      </td>
                      <td>
                        {d.eligible ? (
                          <span className="lab-badge lab-badge-eligible">✓ 적격</span>
                        ) : (
                          <span className="lab-badge lab-badge-ineligible">✗ 제외</span>
                        )}
                      </td>
                      <td>{d.rankScore === null ? <span className="small muted">평가 제외</span> : `${d.rankScore}점`}</td>
                      <td>
                        <span className="small" style={{ color: d.eligible ? 'var(--text)' : '#b91c1c' }}>
                          {d.reason}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="spread" style={{ alignItems: 'center', marginTop: 14 }}>
            <span className="small muted">
              표시 중: {filteredDecisions.length}개 / 전체 {evaluation.result.decisions.length}개
            </span>
            <button className="btn ghost small" onClick={() => download(true)}>
              판정 결과·당시 자료 JSON 내보내기
            </button>
          </div>
        </section>
      )}

      {/* 하단: 고급 시험 기능 (접을 수 있는 details) */}
      <details className="lab-advanced-panel">
        <summary>고급 시험 기능 (기준표·상품 근거 가상 편집 및 파일 입출력)</summary>

        <div className="lab-simulation-warning">
          <b>⚠️ 시뮬레이션 전용 안내:</b> 이곳에서 수정한 기준표나 근거값은 이 브라우저 세션에서만 임시 적용되는{' '}
          <b>가상 시험용</b>입니다. 브라우저를 새로고침하면 초기화되며, 실제 운영 DB나 로컬 저장소에는 반영되지 않습니다.{' '}
          실제 상품 근거 저장과 검수는 <a href="/admin/formality" style={{ color: 'inherit', textDecoration: 'underline' }}>상품 평가 화면</a>에서 진행해 주세요.
        </div>

        {/* 1. 상품별 희소 근거 임시 편집 */}
        <section style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: 16, margin: '0 0 8px' }}>상품별 희소 근거 가상 편집 (시험용)</h3>
          <p className="small muted" style={{ margin: '0 0 12px' }}>
            특정 상품의 5대 희소 속성 점수를 임의로 변경하여 판정 결과가 어떻게 달라지는지 즉시 시험할 수 있습니다.
          </p>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span className="small" style={{ fontWeight: 600 }}>근거 편집 대상 상품: </span>
            <select
              aria-label="근거 편집 상품"
              value={selectedNo}
              onChange={(e) => setSelectedNo(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
            >
              {active.products.map((p) => (
                <option key={p.productNo} value={p.productNo}>
                  #{p.productNo} {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="lab-table-container">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>속성·초기 평가 기준</th>
                  <th>평가값 (0~10)</th>
                  <th>자료·출처와 판단 근거</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(RARE_FACTORS) as RareFactor[]).map((key) => (
                  <tr key={key}>
                    <td>
                      <b>{RARE_FACTORS[key].name}</b>
                      <p className="small muted" style={{ maxWidth: 310, margin: '3px 0 0' }}>
                        {RARE_FACTORS[key].guide}
                      </p>
                    </td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <input
                          type="checkbox"
                          aria-label={`${RARE_FACTORS[key].name} 입력됨`}
                          checked={Boolean(evidence.factors[key])}
                          onChange={(e) =>
                            editEvidence((item) => {
                              if (e.target.checked) item.factors[key] = { score: 0, basis: '' };
                              else delete item.factors[key];
                            })
                          }
                        />
                        <span className="small">{evidence.factors[key] ? '입력됨' : '미입력'}</span>
                      </label>
                      {evidence.factors[key] && (
                        <Num
                          label={`${RARE_FACTORS[key].name} 점수`}
                          value={evidence.factors[key]!.score}
                          min={0}
                          max={10}
                          step={0.1}
                          onValue={(n) =>
                            editEvidence((item) => {
                              item.factors[key]!.score = n;
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {evidence.factors[key] && (
                        <textarea
                          aria-label={`${RARE_FACTORS[key].name} 근거`}
                          rows={2}
                          maxLength={2000}
                          style={{
                            width: '100%',
                            minWidth: 220,
                            padding: '6px 8px',
                            border: '1px solid #cbd5e1',
                            borderRadius: 6,
                            fontSize: 12.5,
                          }}
                          value={evidence.factors[key]!.basis}
                          onChange={(e) =>
                            editEvidence((item) => {
                              item.factors[key]!.basis = e.target.value;
                            })
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <input
              aria-label="상품 근거 검수 확인"
              type="checkbox"
              checked={evidence.reviewed}
              onChange={(e) =>
                editEvidence((item) => {
                  item.reviewed = e.target.checked;
                }, true)
              }
            />
            <span className="small" style={{ fontWeight: 600 }}>
              {workspace.source === 'sample' ? '가상 자료로 검수 확인 상태 부여' : '운영자 검수 완료 상태 부여 (가상 시험용)'}
            </span>
          </label>
        </section>

        {/* 2. 기준표 가상 편집 */}
        <section style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: 16, margin: '0 0 8px' }}>격식 기준표 편집 (시뮬레이션용)</h3>
          <p className="small muted" style={{ margin: '0 0 12px' }}>
            행사 기본점수, 관계 보정, 허용 희소 구간 및 순위 가중치를 수정하여 전체 상품 추천 시뮬레이션에 적용합니다.
          </p>

          <p>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              기준 버전:{' '}
              <input
                aria-label="기준 버전"
                value={workspace.policy.version}
                maxLength={80}
                onChange={(e) =>
                  edit((w) => {
                    w.policy.version = e.target.value;
                  })
                }
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
              />
            </label>
          </p>

          <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
            {(['eventBase', 'relationShift', 'senderShift', 'purposeShift'] as const).map((group) => {
              const labels =
                group === 'eventBase'
                  ? OCCASIONS
                  : group === 'relationShift'
                    ? RELATIONS
                    : group === 'senderShift'
                      ? SENDERS
                      : PURPOSES;
              const values = workspace.policy[group];
              const limit = group === 'senderShift' || group === 'purposeShift' ? 20 : 100;
              return (
                <div key={group} style={{ minWidth: 160 }}>
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>
                    {
                      ({
                        eventBase: '행사 기본점수',
                        relationShift: '관계 보정',
                        senderShift: '주체 보정',
                        purposeShift: '목적 보정',
                      })[group]
                    }
                  </h4>
                  {Object.entries(values).map(([key, value]) => (
                    <p key={key} style={{ margin: '4px 0' }}>
                      <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                        <span>{(labels as Record<string, string>)[key]}</span>
                        <Num
                          label={`${group} ${key}`}
                          min={group === 'eventBase' ? 0 : -limit}
                          max={limit}
                          value={value}
                          onValue={(n) =>
                            edit((w) => {
                              (w.policy[group] as Record<string, number>)[key] = n;
                            })
                          }
                        />
                      </label>
                    </p>
                  ))}
                </div>
              );
            })}
          </div>

          <h4 style={{ fontSize: 14, margin: '16px 0 6px' }}>행사 점수 구간별 희소값 허용 범위</h4>
          <div className="lab-table-container">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>구간 시작 점수</th>
                  <th>허용 하한 (0~1)</th>
                  <th>허용 상한 (0~1)</th>
                </tr>
              </thead>
              <tbody>
                {workspace.policy.bands.map((band, i) => (
                  <tr key={i}>
                    {(['from', 'min', 'max'] as const).map((key) => (
                      <td key={key}>
                        <Num
                          label={`구간 ${i + 1} ${key}`}
                          value={band[key]}
                          min={0}
                          max={key === 'from' ? 100 : 1}
                          step={key === 'from' ? 1 : 0.01}
                          onValue={(n) =>
                            edit((w) => {
                              w.policy.bands[i][key] = n;
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 style={{ fontSize: 14, margin: '16px 0 6px' }}>희소 속성 결합 가중치</h4>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {(Object.keys(RARE_FACTORS) as RareFactor[]).map((key) => (
              <label key={key} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{RARE_FACTORS[key].name}</span>
                <Num
                  label={`${RARE_FACTORS[key].name} 가중치`}
                  value={workspace.policy.rarityWeights[key]}
                  min={0}
                  max={100}
                  onValue={(n) =>
                    edit((w) => {
                      w.policy.rarityWeights[key] = n;
                    })
                  }
                />
              </label>
            ))}
          </div>

          <h4 style={{ fontSize: 14, margin: '16px 0 6px' }}>필터 통과 후 순위 가중치</h4>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {(Object.keys(RANK_FACTORS) as (keyof typeof RANK_FACTORS)[]).map((key) => (
              <label key={key} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{RANK_FACTORS[key]}</span>
                <Num
                  label={`${key} 순위 가중치`}
                  value={workspace.policy.rankWeights[key]}
                  min={0}
                  max={100}
                  onValue={(n) =>
                    edit((w) => {
                      w.policy.rankWeights[key] = n;
                    })
                  }
                />
              </label>
            ))}
          </div>
        </section>

        {/* 3. 파일 내보내기 / 불러오기 */}
        <section>
          <h3 style={{ fontSize: 16, margin: '0 0 8px' }}>검증 설정 파일 저장 및 복원</h3>
          <p className="small muted" style={{ margin: '0 0 12px' }}>
            임시 수정한 기준표와 가상 근거를 JSON 파일로 보관하거나, 보관해 둔 설정 파일을 불러와 시뮬레이션을 재개할 수 있습니다.
          </p>

          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn ghost small" onClick={() => download(false)}>
              기준·근거 파일 내보내기 (.json)
            </button>
            <label className="btn ghost small" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <span>기준·근거 파일 불러오기</span>
              <input
                aria-label="기준·근거 파일 불러오기"
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {message && (
            <p role="status" className="small" style={{ marginTop: 8, color: 'var(--pine-deep, #1b4d3e)' }}>
              {message}
            </p>
          )}
        </section>
      </details>
    </>
  );
}
