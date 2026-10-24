'use client';
import { useReportWebVitals } from 'next/web-vitals';

export function WebVitals() {
  useReportWebVitals((metric) => {
    // 전체 URL/조건/사용자 식별자는 보내지 않는다. 관리자·주문·디자인 화면은 제외한다.
    const path = location.pathname;
    const page = path === '/' ? 'home' : path === '/result' ? 'result' : path === '/packaging' ? 'packaging' : null;
    if (!page || !['LCP','INP','CLS'].includes(metric.name)) return;
    navigator.sendBeacon?.('/api/metrics', JSON.stringify({ name: metric.name, value: metric.value, page }));
  });
  return null;
}
