import { getCatalog, getSyncInfo } from '@/data/repository.ts';
import { ProductEditor } from './product-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  const catalog = await getCatalog();
  const sync = await getSyncInfo();
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
