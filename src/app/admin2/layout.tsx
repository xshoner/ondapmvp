import { notFound } from 'next/navigation';
import { dataSource } from '@/lib/supabase/env.ts';

export const dynamic = 'force-dynamic';

export default function Admin2Layout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production' || dataSource() !== 'local') notFound();
  return <div className="admin"><nav className="admin-nav" aria-label="시험 관리자 메뉴"><a className="brand" href="/admin2"><span className="brand-mark" aria-hidden />온답<small>시험 관리</small></a><a className="nav-link" href="/admin2" aria-current="page">상품 평가와 행사 시험</a><a className="nav-link" href="/admin">기존 관리자</a></nav><div className="admin-body">{children}</div></div>;
}
