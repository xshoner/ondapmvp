'use client';

import { usePathname } from 'next/navigation';
import { signOutAction } from '../login/actions.ts';

const LINKS = [
  { href: '/admin', label: '상품 지표' },
  { href: '/admin/weights', label: '가중치 설정' },
  { href: '/admin/verify', label: '알고리즘 검증' },
  { href: '/admin/packaging', label: '포장 디자인' },
  { href: '/admin/stats', label: '실적' },
  { href: '/admin/health', label: '운영 상태' },
];

export function AdminNav({ email }: { email: string | null }) {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="관리자 메뉴">
      <a className="brand" href="/admin"><span className="brand-mark" aria-hidden />온답<small>관리</small></a>
      {LINKS.map((l) => (
        <a key={l.href} className="nav-link" href={l.href} aria-current={path === l.href ? 'page' : undefined}>{l.label}</a>
      ))}
      <div className="nav-side">
        <a href="/" target="_blank" rel="noreferrer" style={{ color: 'var(--ink-soft)' }}>고객 화면 열기</a>
        {email && (
          <form action={signOutAction} className="row" style={{ gap: 10 }}>
            <span>{email}</span>
            <a href="/admin/password">비밀번호 변경</a>
            <button type="submit" className="btn ghost small">로그아웃</button>
          </form>
        )}
      </div>
    </nav>
  );
}
