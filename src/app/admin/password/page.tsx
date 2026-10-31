import { PasswordForm } from './password-form.tsx';

export default function PasswordPage() {
  return (
    <div style={{ maxWidth: 480 }}>
      <header className="page-head"><h1>비밀번호 변경</h1><p>현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.</p></header>
      <PasswordForm />
    </div>
  );
}
