import { notFound } from 'next/navigation';
import { isLocalAdminAllowed } from '@/lib/admin-guard.ts';
import { AdminNav } from './admin-nav.tsx';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // 로그인이 붙기 전까지 운영 환경에서는 관리자 화면 자체를 숨긴다
  if (!isLocalAdminAllowed()) notFound();
  return (
    <div className="admin">
      <AdminNav />
      <div className="admin-body">
        <p className="notice" style={{ marginTop: 0 }}>
          로컬 개발용 관리자입니다. 로그인 없이 열리며, 저장하면 <code>data/</code> 폴더의 JSON 파일이 바로 바뀝니다.
        </p>
        {children}
      </div>
    </div>
  );
}
