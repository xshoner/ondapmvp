export function passwordError(current: string, password: string, confirmation: string): string | null {
  if (!current || !password || !confirmation) return '모든 항목을 입력해 주세요.';
  if (password.length < 8 || password.length > 72) return '새 비밀번호는 8자 이상 72자 이하로 입력해 주세요.';
  if (password !== confirmation) return '새 비밀번호와 확인 값이 다릅니다.';
  if (password === current) return '현재 비밀번호와 다른 비밀번호를 입력해 주세요.';
  return null;
}
