import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin-guard.ts';

export const dynamic = 'force-dynamic';

export default async function RetiredLabPage() {
  await requireAdmin();
  redirect('/admin/verify');
}
