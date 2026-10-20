import { loadCatalog, loadSyncInfo } from '@/data/catalog.ts';
import { ProductEditor } from './product-editor.tsx';

export const dynamic = 'force-dynamic';

export default function AdminProductsPage() {
  const catalog = loadCatalog();
  const sync = loadSyncInfo();
  return (
    <ProductEditor
      products={catalog.products}
      attributes={catalog.attributes}
      config={catalog.config}
      mallId={sync.mallId}
      syncedAt={sync.syncedAt}
    />
  );
}
