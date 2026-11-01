import { notFound } from 'next/navigation';
import { DevPreview } from './dev-preview.tsx';

export const dynamic = 'force-dynamic';

export default function RecommendationUiDevPage() {
  // 개발 전용 미리보기 진입점: 운영(production) 환경에서는 404 차단
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <DevPreview />;
}
