'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  AdminWorkspace,
  EventId,
  RecommendationRequest,
  RecommendationResponse,
  RecommendationServices,
  RelationId,
} from '../../recommendation/contracts.ts';
import { EVENT_NAMES, RELATION_NAMES, won } from './types.ts';
import { CoreScoreBreakdown } from './score-breakdown.tsx';

const SAMPLE_BUDGETS = [30000, 50000, 70000, 100000, null];

type CellResult =
  | { status: 'loading' }
  | { status: 'success'; data: RecommendationResponse }
  | { status: 'error'; error: string };

export interface AdminVerifyViewProps {
  services: RecommendationServices;
  initialWorkspace?: AdminWorkspace;
  isSimulatedData?: boolean;
}

export function CoreAdminVerifyView({
  services,
  initialWorkspace,
  isSimulatedData = true,
}: AdminVerifyViewProps) {
  const [budget, setBudget] = useState<number | null>(50000);
  const [selectedCell, setSelectedCell] = useState<{ event: EventId; relation: RelationId } | null>(null);
  const [cellResults, setCellResults] = useState<Record<string, CellResult>>({});
  const [isRunning, setIsRunning] = useState(false);

  // 실행 세대 번호 (빠른 예산 변경 시 이전 계산 역전 방지) [P2-7]
  const runIdRef = useRef(0);

  // 8개 주요 행사 × 4개 관계 = 32개 시나리오
  const targetEvents: EventId[] = ['funeral', 'wedding', 'longevity', 'birth', 'promotion', 'opening', 'thanks', 'birthday'];
  const targetRelations: RelationId[] = ['senior', 'business', 'peer', 'family'];

  const runAllScenarios = async (b: number | null) => {
    const currentRunId = ++runIdRef.current;
    setIsRunning(true);

    // 모든 셀을 loading 상태로 초기화
    const initialCells: Record<string, CellResult> = {};
    for (const ev of targetEvents) {
      for (const rel of targetRelations) {
        initialCells[`${ev}:${rel}`] = { status: 'loading' };
      }
    }
    setCellResults(initialCells);

    // 각 시나리오 병렬 실행 (개별 셀별 실패 및 성공을 세밀하게 분리 추적)
    const promises = targetEvents.flatMap((ev) =>
      targetRelations.map(async (rel) => {
        const key = `${ev}:${rel}`;
        const req: RecommendationRequest = {
          event: ev,
          relation: rel,
          quantity: 10,
          budget: b !== null ? { mode: 'per_item', amount: b } : { mode: 'none' },
          excludedProductNos: [],
          sender: 'unknown',
          purpose: 'unknown',
        };

        try {
          const res = await services.recommend(req);
          if (currentRunId !== runIdRef.current) return;

          if (res.ok) {
            setCellResults((prev) => ({
              ...prev,
              [key]: { status: 'success', data: res.data },
            }));
          } else {
            setCellResults((prev) => ({
              ...prev,
              [key]: { status: 'error', error: res.error.message },
            }));
          }
        } catch (err) {
          if (currentRunId !== runIdRef.current) return;
          setCellResults((prev) => ({
            ...prev,
            [key]: {
              status: 'error',
              error: err instanceof Error ? err.message : '통신 오류',
            },
          }));
        }
      }),
    );

    await Promise.all(promises);
    if (currentRunId === runIdRef.current) {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    runAllScenarios(budget);
  }, [budget]);

  // 메트릭 계산: 성공한 셀과 실패한 셀을 정확하게 구분 집계 [P2-7]
  const entries = Object.entries(cellResults);
  const successList = entries
    .filter((e): e is [string, { status: 'success'; data: RecommendationResponse }] => e[1].status === 'success')
    .map((e) => e[1].data);
  const errorCount = entries.filter((e) => e[1].status === 'error').length;
  const loadingCount = entries.filter((e) => e[1].status === 'loading').length;

  const firsts = new Set(successList.map((r) => r.items[0]?.productNo).filter(Boolean));
  const appeared = new Set(successList.flatMap((r) => r.items.map((x) => x.productNo)));
  const noCandidatesCount = successList.filter((r) => r.items.length === 0).length;
  const fewCandidatesCount = successList.filter((r) => r.items.length > 0 && r.items.length < 3).length;

  const selectedKey = selectedCell ? `${selectedCell.event}:${selectedCell.relation}` : null;
  const activeCellResult = selectedKey ? cellResults[selectedKey] : null;

  return (
    <div className="admin-verify-view" style={{ display: 'grid', gap: 20 }}>
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>알고리즘 검증 매트릭스</h1>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: isSimulatedData ? '#FFFBEB' : '#ECFDF5',
                  color: isSimulatedData ? '#B45309' : '#047857',
                  border: isSimulatedData ? '1px solid #FCD34D' : '1px solid #A7F3D0',
                  fontWeight: 600,
                }}
              >
                {isSimulatedData ? '가상 시험 데이터 환경' : '운영 데이터 환경'}
              </span>
              {isRunning && (
                <span style={{ fontSize: 12, color: '#0369A1', fontWeight: 600 }}>
                  (계산 중… 남은 셀: {loadingCount}개)
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft, #555)' }}>
              행사 8종 × 관계 4종 = 32개 조합에 대해 추천 엔진을 실행하여 결과를 대조 검증합니다.
            </p>
          </div>

          {/* 예산 칩 선택기 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SAMPLE_BUDGETS.map((b) => (
              <button
                key={String(b)}
                type="button"
                onClick={() => setBudget(b)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 16,
                  border: budget === b ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                  background: budget === b ? '#ECFDF5' : '#FFF',
                  color: budget === b ? 'var(--pine, #2D5A43)' : 'var(--ink, #333)',
                  fontSize: 12,
                  fontWeight: budget === b ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {b !== null ? `1개 ${won(b)} 이하` : '예산 없음'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 요약 메트릭 카드: 성공/실패 건수 명확 분리 [P2-7] */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 14px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted, #666)' }}>실행 상태 (32개 조합)</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: errorCount > 0 ? '#DC2626' : 'var(--pine, #2D5A43)' }}>
            성공 {successList.length} / 실패 {errorCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            {errorCount > 0 ? '일부 시나리오에서 오류 발생' : '전체 시나리오 응답 완료'}
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted, #666)' }}>1위 추천 상품 다양성</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: 'var(--pine, #2D5A43)' }}>
            {firsts.size}종
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            상황별 차별화된 1위 추천 여부
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted, #666)' }}>1~3위 노출 상품</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{appeared.size}종</div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            전체 카탈로그 중 노출 상품 수
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted, #666)' }}>후보 부족 / 0개 결과</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: noCandidatesCount > 0 ? '#B45309' : 'inherit' }}>
            부족 {fewCandidatesCount} / 0개 {noCandidatesCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
            후보 1~2개 또는 조건 미충족
          </div>
        </div>
      </div>

      {errorCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, color: '#DC2626', fontSize: 13 }}>
          <span>일부 시나리오({errorCount}건)에서 요청 실패가 발생했습니다.</span>
          <button
            type="button"
            onClick={() => runAllScenarios(budget)}
            style={{ padding: '4px 10px', borderRadius: 4, background: '#DC2626', color: '#FFF', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            전체 재실행
          </button>
        </div>
      )}

      {/* 32개 매트릭스 테이블 */}
      <div style={{ overflowX: 'auto', background: '#FFF', border: '1px solid var(--line, #E6E1D8)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
          <thead>
            <tr style={{ background: 'var(--paper-deep, #F6F4EF)', borderBottom: '1px solid var(--line, #E6E1D8)' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', width: 90 }}>행사 \ 관계</th>
              {targetRelations.map((r) => (
                <th key={r} style={{ padding: '8px 10px', textAlign: 'left' }}>
                  {RELATION_NAMES[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targetEvents.map((ev) => (
              <tr key={ev} style={{ borderBottom: '1px solid var(--line, #E6E1D8)' }}>
                <th scope="row" style={{ padding: '8px 10px', textAlign: 'left', background: 'var(--paper-light, #FAF9F6)' }}>
                  {EVENT_NAMES[ev]}
                </th>
                {targetRelations.map((rel) => {
                  const key = `${ev}:${rel}`;
                  const cell = cellResults[key];
                  const isSelected = selectedCell?.event === ev && selectedCell?.relation === rel;

                  if (!cell || cell.status === 'loading') {
                    return (
                      <td key={rel} style={{ padding: '8px', color: 'var(--muted, #888)', textAlign: 'center' }}>
                        계산 중…
                      </td>
                    );
                  }

                  if (cell.status === 'error') {
                    return (
                      <td
                        key={rel}
                        onClick={() => setSelectedCell({ event: ev, relation: rel })}
                        style={{
                          padding: '6px 8px',
                          cursor: 'pointer',
                          background: '#FEF2F2',
                          color: '#DC2626',
                          fontWeight: 600,
                          border: isSelected ? '2px solid #DC2626' : undefined,
                        }}
                      >
                        [오류 발생]
                      </td>
                    );
                  }

                  const items = cell.data.items;
                  return (
                    <td
                      key={rel}
                      onClick={() => setSelectedCell({ event: ev, relation: rel })}
                      style={{
                        padding: '6px 8px',
                        cursor: 'pointer',
                        background: isSelected
                          ? '#ECFDF5'
                          : items.length === 0
                          ? '#FEF2F2'
                          : items.length < 3
                          ? '#FFFBEB'
                          : '#FFF',
                        outline: isSelected ? '2px solid var(--pine, #2D5A43)' : undefined,
                      }}
                    >
                      {items.length === 0 ? (
                        <div style={{ color: '#DC2626', fontWeight: 600 }}>후보 0개</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 2 }}>
                          {items.map((item, idx) => (
                            <div
                              key={item.productNo}
                              style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                fontWeight: idx === 0 ? 600 : 400,
                              }}
                            >
                              {idx + 1}. {item.name}{' '}
                              <span style={{ color: 'var(--pine, #2D5A43)', fontSize: 11 }}>
                                ({item.recommendationScore.toFixed(1)})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 선택된 시나리오 상세 분석 패널 */}
      {selectedCell && activeCellResult && (
        <section
          style={{
            padding: '18px 20px',
            background: '#FFF',
            border: '2px solid var(--pine, #2D5A43)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
              시나리오 상세: {EVENT_NAMES[selectedCell.event]} × {RELATION_NAMES[selectedCell.relation]} (
              {budget !== null ? won(budget) : '예산 없음'})
            </h2>
            <button
              type="button"
              onClick={() => setSelectedCell(null)}
              style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--muted, #888)' }}
            >
              ✕
            </button>
          </div>

          {activeCellResult.status === 'loading' ? (
            <div>계산 진행 중…</div>
          ) : activeCellResult.status === 'error' ? (
            <div style={{ color: '#DC2626', padding: '10px 0' }}>
              <b>오류 사유:</b> {activeCellResult.error}
            </div>
          ) : activeCellResult.data.items.length === 0 ? (
            <div style={{ color: '#DC2626', padding: '10px 0' }}>
              조건을 충족하는 후보 상품이 0개입니다. (제외 사유: {activeCellResult.data.exclusions.map((x) => x.code).join(', ') || '없음'})
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {activeCellResult.data.items.map((item) => (
                <div
                  key={item.productNo}
                  style={{
                    padding: '12px 14px',
                    border: '1px solid var(--line, #E6E1D8)',
                    borderRadius: 6,
                    background: 'var(--paper-light, #FAF9F6)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700 }}>
                      {item.rank}위. {item.name} ({won(item.unitPrice)})
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--pine, #2D5A43)' }}>
                      추천점수 S: {item.recommendationScore.toFixed(1)}점
                    </span>
                  </div>
                  <CoreScoreBreakdown item={item} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
