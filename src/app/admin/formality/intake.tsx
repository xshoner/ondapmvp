'use client';

import { useState, useTransition } from 'react';
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
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  const selectedProduct = pilot.products.find((p) => p.productNo === selected);
  const completed = keys.filter((key) => draft.factors[key]?.basis.trim()).length;
  const list = pilot.products.filter((p) => p.name.includes(query.trim()));

  const update = (next: Item) => {
    setDraft({ ...next, reviewed: false, rarity: null });
    setDirty(true);
    setMessage('');
  };

  const choose = (no: number) => {
    if (no === selected) return;
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 다른 상품으로 이동하시겠습니까?')) return;
    setSelected(no);
    setDraft(structuredClone(pilot.items[String(no)] ?? empty()));
    setDirty(false);
    setMessage('');
  };

  const run = (fn: () => Promise<void>) => start(async () => {
    setMessage('');
    try { await fn(); }
    catch (e) { setMessage(e instanceof Error ? e.message : '처리하지 못했습니다.'); }
  });

  const changeFactor = (key: RareFactor, value: { level: Level; basis: string } | null) => {
    const factors = { ...draft.factors };
    if (value) factors[key] = value; else delete factors[key];
    update({ ...draft, factors });
  };

  function save(reviewed: boolean) {
    run(async () => {
      const item = await savePilotItem(selected, draft.description, draft.factors, reviewed);
      setPilot((p) => ({ ...p, items: { ...p.items, [selected]: item } }));
      setDraft(item);
      setDirty(false);
      setMessage(reviewed ? '확인한 내용을 저장하고 상품 희소값을 계산했습니다. 이제 아래에서 행사 적합성을 시험할 수 있습니다.' : '입력 내용을 임시 저장했습니다 (아직 미검수 상태입니다).');
    });
  }

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
          ① 카페24 상품 목록 및 설명 가져오기 → ② Gemini AI 자료 정리(원문 일치 문장만 추출) → ③ 운영자 확인·수정 및 희소값 계산(근거 2개 이상 필요) → ④ 행사 조건별 허용기준 충족 여부 시험 → ⑤ 격식 기준 검증실에서 전체 상품 평가.
        </p>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)' }} className="small">
          {mode === 'local' ? '로컬 시험 자료에 저장됩니다. 기존 고객 추천이나 운영 DB에는 영향을 주지 않습니다.' : '운영 DB에 상품 근거를 저장합니다. 상품 가져오기는 운영 상품 목록을 갱신하며 기존 고객 추천에도 영향을 줄 수 있습니다. 새 격식지수는 아직 고객 추천에 적용되지 않습니다.'}
        </p>
      </section>

      <div className="intake-layout">
        <aside className="intake-list panel" aria-label="시험 상품 목록">
          <div className="spread">
            <h2>상품 <span className="small muted">{pilot.products.length}개</span></h2>
            <button className="btn ghost small" disabled={pending} onClick={() => run(async () => {
              if (dirty && !window.confirm('입력 중인 내용은 저장되지 않습니다. 상품 목록을 가져올까요?')) return;
              const next = await importPilotProducts();
              setPilot(next);
              const no = next.products.some((p) => p.productNo === selected) ? selected : next.products[0]?.productNo ?? 0;
              setSelected(no);
              setDraft(structuredClone(next.items[String(no)] ?? empty()));
              setDirty(false);
              setMessage(`카페24 상품 ${next.products.length}개를 가져왔습니다.`);
            })}>
              카페24 상품 가져오기
            </button>
          </div>
          <label className="intake-search">
            <span className="small">상품 검색</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품명 검색" />
          </label>
          <div className="intake-product-list">
            {list.map((p) => (
              <button
                key={p.productNo}
                type="button"
                className={selected === p.productNo ? 'intake-product active' : 'intake-product'}
                onClick={() => choose(p.productNo)}
                disabled={pending}
                aria-current={selected === p.productNo ? 'true' : undefined}
              >
                <span>{p.name}</span>
                <small>#{p.productNo} · {pilot.items[String(p.productNo)]?.reviewed ? '✓ 검수 완료' : '미검수'}</small>
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="small muted">검색된 상품이 없습니다.</p>}
        </aside>

        <main className="intake-main">
          {!selectedProduct ? (
            <section className="panel">
              <h2>상품이 없습니다</h2>
              <p>카페24 상품 가져오기를 누르거나 로컬 카탈로그를 확인해 주세요.</p>
            </section>
          ) : (
            <>
              {/* 상단 요약 카드 */}
              <section className="panel intake-head">
                <div>
                  <p className="small muted">상품번호 {selectedProduct.productNo} · {selectedProduct.price.toLocaleString('ko-KR')}원</p>
                  <h2>{selectedProduct.name}</h2>
                  <p className="small muted">
                    {dirty ? '⚠ 저장되지 않은 수정이 있습니다' : draft.reviewed ? '✓ 운영자 검수 완료 (행사 시험 가능)' : '검수 전 (근거 확인 필요)'}
                  </p>
                </div>
                <div className="intake-result">
                  <span>상품 희소 속성값</span>
                  <strong>{draft.rarity == null ? '미산출' : `${(draft.rarity * 100).toFixed(0)}점`}</strong>
                  <small>{completed}개 항목 근거 입력 · {draft.reviewed ? '확인 완료' : '확인 전'}</small>
                </div>
              </section>

              {/* 1단계: 상품 정보 및 설명 */}
              <section className="panel intake-section">
                <div className="spread intake-section-title">
                  <div>
                    <h2>1. 상품 정보 및 확인 자료</h2>
                    <p className="small muted">
                      카페24에 등록된 상품 설명을 가져오거나, 생산자·산지·원재료 등 확인한 자료를 직접 입력합니다.
                    </p>
                  </div>
                  <button className="btn ghost small" disabled={pending} onClick={() => run(async () => {
                    if ((draft.description || Object.keys(draft.factors).length > 0) && !window.confirm('상품 설명을 새로 불러오면 입력 중인 내용이 갱신됩니다. 계속하시겠습니까?')) return;
                    const description = await loadDescription(selected);
                    update({ ...draft, description, factors: {} });
                    setMessage(description ? '카페24 상품 설명을 불러왔습니다.' : '카페24 상세설명에서 텍스트를 찾을 수 없습니다 (상세페이지가 이미지로만 구성되었거나 설명이 비어 있음). 아래 입력창에 확인한 내용을 직접 입력해 주세요.');
                  })}>
                    카페24 설명 가져오기
                  </button>
                </div>
                <label className="field">
                  <span>상품 설명 및 원자료 (텍스트)</span>
                  <textarea
                    disabled={pending}
                    aria-label="상품 설명 및 확인 자료"
                    rows={5}
                    maxLength={12000}
                    value={draft.description}
                    onChange={(e) => update({ ...draft, description: e.target.value })}
                    placeholder="상품 상세 설명을 가져오거나, 생산자 이력·산지·제작방식·전승 이력 등 확인한 원문을 붙여넣으세요. (이미지 속 글자는 읽지 못하므로 텍스트로 입력해야 합니다)"
                  />
                </label>
                <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <button
                    className="btn small"
                    disabled={pending || !draft.description.trim()}
                    onClick={() => run(async () => {
                      const factors = await suggestIntake(selected, draft.description);
                      const additions = Object.fromEntries(Object.entries(factors).filter(([key]) => !draft.factors[key as RareFactor]));
                      update({ ...draft, factors: { ...draft.factors, ...additions } });
                      setMessage(Object.keys(additions).length ? `AI가 원문에서 ${Object.keys(additions).length}개 항목의 근거 문장을 정리했습니다. 내용과 수준을 검토해 주세요.` : '원문에서 추가할 수 있는 근거를 찾지 못했습니다. 부족한 항목은 직접 입력해 주세요.');
                    })}
                  >
                    Gemini AI로 정보 정리
                  </button>
                  <span className="small muted">
                    * AI가 제시한 근거가 원문에 있는지 확인합니다. 해석과 수준은 운영자가 검토해야 합니다.
                  </span>
                </div>
              </section>

              {/* 2단계: 5대 희소 속성 검토 및 평가 */}
              <section className="panel intake-section">
                <h2>2. 5대 희소 속성 검토와 평가</h2>
                <p className="small muted">
                  특허출원서(청구항 4)의 5개 속성에 대해 실제 근거와 수준을 검토합니다. 근거가 있는 항목이 최소 2개 이상이어야 희소값을 계산할 수 있습니다. 모르는 항목은 미확인으로 남겨두세요.
                </p>
                <div className="intake-factors">
                  {keys.map((key) => {
                    const f = draft.factors[key];
                    return (
                      <div key={key} className="intake-factor">
                        <div>
                          <h3>{RARE_FACTORS[key].name}</h3>
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
                            <span className="small">확인한 내용 및 출처 (원문 근거)</span>
                            <textarea
                              disabled={pending}
                              aria-label={`${RARE_FACTORS[key].name} 확인한 내용`}
                              rows={2}
                              maxLength={2000}
                              value={f.basis}
                              onChange={(e) => changeFactor(key, { ...f, basis: e.target.value })}
                              placeholder="확인한 근거 문장이나 공식 출처를 입력하세요."
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="intake-actions">
                  <button className="btn ghost small" disabled={pending} onClick={() => save(false)}>
                    임시 저장 (미검수)
                  </button>
                  <button className="btn small" disabled={pending || completed < 2} onClick={() => save(true)}>
                    확인하고 계산하기 (검수 완료)
                  </button>
                  <span className="small muted">
                    {pending ? '저장 및 계산 중…' : completed < 2 ? '⚠ 근거가 있는 속성이 2개 이상 필요합니다' : '✓ 검수 완료 시 행사 적합성 시험이 활성화됩니다'}
                  </span>
                </div>
                {message && <p role="status" className="notice" style={{ marginTop: 12 }}>{message}</p>}
              </section>

              {/* 3단계: 행사 적합성 시험 */}
              {eventTest ? (
                <EventTest
                  key={`${selected}:${JSON.stringify(draft.factors)}:${draft.reviewed}`}
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
    </>
  );
}
