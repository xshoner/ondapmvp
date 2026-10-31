import { getCatalog } from '@/data/repository.ts';
import { WeightsEditor } from './weights-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function WeightsPage() {
  const catalog = await getCatalog();
  return (
    <>
      <header className="page-head">
        <h1>가중치 설정 (v1 운영)</h1>
        <p>
          현재 운영 고객 추천(v0.1)의 행사·관계별 가중치 설정입니다. 새 격식지수 v2의 행사 격식 기준 및 허용구간은{' '}
          <a className="text-link" href="/admin/formality/lab">격식 검증실</a>에서 조정할 수 있습니다.
        </p>
      </header>
      <WeightsEditor catalog={catalog} />
    </>
  );
}
