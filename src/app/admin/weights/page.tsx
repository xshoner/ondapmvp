import { getCatalog } from '@/data/repository.ts';
import { WeightsEditor } from './weights-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function WeightsPage() {
  const catalog = await getCatalog();
  return (
    <>
      <header className="page-head">
        <h1>가중치 설정</h1>
        <p>행사·관계별로 어떤 지표를 얼마나 무겁게 볼지 정합니다. 오른쪽 미리보기에서 추천이 어떻게 바뀌는지 바로 확인할 수 있습니다.</p>
      </header>
      <WeightsEditor catalog={catalog} />
    </>
  );
}
