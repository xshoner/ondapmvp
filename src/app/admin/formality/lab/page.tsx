import { getCatalog } from '@/data/repository.ts';
import { requireAdmin } from '@/lib/admin-guard.ts';
import { FormalityWorkbench } from '../workbench.tsx';
import { loadPilot } from '../intake-actions.ts';
import { evidenceFromIntake } from '@/engine/formality-intake.ts';

export const dynamic = 'force-dynamic';

export default async function LabPage() {
  await requireAdmin();
  const [catalog, pilot] = await Promise.all([getCatalog(), loadPilot()]);
  const evidence = Object.entries(pilot.items).map(([no, item]) => evidenceFromIntake(Number(no), item.factors, item.reviewed));
  return <FormalityWorkbench catalog={{ ...catalog, products: pilot.products }} pilotEvidence={evidence} />;
}
