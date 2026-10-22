import { notFound, redirect } from 'next/navigation';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { signOutAction } from '../login/actions.ts';
import { AdminNav } from './admin-nav.tsx';
import { TodayBar } from './today-bar.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const status = await getAdminStatus();

  if (!status.allowed && status.reason === 'production') notFound();
  if (!status.allowed && status.reason === 'login') redirect('/login?next=/admin');
  if (!status.allowed) {
    return (
      <main className="mobile" style={{ paddingTop: 80, textAlign: 'center' }}>
        <h1>관리자 권한이 없습니다</h1>
        <p className="muted">{status.email} 계정은 관리자로 등록되어 있지 않습니다.</p>
        <form action={signOutAction}><button className="btn ghost" type="submit">다른 계정으로 로그인</button></form>
      </main>
    );
  }

  return (
    <div className="admin">
      <AdminNav email={status.mode === 'supabase' ? status.email : null} />
      <TodayBar />
      <div className="admin-body">
        {status.mode === 'local' ? (
          <p className="notice" style={{ marginTop: 0 }}>
            로컬 모드입니다. 로그인 없이 열리며, 저장하면 <code>data/</code> 폴더의 JSON 파일이 바뀝니다.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
