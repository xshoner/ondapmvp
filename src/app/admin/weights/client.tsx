'use client';

import type { PolicyDocument, RecommendationServices } from '@/recommendation/contracts.ts';
import { CoreAdminWeightsEditor } from '@/app/recommendation-ui/admin-weights-editor.tsx';
import { adminRecommendationServices } from '@/app/admin/recommendation-services.ts';
import '@/app/recommendation-ui/recommendation-ui.css';

export function WeightsClientView({
  initialPolicyDoc,
  initialError,
  services = adminRecommendationServices,
}: {
  initialPolicyDoc?: PolicyDocument;
  initialError?: string;
  services?: RecommendationServices;
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
      <CoreAdminWeightsEditor
        services={services}
        initialPolicyDoc={initialPolicyDoc}
      />
    </div>
  );
}
