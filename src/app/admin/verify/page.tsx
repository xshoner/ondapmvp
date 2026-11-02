import { requireAdmin } from '@/lib/admin-guard.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import { loadAdminWorkspace } from '@/recommendation/server.ts';
import { VerifyClientView } from './client.tsx';

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  await requireAdmin();
  const res = await loadAdminWorkspace();
  const initialWorkspace = res.ok ? res.data : undefined;
  const initialError = !res.ok ? `[${res.error.code}] ${res.error.message}` : undefined;

  const mode = dataSource();
  const environmentLabel =
    mode === 'local'
      ? '로컬 파일 데이터 환경 (새 서버 실시간 계산)'
      : 'Supabase DB 데이터 환경 (새 서버 실시간 계산)';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>알고리즘 검증</h1>
        <p>
          고객 추천과 동일한 새 계산 서버(core-contract-v1)로 행사 8 × 관계 4 = 32개 조합의 추천 결과를 실시간 계산하여 대조 검증합니다.
        </p>
      </header>
      <VerifyClientView
        initialWorkspace={initialWorkspace}
        initialError={initialError}
        environmentLabel={environmentLabel}
      />
    </div>
  );
}
