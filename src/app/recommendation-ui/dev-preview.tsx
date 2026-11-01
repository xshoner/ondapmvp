'use client';

import { useMemo, useState } from 'react';
import type { ErrorCode, RecommendationRequest, RecommendationResponse } from '@/recommendation/contracts.ts';
import { coreUiFixtures } from './fixtures.ts';
import { createMockRecommendationServices } from './mock-services.ts';
import { CustomerRecommendationView } from './customer-view.tsx';
import { CoreAdminWorkbench } from './admin-workbench.tsx';
import { CoreAdminWeightsEditor } from './admin-weights-editor.tsx';
import { CoreAdminVerifyView } from './admin-verify-view.tsx';
import './recommendation-ui.css';

export function DevPreview() {
  const getInitialTab = () => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'admin-workbench' || t === 'admin-weights' || t === 'admin-verify') return t;
    }
    return 'customer';
  };

  const getInitialScenario = () => {
    if (typeof window !== 'undefined') {
      const s = new URLSearchParams(window.location.search).get('scenario');
      if (s) return s;
    }
    return 'three';
  };

  const getInitialMobile = () => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('mobile') === 'true';
    }
    return false;
  };

  const getInitialError = (): ErrorCode | null => {
    if (typeof window !== 'undefined') {
      const err = new URLSearchParams(window.location.search).get('error');
      if (err) return err as ErrorCode;
    }
    return null;
  };

  const getInitialConflict = (): boolean => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('conflict') === 'true';
    }
    return false;
  };

  const [activeTab, setActiveTab] = useState<'customer' | 'admin-workbench' | 'admin-weights' | 'admin-verify'>(getInitialTab);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(getInitialScenario);
  const [isMobileFrame, setIsMobileFrame] = useState(getInitialMobile);

  // 시뮬레이션 오류 설정
  const [simulateError, setSimulateError] = useState<ErrorCode | null>(getInitialError);
  const [simulateConflict, setSimulateConflict] = useState<boolean>(getInitialConflict);

  // Mock 서비스 인스턴스 (옵션 변경 시 재생성)
  const mockServices = useMemo(() => {
    return createMockRecommendationServices({
      simulateError,
      simulateConflict,
    });
  }, [simulateError, simulateConflict]);

  // 사전 생성된 가상 fixture 응답
  const scenarioFixture = coreUiFixtures.recommendations.find((r) => r.id === activeScenarioId);
  const currentResponse: RecommendationResponse | undefined = scenarioFixture?.response;

  return (
    <div className="dev-preview-container" style={{ minHeight: '100vh', background: '#F8F7F4', padding: '16px 20px', fontFamily: 'sans-serif' }}>
      {/* 개발자 전용 툴바 헤더 */}
      <header
        style={{
          background: '#1E293B',
          color: '#FFF',
          padding: '12px 18px',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, background: '#3B82F6', padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
            개발 미리보기
          </span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>온답 핵심 추천 재설계 UI (core-contract-v1)</span>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>[포트: 3320]</span>
        </div>

        {/* 탭 네비게이션 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setActiveTab('customer')}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'customer' ? '#3B82F6' : '#334155',
              color: '#FFF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            고객 추천 결과 화면
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin-workbench')}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'admin-workbench' ? '#3B82F6' : '#334155',
              color: '#FFF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            관리자 격식지수 판정
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin-weights')}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'admin-weights' ? '#3B82F6' : '#334155',
              color: '#FFF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            관리자 가중치 설정
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin-verify')}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'admin-verify' ? '#3B82F6' : '#334155',
              color: '#FFF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            알고리즘 검증실
          </button>

          {/* 모바일 375px 프레임 토글 */}
          <button
            type="button"
            onClick={() => setIsMobileFrame(!isMobileFrame)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #475569',
              background: isMobileFrame ? '#10B981' : '#334155',
              color: '#FFF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              marginLeft: 8,
            }}
          >
            {isMobileFrame ? '375px 모바일 해제' : '📱 375px 모바일 보기'}
          </button>
        </div>
      </header>

      {/* 시나리오 및 오류 상태 컨트롤러 (탭별) */}
      <section
        style={{
          background: '#FFF',
          padding: '12px 16px',
          border: '1px solid var(--line, #E6E1D8)',
          borderRadius: 8,
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {activeTab === 'customer' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink, #333)' }}>
              가상 Fixture 시나리오:
            </span>
            {coreUiFixtures.recommendations.map((rec) => (
              <button
                key={rec.id}
                type="button"
                onClick={() => setActiveScenarioId(rec.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 4,
                  border: activeScenarioId === rec.id ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                  background: activeScenarioId === rec.id ? '#ECFDF5' : '#FFF',
                  color: activeScenarioId === rec.id ? 'var(--pine, #2D5A43)' : 'var(--ink, #333)',
                  fontSize: 12,
                  fontWeight: activeScenarioId === rec.id ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                {rec.id === 'three'
                  ? '후보 3개 (three)'
                  : rec.id === 'one'
                  ? '후보 1개 (one)'
                  : rec.id === 'none'
                  ? '후보 0개 (none)'
                  : rec.id === 'no-budget'
                  ? '예산 없음 (no-budget)'
                  : rec.id === 'total-budget'
                  ? '전체 예산 (total-budget)'
                  : rec.id === 'tiny-total-budget'
                  ? '예산 초과 (tiny-total-budget)'
                  : rec.id === 'legacy'
                  ? '과거 평가 (legacy)'
                  : rec.id === 'mixed'
                  ? '혼합 평가 (mixed)'
                  : rec.id === 'unreviewed'
                  ? '미검수 제외 (unreviewed)'
                  : rec.id}
              </button>
            ))}
          </div>
        )}

        {/* 오류 시뮬레이터 (AI 오류, 저장 충돌, 저장 오류) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--muted, #666)' }}>오류 시뮬레이션:</span>
          <button
            type="button"
            onClick={() => setSimulateError(simulateError === 'ai_failed' ? null : 'ai_failed')}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: simulateError === 'ai_failed' ? '2px solid #DC2626' : '1px solid var(--line, #E6E1D8)',
              background: simulateError === 'ai_failed' ? '#FEF2F2' : '#FFF',
              color: simulateError === 'ai_failed' ? '#DC2626' : 'var(--ink, #333)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {simulateError === 'ai_failed' ? '✓ AI 실패 활성' : 'AI 실패 시뮬'}
          </button>

          <button
            type="button"
            onClick={() => setSimulateConflict(!simulateConflict)}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: simulateConflict ? '2px solid #DC2626' : '1px solid var(--line, #E6E1D8)',
              background: simulateConflict ? '#FEF2F2' : '#FFF',
              color: simulateConflict ? '#DC2626' : 'var(--ink, #333)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {simulateConflict ? '✓ 개정 충돌 활성' : '저장 충돌(409) 시뮬'}
          </button>

          <button
            type="button"
            onClick={() => setSimulateError(simulateError === 'save_failed' ? null : 'save_failed')}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: simulateError === 'save_failed' ? '2px solid #DC2626' : '1px solid var(--line, #E6E1D8)',
              background: simulateError === 'save_failed' ? '#FEF2F2' : '#FFF',
              color: simulateError === 'save_failed' ? '#DC2626' : 'var(--ink, #333)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {simulateError === 'save_failed' ? '✓ 저장 실패 활성' : '저장 실패(500) 시뮬'}
          </button>

          {(simulateError || simulateConflict) && (
            <button
              type="button"
              onClick={() => {
                setSimulateError(null);
                setSimulateConflict(false);
              }}
              style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: '#F1F5F9', fontSize: 11, cursor: 'pointer' }}
            >
              초기화
            </button>
          )}
        </div>
      </section>

      {/* 본문 콘텐츠 렌더링 (모바일 프레임 지원) */}
      <div
        style={
          isMobileFrame
            ? {
                maxWidth: 375,
                margin: '0 auto',
                border: '8px solid #334155',
                borderRadius: 24,
                overflow: 'hidden',
                background: '#FFF',
                minHeight: 667,
                boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
              }
            : {}
        }
      >
        {activeTab === 'customer' && (
          <CustomerRecommendationView
            key={`${activeScenarioId}-${simulateError}-${simulateConflict}`}
            services={mockServices}
            initialResponse={currentResponse}
            initialRequest={currentResponse?.request}
            approvalEnabled={true}
          />
        )}

        {activeTab === 'admin-workbench' && (
          <CoreAdminWorkbench
            key={`workbench-${simulateError}-${simulateConflict}`}
            services={mockServices}
            initialWorkspace={coreUiFixtures.workspace}
          />
        )}

        {activeTab === 'admin-weights' && (
          <CoreAdminWeightsEditor
            key={`weights-${simulateError}-${simulateConflict}`}
            services={mockServices}
            initialPolicyDoc={coreUiFixtures.policy}
          />
        )}

        {activeTab === 'admin-verify' && (
          <CoreAdminVerifyView
            key={`verify-${simulateError}-${simulateConflict}`}
            services={mockServices}
            initialWorkspace={coreUiFixtures.workspace}
            isSimulatedData={true}
          />
        )}
      </div>
    </div>
  );
}
