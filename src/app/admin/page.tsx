import { getCatalog, getSyncInfo } from '@/data/repository.ts';
import { ProductEditor } from './product-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const catalog = await getCatalog();
  const sync = await getSyncInfo();
  return (
    <>
      <header className="page-head spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>상품 지표</h1>
          <p>상품마다 격식지수 지표와 어울리는 자리를 입력하고, 검토를 마치면 확정합니다. 저장하면 추천 결과에 바로 반영됩니다.</p>
        </div>
        <a className="btn ghost small" href="/admin/ai-batch">AI로 여러 상품 한 번에 제안받기</a>
      </header>
      <ProductEditor
      products={catalog.products}
      attributes={catalog.attributes}
      config={catalog.config}
      mallId={sync.mallId}
      syncedAt={sync.syncedAt}
        initialProduct={Number(sp.product) || null}
      />
    </>
  );
}
