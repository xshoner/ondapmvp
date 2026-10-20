import { getCatalog } from '@/data/repository.ts';
import { WeightsEditor } from './weights-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function WeightsPage() {
  const catalog = await getCatalog();
  return <WeightsEditor catalog={catalog} />;
}
