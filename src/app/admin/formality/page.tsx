import { getCatalog } from '@/data/repository.ts';
import { requireAdmin } from '@/lib/admin-guard.ts';
import { FormalityWorkbench } from './workbench.tsx';

export const dynamic = 'force-dynamic';

export default async function FormalityPage() {
  await requireAdmin();
  return <FormalityWorkbench catalog={await getCatalog()} />;
}
