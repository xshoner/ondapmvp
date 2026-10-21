import { getCatalog } from '@/data/repository.ts';
import { BatchSuggest } from './batch-suggest.tsx';

export const dynamic = 'force-dynamic';

export default async function AiBatchPage() {
  const catalog = await getCatalog();
  return (
    <>
      <header className="page-head">
        <a className="small muted" href="/admin" style={{ textDecoration: 'none' }}>‹ 상품 지표</a>
        <h1 style={{ marginTop: 6 }}>AI 지표 일괄 제안</h1>
        <p>여러 상품을 골라 AI에게 지표 점수와 어울리는 자리를 한 번에 제안받고, 상품마다 확인한 뒤 저장합니다.</p>
      </header>
      <BatchSuggest products={catalog.products} attributes={catalog.attributes} config={catalog.config} />
    </>
  );
}
