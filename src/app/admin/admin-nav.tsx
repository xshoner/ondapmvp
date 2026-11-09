'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { signOutAction } from '../login/actions.ts';

const PRIMARY_LINKS = [
  { href: '/admin', label: '대시보드', match: (p: string) => p === '/admin' || p === '/admin/stats' },
  { href: '/admin/formality', label: '격식지수 판정', match: (p: string) => p.startsWith('/admin/formality') },
  { href: '/admin/packaging', label: '포장 디자인 및 접수', match: (p: string) => p.startsWith('/admin/packaging') },
];

const DATAROOM_LINKS = [
  { href: '/admin/weights', label: '가중치 설정' },
  { href: '/admin/verify', label: '알고리즘 검증' },
  { href: '/admin/health', label: '운영상태' },
];

export function AdminNav({ email }: { email: string | null }) {
  const path = usePathname();
  const isDataRoomActive = DATAROOM_LINKS.some((l) => path === l.href || path.startsWith(l.href));

  // 현재 데이터룸 하위 페이지에 머물고 있으면 기본으로 열어 둔다
  const [open, setOpen] = useState(isDataRoomActive);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 현재 경로가 바뀌었을 때 데이터룸 하위 페이지면 열린 상태로 동기화
  useEffect(() => {
    if (isDataRoomActive) {
      setOpen(true);
    }
  }, [path, isDataRoomActive]);

  // 바깥 클릭 시 메뉴 닫기
  const handleClickOutside = useCallback((e: MouseEvent | TouchEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open, handleClickOutside]);

  // Escape 누르면 메뉴 닫고 트리거로 포커스 복귀
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <nav className="admin-nav" aria-label="관리자 메뉴">
      <a className="brand" href="/admin">
        <span className="brand-mark" aria-hidden />답례큐<small>관리</small>
      </a>

      {PRIMARY_LINKS.map((l) => (
        <a
          key={l.href}
          className="nav-link"
          href={l.href}
          aria-current={l.match(path) ? 'page' : undefined}
        >
          {l.label}
        </a>
      ))}

      <div
        className="nav-group-dataroom"
        ref={containerRef}
        onKeyDown={handleKeyDown}
      >
        <button
          ref={triggerRef}
          type="button"
          className="nav-link dataroom-trigger"
          aria-expanded={open}
          aria-controls="dataroom-submenu"
          data-child-active={isDataRoomActive ? 'true' : undefined}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span>데이터룸</span>
          <span className="dataroom-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>

        <div
          id="dataroom-submenu"
          className="dataroom-submenu"
          data-open={open ? 'true' : 'false'}
          aria-hidden={!open}
          aria-label="데이터룸 서브메뉴"
        >
          {DATAROOM_LINKS.map((l) => {
            const isCurrent = path === l.href || path.startsWith(l.href);
            return (
              <a
                key={l.href}
                className="dataroom-sublink"
                href={l.href}
                tabIndex={open ? 0 : -1}
                aria-current={isCurrent ? 'page' : undefined}
              >
                {l.label}
              </a>
            );
          })}
        </div>
      </div>

      <div className="nav-side">
        <a href="/" target="_blank" rel="noreferrer" style={{ color: 'var(--ink-soft)' }}>
          고객 화면 열기
        </a>
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
