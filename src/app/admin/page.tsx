import { getCatalog, getRecommendationLogs, getSyncInfo } from '@/data/repository.ts';
import { soldOutFavorites } from '@/stats/summary.ts';
import { ProductEditor } from './product-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [catalog, sync, logs] = await Promise.all([
    getCatalog(),
    getSyncInfo(),
    // 최근 30일 추천 기록: 자주 1위였던 상품이 품절·미진열이면 맨 위에 알린다 (읽기 실패해도 화면은 연다)
    getRecommendationLogs({ gte: new Date(Date.now() - 30 * 86400000).toISOString(), lt: null }).catch(() => []),
  ]);
  const alerts = soldOutFavorites(logs, catalog.products);
  return (
    <>
      <header className="page-head spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>상품 지표</h1>
          <p>상품마다 격식지수 지표와 어울리는 자리를 입력하고, 검토를 마치면 확정합니다. 저장하면 추천 결과에 바로 반영됩니다.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn ghost small" href="/admin/bulk">엑셀로 한꺼번에</a>
          <a className="btn ghost small" href="/admin/ai-batch">AI로 여러 상품 한 번에 제안받기</a>
        </div>
      </header>
      {alerts.length > 0 && (
        <section className="notice alert-list" role="alert" style={{ marginBottom: 16 }}>
          <b>자주 추천되던 상품을 지금 팔 수 없습니다</b>
          <ul>
            {alerts.map((a) => (
              <li key={a.productNo}>
                ‘{a.name}’ — 최근 30일 1위로 {a.first}번 추천됐는데 지금 <b>{a.state}</b>입니다. 추천에서 빠져 있어요.{' '}
                <a className="text-link" href={`/admin?product=${a.productNo}`}>지표 열기</a>
              </li>
            ))}
          </ul>
        </section>
      )}
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
