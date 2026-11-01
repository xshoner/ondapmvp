import raw from '../../../docs/fixtures/recommendation-core-v1.json' with { type: 'json' };
import type {
  ActionResult,
  AdminWorkspace,
  PolicyDocument,
  ProductAssessment,
  ProductSnapshot,
  RecommendationResponse,
  RubricDocument,
} from '../../recommendation/contracts.ts';

export interface CoreUiFixtures {
  fixtureVersion: 'core-contract-v1';
  fictional: true;
  warning: string;
  rubric: RubricDocument;
  policy: PolicyDocument;
  products: ProductSnapshot[];
  workspace: AdminWorkspace;
  assessments: { numeric: ProductAssessment; legacy: ProductAssessment; mixed: ProductAssessment };
  recommendations: { id: string; response: RecommendationResponse }[];
  errors: Record<'aiFailed' | 'saveConflict' | 'saveFailed' | 'invalidInput', ActionResult<never>>;
}

export const coreUiFixtures = raw as unknown as CoreUiFixtures;
