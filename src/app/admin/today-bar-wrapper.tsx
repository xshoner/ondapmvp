'use client';

import { usePathname } from 'next/navigation';

/**
 * 대시보드 첫 화면(/admin 및 기존 /admin/stats)에서는 상단 공통 띠를 숨겨
 * 대시보드 내부의 '오늘 할 일' 카드와 중복 표시되는 것을 방지합니다.
 */
export function TodayBarWrapper({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === '/admin' || path === '/admin/stats') {
    return null;
  }
  return <>{children}</>;
}
