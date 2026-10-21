'use client';

import { useActionState } from 'react';
import { signInAction } from './actions.ts';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, { error: null });
  return (
    <form action={action} style={{ marginTop: 22 }}>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{state.error}</p>}
      <button className="btn block" type="submit" disabled={pending}>{pending ? '로그인 중…' : '로그인'}</button>
    </form>
  );
}
