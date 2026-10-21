// 새 PC·새 계정에서 Claude의 기억을 되살린다. 안내: docs/handoff/README.md
//
//   npm run handoff:restore            기억 파일을 이 PC의 Claude Code 기억 폴더에 넣는다
//   npm run handoff:restore -- --force 이미 있는 기억 파일도 저장소 것으로 덮어쓴다
//
// 넣는 곳: ~/.claude/projects/<저장소 폴더>/memory 와 <저장소의 상위 폴더>/memory
// (Claude Code를 저장소 폴더에서 열든, 상위 '온답' 폴더에서 열든 같은 기억을 읽게 한다)
// 상위 폴더에 _handoff/raw/ (대화 원본 백업)가 있으면 그것도 넣어 /resume 으로 예전 대화를 열 수 있게 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = path.dirname(REPO);
const MEM_SRC = path.join(REPO, 'docs', 'handoff', 'memory');
const RAW_SRC = path.join(PARENT, '_handoff', 'raw');
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const force = process.argv.includes('--force');

// Claude Code는 폴더 경로의 영문·숫자가 아닌 글자를 '-'로 바꿔 대화 폴더 이름으로 쓴다
const encodeProjectDir = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

// fs.cpSync는 Windows의 한글 경로에서 node가 죽는 경우가 있어 직접 복사한다
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(MEM_SRC)) {
  console.error(`✗ ${MEM_SRC} 가 없습니다. 저장소를 최신으로 받았는지 확인하세요 (git pull).`);
  process.exit(1);
}

const targets = [...new Set([REPO, PARENT])].map((p) => ({ folder: p, dir: path.join(CLAUDE_PROJECTS, encodeProjectDir(p)) }));
const files = fs.readdirSync(MEM_SRC).filter((f) => f.endsWith('.md'));

for (const t of targets) {
  const memDir = path.join(t.dir, 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  let copied = 0;
  const kept = [];
  for (const f of files) {
    const dest = path.join(memDir, f);
    const src = fs.readFileSync(path.join(MEM_SRC, f), 'utf8');
    if (fs.existsSync(dest) && !force) {
      if (fs.readFileSync(dest, 'utf8') !== src) kept.push(f);
      continue;
    }
    fs.writeFileSync(dest, src);
    copied++;
  }
  console.log(`✓ 기억 ${copied}개 넣음 → ${memDir}  (Claude Code를 "${t.folder}" 에서 열 때 읽힘)`);
  if (kept.length) console.log(`  ! 이미 있고 내용이 다른 파일 ${kept.length}개는 그대로 둠: ${kept.join(', ')} (저장소 것으로 바꾸려면 --force)`);
}

// 대화 원본: 처음 대화한 폴더(상위 '온답' 폴더) 기준으로 넣는다
if (fs.existsSync(RAW_SRC)) {
  const dest = path.join(CLAUDE_PROJECTS, encodeProjectDir(PARENT));
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(RAW_SRC, { withFileTypes: true })) {
    const s = path.join(RAW_SRC, e.name);
    const d = path.join(dest, e.name);
    if (fs.existsSync(d) && !force) continue;
    if (e.isDirectory()) copyDir(s, d);
    else { fs.copyFileSync(s, d); if (e.name.endsWith('.jsonl')) n++; }
  }
  console.log(`✓ 예전 대화 원본 ${n}개 넣음 → ${dest}  ("${PARENT}" 에서 Claude Code를 열고 /resume 으로 볼 수 있음)`);
} else {
  console.log(`· 대화 원본 백업(${RAW_SRC})이 없습니다. 괜찮습니다: 읽기용 전체 이력은 docs/handoff/CONVERSATION-HISTORY.md 에 있습니다.`);
}

console.log('\n다음: Claude Code(데스크톱 앱 Code 탭 또는 터미널 claude)를 이 폴더에서 열고 이렇게 말하세요:');
console.log('  "docs/handoff/README.md 순서대로 인계 받고, 지금 상태와 다음 할 일을 알려줘"');
