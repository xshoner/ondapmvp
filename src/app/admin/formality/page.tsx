import { requireAdmin } from '@/lib/admin-guard.ts';
import { loadAdminWorkspace } from '@/recommendation/server.ts';
import { FormalityClientView } from './client.tsx';

export const dynamic = 'force-dynamic';

export default async function FormalityPage() {
  await requireAdmin();
  const res = await loadAdminWorkspace();
  const initialWorkspace = res.ok ? res.data : undefined;
  const initialError = !res.ok ? res.error.message : undefined;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>격식지수 판정</h1>
        <p>
          상품별 5가지 속성(숙련도, 산지성, 유통, 역사, 스토리)에 대한 확인된 근거와 점수를 판정하고 검수합니다.
        </p>
      </header>
      <FormalityClientView
        initialWorkspace={initialWorkspace}
        initialError={initialError}
      />
    </div>
  );
}
