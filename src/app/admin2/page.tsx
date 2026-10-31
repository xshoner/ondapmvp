import { loadPilot } from '@/app/admin/formality/intake-actions.ts';
import { Intake } from '@/app/admin/formality/intake.tsx';
import { dataSource } from '@/lib/supabase/env.ts';

export default async function Admin2Page() {
  return <Intake initial={await loadPilot()} eventTest mode={dataSource()} />;
}
