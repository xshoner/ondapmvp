'use client';

import { useMemo, useRef, useState } from 'react';
import { CoreAdminWorkbench } from '../../src/app/recommendation-ui/admin-workbench.tsx';
import { CoreAdminWeightsEditor } from '../../src/app/recommendation-ui/admin-weights-editor.tsx';
import { createMockRecommendationServices } from '../../src/app/recommendation-ui/mock-services.ts';
import { coreUiFixtures } from '../../src/app/recommendation-ui/fixtures.ts';
import type { RecommendationServices } from '../../src/recommendation/contracts.ts';

// Real React editors, controlled response timing, memory-only persistence. No production credentials or writes.
export function CoreUiReviewHarness() {
  const [mode, setMode] = useState<'assessment' | 'policy'>('assessment');
  const [remote, setRemote] = useState('');
  const [waiting, setWaiting] = useState('');
  const pending = useRef<{ resolve: () => void } | null>(null);
  const base = useMemo(() => createMockRecommendationServices(), []);
  const services = useMemo<RecommendationServices>(() => {
    async function hold(label: string) {
      setWaiting(label);
      await new Promise<void>((resolve) => { pending.current = { resolve }; });
      setWaiting('');
      pending.current = null;
    }
    return {
      ...base,
      async saveAssessment(command) {
        const result = await base.saveAssessment(command);
        setRemote(JSON.stringify({ assessment: base.getAssessments().find((a) => a.productNo === 900001) }));
        if (result.ok) await hold('저장 응답 대기');
        return result;
      },
      async savePolicy(command) {
        const result = await base.savePolicy(command);
        setRemote(JSON.stringify({ weights: base.getPolicy().scoreWeights }));
        if (result.ok) await hold('정책 응답 대기');
        return result;
      },
      async suggestAssessment(command) {
        const result = await base.suggestAssessment(command);
        await hold('AI 응답 대기');
        return result;
      },
    };
  }, [base]);
  async function externalEdit() {
    const current = await base.loadAssessment(900001);
    if (!current.ok) return;
    const assessment = structuredClone(current.data);
    assessment.factors.skill.basis = '[다른 관리자] 원격 변경';
    const result = await base.saveAssessment({ assessment, expectedUpdatedAt: assessment.updatedAt });
    setRemote(JSON.stringify(result));
  }
  return <div style={{ padding: 20 }}>
    <h1>검증 전용: 실제 UI / 메모리 저장 / 수동 응답 지연</h1>
    <nav style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      <button onClick={() => setMode('assessment')}>판정 시험</button>
      <button onClick={() => setMode('policy')}>정책 시험</button>
      <button onClick={externalEdit}>다른 관리자 원격 변경</button>
      <button onClick={() => pending.current?.resolve()} disabled={!waiting}>대기 응답 전달</button>
    </nav>
    <p role="status">{waiting}</p>
    <details><summary>서버에 실제 저장된 메모리 값</summary><pre data-testid="server-memory" style={{ whiteSpace: 'pre-wrap' }}>{remote}</pre></details>
    {mode === 'assessment'
      ? <CoreAdminWorkbench services={services} initialWorkspace={coreUiFixtures.workspace} />
      : <CoreAdminWeightsEditor services={services} initialPolicyDoc={coreUiFixtures.policy} />}
  </div>;
}
