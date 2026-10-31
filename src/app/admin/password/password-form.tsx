'use client';

import { useActionState } from 'react';
import { changePassword } from './actions.ts';

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, { message: '', ok: false });
  return (
    <form action={action} className="panel">
      <div className="field"><label htmlFor="current">현재 비밀번호</label><input id="current" name="current" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="password">새 비밀번호</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /><span className="small muted">8자 이상 72자 이하</span></div>
      <div className="field"><label htmlFor="confirmation">새 비밀번호 확인</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></div>
      {state.message && <p role={state.ok ? 'status' : 'alert'} style={{ color: state.ok ? 'var(--ink)' : 'var(--danger)' }}>{state.message}</p>}
      <button className="btn" type="submit" disabled={pending}>{pending ? '변경 중…' : '비밀번호 변경'}</button>
    </form>
  );
}
