"use server";

import { headers } from 'next/headers';
import { after } from 'next/server';
import { recommendForCustomer } from '@/recommendation/server.ts';
import { logRecommendation } from '@/data/repository.ts';
import { createClient } from '@/lib/supabase/server.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import type { RecommendationRequest } from '@/recommendation/contracts.ts';

export async function recommendAndLog(request: RecommendationRequest) {
  const result = await recommendForCustomer(request);
  const ua = (await headers()).get('user-agent');
  if (result.ok && result.data.request.excludedProductNos.length === 0 && ua && !/bot|crawl|spider|slurp|scrap|facebookexternalhit|daumoa|yeti|whatsapp|preview/i.test(ua) && dataSource() === 'supabase') {
    const db = await createClient();
    const response = result.data;
    after(() => logRecommendation(response, db));
  }
  return result;
}
