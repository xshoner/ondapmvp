// 화면 끝까지 확인 (사람 대신 화면 없는 Chrome이 고객·관리자 흐름을 눌러 본다).
// 준비: 로컬 모드(ONDAP_DATA_SOURCE=local)로 `npm run dev` → 다른 창에서 `npm run e2e` (특정 묶음만: `npm run e2e -- ops editor`)
// data/는 시작할 때 임시 폴더에 복사해 두고, 시험용 접수를 깐 뒤, 끝나면(실패해도) 원래대로 되돌린다
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, realpathSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { writeFixtures } from './fixtures.mjs';

const root = join(import.meta.dirname, '..', '..');
const base = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const ALL = ['result', 'features', 'editor', 'helper', 'ops', 'integrated', 'formality']; // 각 묶음은 시험 접수로 다시 시작한다.
const pick = process.argv.slice(2);
const suites = pick.length ? ALL.filter((s) => pick.includes(s)) : ALL;

// Node 24/Windows의 fs.cpSync가 한글 경로에서 네이티브 종료되는 환경도 지원한다.
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('시험 데이터의 심볼릭 링크는 복사하지 않습니다.');
    if (entry.isDirectory()) copyTree(join(from,entry.name),join(to,entry.name));
    else writeFileSync(join(to,entry.name),readFileSync(join(from,entry.name)));
  }
}

// 로컬 모드 개발 서버인지: 관리자 화면이 로그인 없이 열려야 한다 (Supabase 모드는 로그인으로, 운영 빌드는 404)
const admin = await fetch(`${base}/admin`, { redirect: 'manual' }).catch(() => null);
if (admin?.status !== 200) {
  console.error(`${base}/admin 이 열리지 않습니다(${admin ? admin.status : '연결 안 됨'}). .env.local의 ONDAP_DATA_SOURCE=local 로 npm run dev 를 먼저 띄워 주세요.`);
  process.exit(1);
}

const data = join(root, 'data');
const backup = mkdtempSync(join(tmpdir(), 'ondap-e2e-data-'));
// 삭제·복원 대상은 이 저장소의 data와 이번에 만든 임시 백업으로 한정한다.
if (realpathSync(data) !== join(realpathSync(root), 'data') || dirname(resolve(backup)) !== resolve(tmpdir()) || !basename(backup).startsWith('ondap-e2e-data-')) throw new Error('검증 데이터 경로가 안전 범위를 벗어났습니다.');
copyTree(data, backup);
console.log(`data/ 를 ${backup} 에 복사해 두었습니다 (끝나면 되돌립니다)\n`);
const failed = [];
try {
  // 서버가 이 폴더의 data/를 읽는지: 이번에만 쓰는 코드로 접수 1건을 깔고 서버에 물어본다
  // (다른 폴더에서 띄운 서버에 대고 돌리면 그 폴더의 data/를 바꾸게 된다)
  const probe = `OD-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/^(.{4})/, '$1-')}`;
  writeFileSync(join(data, 'designs.json'), JSON.stringify([{ code: probe, productNo: 49, productName: '확인', quantity: 1, styleName: '확인', sticker: null, status: 'received', createdAt: new Date().toISOString() }]));
  if ((await fetch(`${base}/api/design/${probe}`).catch(() => null))?.status !== 200) {
    throw new Error(`${base} 서버가 이 폴더(${root})의 data/를 읽지 않습니다. 이 폴더에서 npm run dev 로 띄운 서버에 대고 돌려 주세요.`);
  }
  for (const s of suites) {
    await writeFixtures(root);
    console.log(`=== ${s} ===`);
    const r = spawnSync(process.execPath, [join(import.meta.dirname, `${s}.mjs`), root], { stdio: 'inherit', env: { ...process.env, E2E_BASE: base } });
    if (r.status !== 0) failed.push(s);
    console.log('');
  }
} finally {
  rmSync(data, { recursive: true, force: true });
  copyTree(backup, data);
  if (existsSync(join(data, 'config'))) rmSync(backup, { recursive: true, force: true });
  console.log('data/ 를 원래대로 되돌렸습니다.');
}
console.log(failed.length ? `실패한 묶음: ${failed.join(', ')}` : `모든 묶음 통과 (${suites.join(', ')})`);
process.exitCode = failed.length ? 1 : 0;
