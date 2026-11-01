import { getCatalog } from '@/data/repository.ts';
import { WeightsEditor } from './weights-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function WeightsPage() {
  const catalog = await getCatalog();
  return (
    <>
      <header className="page-head">
        <h1>격식지수 기준 설정</h1>
        <p>
          저장한 기준은 고객 추천과 관리자 검증에 적용됩니다. <a className="text-link" href="/admin/formality/lab">격식 검증실</a>에서 다른 기준을 시험할 수 있습니다.
        </p>
      </header>
      <WeightsEditor catalog={catalog} />
    </>
  );
}
