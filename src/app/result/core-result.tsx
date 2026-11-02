"use client";

import { CustomerRecommendationView } from '../recommendation-ui/customer-view.tsx';
import { recommendForCustomer } from '@/recommendation/server.ts';
import type { RecommendationResponse } from '@/recommendation/contracts.ts';
import '../recommendation-ui/recommendation-ui.css';

const services = { recommend: recommendForCustomer };

export function CoreResult({ response }: { response: RecommendationResponse }) {
  return <CustomerRecommendationView services={services} initialRequest={response.request} initialResponse={response} />;
}
