'use client';

import type { AdminSyncUiServices, AdminWorkspace, RecommendationServices } from '@/recommendation/contracts.ts';
import { CoreAdminWorkbench } from '@/app/recommendation-ui/admin-workbench.tsx';
import { adminRecommendationServices, adminSyncServices } from '@/app/admin/recommendation-services.ts';
import { loadDescription } from './intake-actions.ts';
import '@/app/recommendation-ui/recommendation-ui.css';

export function FormalityClientView({
  initialWorkspace,
  initialError,
  services = adminRecommendationServices,
  syncServices = adminSyncServices,
}: {
  initialWorkspace?: AdminWorkspace;
  initialError?: string;
  services?: RecommendationServices;
  syncServices?: AdminSyncUiServices;
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {initialError && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 6,
            color: '#DC2626',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {initialError}
        </div>
      )}
      <CoreAdminWorkbench
        services={services}
        syncServices={syncServices}
        initialWorkspace={initialWorkspace}
        loadDescription={loadDescription}
      />
    </div>
  );
}
