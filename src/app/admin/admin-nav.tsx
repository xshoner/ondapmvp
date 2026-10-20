'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: '상품 지표' },
  { href: '/admin/weights', label: '가중치 설정' },
  { href: '/admin/verify', label: '알고리즘 검증' },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav">
      <a className="brand" href="/admin">ONDAP 관리자</a>
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}>{l.label}</a>
      ))}
      <span style={{ flex: 1 }} />
      <a href="/" target="_blank" rel="noreferrer">고객 화면 열기 ↗</a>
    </nav>
  );
}
