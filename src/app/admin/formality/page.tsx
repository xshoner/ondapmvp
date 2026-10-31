import { requireAdmin } from '@/lib/admin-guard.ts';
import { loadPilot } from './intake-actions.ts';
import { Intake } from './intake.tsx';
import { dataSource } from '@/lib/supabase/env.ts';

export const dynamic = 'force-dynamic';

export default async function FormalityPage() {
  await requireAdmin();
  return <Intake initial={await loadPilot()} eventTest mode={dataSource()} />;
}
