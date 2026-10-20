// 데이터 저장소 선택: ONDAP_DATA_SOURCE=supabase 이면 Supabase, 아니면 로컬 JSON(data/)
export type DataSource = 'local' | 'supabase';

export function dataSource(): DataSource {
  return process.env.ONDAP_DATA_SOURCE === 'supabase' ? 'supabase' : 'local';
}

export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('.env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 필요합니다.');
  }
  return { url, key };
}
