import { dataSource } from '@/lib/supabase/env.ts';
import { LoginForm } from './login-form.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '/admin';
  return (
    <main className="auth">
      <a className="brand" href="/"><span className="brand-mark" aria-hidden />온답<small>관리</small></a>
      <section className="panel">
        <h1 style={{ fontSize: 22 }}>관리자 로그인</h1>
        <p className="small muted" style={{ margin: '6px 0 0' }}>상품 지표와 포장 디자인을 관리하는 화면입니다.</p>
        {dataSource() === 'supabase' ? (
          <LoginForm next={next} />
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>
            지금은 로컬 모드라 로그인 없이 <a className="text-link" href="/admin">관리자 화면</a>을 쓸 수 있습니다.
          </p>
        )}
      </section>
    </main>
  );
}
