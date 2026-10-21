// 새 Supabase 프로젝트를 한 번에 만드는 SQL(supabase/setup.sql)을 만든다.
// 마이그레이션 전부(파일 이름 순서) + seed.sql을 이어 붙인다.
// 사용법: npm run db:setup-sql → 생성된 파일을 새 프로젝트 SQL Editor에 붙여넣고 Run (빈 프로젝트에서 한 번만)
// 마이그레이션을 추가하거나 seed를 다시 만들었으면 이 명령도 다시 실행한다(테스트가 빠진 파일을 잡아낸다).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../src/lib/paths.ts';

const dir = join(projectRoot, 'supabase');
const migrations = readdirSync(join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const parts = [
  ...migrations.map((f) => ({ name: `migrations/${f}`, sql: readFileSync(join(dir, 'migrations', f), 'utf8') })),
  { name: 'seed.sql', sql: readFileSync(join(dir, 'seed.sql'), 'utf8') },
];

const out = [
  '-- 온답 새 Supabase 프로젝트 한 번에 만들기 (npm run db:setup-sql로 생성, 직접 고치지 말 것)',
  '-- 빈 프로젝트의 SQL Editor에 전체를 붙여넣고 Run. 이미 만든 프로젝트에 다시 실행하면 "already exists" 오류가 난다.',
  `-- 포함: ${parts.map((p) => p.name).join(', ')}`,
  '',
];
for (const p of parts) {
  out.push(`-- ==================== ${p.name} ====================`, p.sql.trimEnd(), '');
}
out.push(
  '-- ==================== 관리자 등록 (직접 실행) ====================',
  '-- Authentication > Users > Add user(Auto Confirm User 체크)로 관리자 계정을 만든 뒤, 이메일을 바꿔 아래 한 줄만 따로 실행:',
  "-- insert into public.admins (user_id) select id from auth.users where lower(email) = lower('관리자 이메일') returning user_id;",
  '',
);

writeFileSync(join(dir, 'setup.sql'), out.join('\n'));
console.log(`supabase/setup.sql 생성: ${parts.map((p) => p.name).join(' + ')}`);
