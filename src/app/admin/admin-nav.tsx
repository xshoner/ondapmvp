'use client';

import { usePathname } from 'next/navigation';
import { signOutAction } from '../login/actions.ts';

const LINKS = [
  { href: '/admin', label: '상품 지표' },
  { href: '/admin/weights', label: '가중치 설정' },
  { href: '/admin/verify', label: '알고리즘 검증' },
  { href: '/admin/packaging', label: '포장 디자인' },
];

export function AdminNav({ email }: { email: string | null }) {
  const path = usePathname();
  return (
    <nav className="admin-nav">
      <a className="brand" href="/admin">ONDAP 관리자</a>
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}>{l.label}</a>
      ))}
      <span style={{ flex: 1 }} />
      <a href="/" target="_blank" rel="noreferrer">고객 화면 열기 ↗</a>
      {email && (
        <form action={signOutAction} className="row" style={{ gap: 8 }}>
          <span className="small" style={{ opacity: 0.75 }}>{email}</span>
          <button type="submit" className="btn ghost small" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}>로그아웃</button>
        </form>
      )}
    </nav>
  );
}
