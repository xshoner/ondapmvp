import type { Metadata } from 'next';
import { requestFromSearchParams, recommendationResultHref } from '@/recommendation/query.ts';
import { recommendForCustomer } from '@/recommendation/server.ts';
import { EVENT_NAMES } from '../recommendation-ui/types.ts';
import { CoreResult } from './core-result.tsx';

export const dynamic = 'force-dynamic';
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  try {
    const request = requestFromSearchParams(await searchParams);
    const title = `${EVENT_NAMES[request.event]} 자리에 맞춘 답례품 | 온답`;
    const image = { url: `/og${recommendationResultHref(request)}`, width: 1200, height: 630, alt: title };
    return { title, openGraph: { title, images: [image], locale: 'ko_KR' }, twitter: { card: 'summary_large_image', title, images: [image.url] } };
  } catch { return { title: '답례품 추천 | 온답' }; }
}

export default async function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  let request;
  try { request = requestFromSearchParams(await searchParams); }
  catch { return <main className="mobile"><h1>추천 조건을 확인해 주세요</h1><p>행사와 받는 분, 예산을 다시 확인해 주세요.</p><a className="btn block" href="/">조건 고르기</a></main>; }
  const result = await recommendForCustomer(request);
  if (!result.ok) return <main className="mobile"><h1>추천을 불러오지 못했어요</h1><p>{result.error.message}</p><a className="btn block" href={recommendationResultHref(request)}>다시 시도</a></main>;
  return <CoreResult response={result.data} />;
}
