import { dataSource } from '@/lib/supabase/env.ts';
import { LoginForm } from './login-form.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '/admin';
  return (
    <main className="mobile" style={{ paddingTop: 60 }}>
      <a className="brand" href="/">ONDAP<small>온답</small></a>
      <h1 style={{ marginTop: 24 }}>관리자 로그인</h1>
      {dataSource() === 'supabase' ? (
        <LoginForm next={next} />
      ) : (
        <p className="muted" style={{ marginTop: 12 }}>
          지금은 로컬 모드라 로그인 없이 <a href="/admin">관리자 화면</a>을 쓸 수 있습니다.
        </p>
      )}
    </main>
  );
}
