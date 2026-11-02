import { requireAdmin } from '@/lib/admin-guard.ts';
import { loadCorePolicy } from '@/recommendation/server.ts';
import { WeightsClientView } from './client.tsx';

export const dynamic = 'force-dynamic';

export default async function WeightsPage() {
  await requireAdmin();
  const res = await loadCorePolicy();
  const initialPolicyDoc = res.ok ? res.data : undefined;
  const initialError = !res.ok ? `[${res.error.code}] ${res.error.message}` : undefined;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>격식지수 기준 설정</h1>
        <p>
          행사별 기본 점수, 관계 보정치, 희소성 가중치 및 추천 점수 비중을 설정합니다. 저장된 기준은 고객 추천과 <a className="text-link" href="/admin/verify">알고리즘 검증</a>에 실시간 적용됩니다.
        </p>
      </header>
      <WeightsClientView
        initialPolicyDoc={initialPolicyDoc}
        initialError={initialError}
      />
    </div>
  );
}
