import { loadCatalog } from '@/data/catalog.ts';
import { WeightsEditor } from './weights-editor.tsx';

export const dynamic = 'force-dynamic';

export default function WeightsPage() {
  const catalog = loadCatalog();
  return <WeightsEditor catalog={catalog} />;
}
