import { notFound } from 'next/navigation';
import { CoreUiReviewHarness } from '../../../test/browser/core-ui-review-harness.tsx';

export const dynamic = 'force-dynamic';
export default function CoreUiReviewPage() {
  if (process.env.NODE_ENV !== 'development' || process.env.ONDAP_CORE_UI_REVIEW !== '1') notFound();
  return <CoreUiReviewHarness />;
}
