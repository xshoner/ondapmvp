// 인계 묶음 갱신 — Claude Code 대화 원본(jsonl)을 읽기 쉬운 한 파일로 만들고 Claude 기억 파일을 모은다.
// 계정이 막히기 전, 또는 큰 작업을 마칠 때마다 실행하고 커밋한다. 안내: docs/handoff/README.md
//
//   npm run handoff:export          docs/handoff/ 갱신 + 대화 원본을 ../_handoff/raw/ 에 백업
//   npm run handoff:export -- --zip 위 작업 + 온답 폴더 전체를 바탕화면 zip 으로 묶기
//
// 저장소에 들어가는 것: CONVERSATION-HISTORY.md(비밀번호·키 가림), memory/*.md
// 저장소에 넣지 않는 것: 대화 원본 jsonl(가리지 않은 원문) → 저장소 바깥 ../_handoff/raw/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONDAP_ROOT = path.dirname(REPO);
const OUT = path.join(REPO, 'docs', 'handoff');
const RAW = path.join(ONDAP_ROOT, '_handoff', 'raw');
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

// Claude Code는 폴더 경로의 영문·숫자가 아닌 글자를 '-'로 바꿔 대화 폴더 이름으로 쓴다
const encodeProjectDir = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

// 온답 대화가 쌓이는 곳: 온답 폴더(지금까지 여기서 작업)와 저장소 폴더
const sourceDirs = [ONDAP_ROOT, REPO]
  .map((p) => path.join(CLAUDE_PROJECTS, encodeProjectDir(p)))
  .filter((d) => fs.existsSync(d));

// ---------- 비밀값 가리기 ----------
const REDACTIONS = [
  [/AIza[0-9A-Za-z_\-]{30,}/g, '[가림: Google API 키]'],
  [/sk-[A-Za-z0-9_\-]{20,}/g, '[가림: API 키]'],
  [/sb_secret_[A-Za-z0-9_\-]{10,}/g, '[가림: Supabase 비밀 키]'],
  [/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, '[가림: 토큰]'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, '[가림: GitHub 토큰]'],
  [/vercel_[A-Za-z0-9]{20,}/g, '[가림: Vercel 토큰]'],
  [/sb_(publishable|secret)_[A-Za-z0-9_-]{10,}/g, '[가림: Supabase $1 키]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[가림: JWT]'],
  // "패스워드는 abc123!" 처럼 숫자·기호가 섞인 6자 이상 값만 가린다 ("비밀번호 재설정" 같은 문장은 그대로)
  [/((?:password|passwd|pwd|pw|비밀번호|비번|패스워드|암호)\s*(?:은|는|이|가|:|=|：)?\s*)(?=[^\s,]*[0-9!@#$%^&*])[^\s,]{6,}/gi, '$1[가림]'],
  [/((?:FRONT_API_KEY|CLIENT_SECRET|SERVICE_ROLE_KEY|ondap_ai|SECRET|TOKEN)\s*=\s*)[^\s`'"]{4,}/g, '$1[가림]'],
  [/(\b[A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)["']?\s*[=:]\s*["']?)(?!\[가림)[^\s`'",}]{6,}/gi, '$1[가림]'],
  [/(\b[a-z][a-z0-9+.\-]*:\/\/)[^\s:@\/]+:[^\s@\/]+@/gi, '$1[가림]@'],
  [/(\bBearer\s+)[A-Za-z0-9._~+\/\-]{10,}=*/g, '$1[가림]'],
  [/(\bBasic\s+)[A-Za-z0-9+\/]{16,}=*/g, '$1[가림]'],
];
// 패턴으로 못 잡는 값: ../_handoff/redact.local.txt 에 한 줄에 하나씩 (저장소 바깥이라 커밋되지 않는다)
const extraFile = path.join(ONDAP_ROOT, '_handoff', 'redact.local.txt');
const EXTRA = fs.existsSync(extraFile)
  ? fs.readFileSync(extraFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : [];
function redact(text) {
  let out = text;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  for (const s of EXTRA) out = out.split(s).join('[가림]');
  return out;
}

// ---------- 대화 원본 읽기 ----------
const stripTags = (s) =>
  s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<artifact-view-context[\s\S]*?<\/artifact-view-context>/g, '')
    .replace(/<artifact-view-context[^>]*\/>/g, '')
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, '\n[붙여넣은 내용]\n$1\n')
    .trim();

const short = (s, n = 160) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
};

const SKIP_TOOLS = new Set(['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up']);
function toolLine(block) {
  if (SKIP_TOOLS.has(block.name)) return null;
  const i = block.input ?? {};
  const name = block.name.startsWith('mcp__')
    ? (block.name.includes('claude-in-chrome') ? 'chrome:' : 'mcp:') + block.name.split('__').at(-1)
    : block.name;
  const hint =
    i.description ?? i.command ?? i.file_path ?? i.url ?? i.pattern ?? i.query ?? i.prompt ?? i.title ?? i.action ?? i.skill ?? '';
  return `\`${name}\` ${short(hint)}`;
}

function readSession(file) {
  const entries = [];
  const seen = new Set();
  let title = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'custom-title' && o.customTitle) title = o.customTitle;
    if (o.isSidechain) continue;
    if (o.uuid && seen.has(o.uuid)) continue;
    if (o.uuid) seen.add(o.uuid);
    const ts = o.timestamp;

    if (o.type === 'user' && !o.isMeta) {
      const c = o.message?.content;
      if (o.isCompactSummary) { entries.push({ ts, kind: 'note', text: '(대화가 길어져 앞부분이 요약됨)' }); continue; }
      let text = '';
      let images = 0;
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        if (c.every((b) => b.type === 'tool_result')) continue;
        for (const b of c) {
          if (b.type === 'text') text += (text ? '\n' : '') + b.text;
          if (b.type === 'image') images++;
        }
      }
      text = stripTags(text).replace(/^\[Image: source:[^\]]*\]\s*/gm, '');
      if (/^<(task-notification|agent-message|side-sessions-event|ci-monitor-event)/.test(text)) {
        entries.push({ ts, kind: 'note', text: '(백그라운드 작업 알림)' });
        continue;
      }
      if (/^<command-(name|message|args)>/.test(text) || /^<local-command/.test(text)) {
        const cmd = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1];
        if (cmd) entries.push({ ts, kind: 'note', text: `(명령 실행: ${cmd})` });
        continue;
      }
      if (!text && !images) continue;
      entries.push({ ts, kind: 'user', text, images });
    }

    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type === 'text' && b.text.trim()) entries.push({ ts, kind: 'assistant', text: b.text.trim() });
        if (b.type === 'tool_use') {
          const l = toolLine(b);
          if (l) entries.push({ ts, kind: 'tool', text: l });
        }
      }
    }
  }
  return { title, entries };
}

const kst = (iso) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

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

// ---------- 실행 ----------
if (!sourceDirs.length) {
  console.error(`✗ 이 PC에 온답 대화 기록이 없습니다 (${CLAUDE_PROJECTS}). 기존 docs/handoff/ 는 그대로 둡니다.`);
  process.exit(1);
}

const sessions = [];
for (const dir of sourceDirs) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const s = readSession(path.join(dir, f));
    if (!s.entries.length) continue;
    sessions.push({ id: f.replace('.jsonl', ''), file: path.join(dir, f), ...s, start: s.entries[0].ts, end: s.entries.at(-1).ts });
  }
}
// 복원한 원본이 새 환경에서 다시 읽히면 같은 세션이 두 번 나올 수 있다 → ID로 한 번만
const byId = new Map();
for (const s of sessions) if (!byId.has(s.id) || byId.get(s.id).entries.length < s.entries.length) byId.set(s.id, s);
const list = [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));

let md = `# 온답 프로젝트 대화 이력 (전체)\n\n`;
md += `> 만든 시각: ${kst(new Date().toISOString())} (KST) · 만든 도구: \`npm run handoff:export\`\n`;
md += `> 사용자 메시지와 Claude 답변은 원문 그대로, 도구 사용은 한 줄 요약, 도구 결과·내부 추론은 뺐다. 비밀번호·키는 [가림] 처리.\n`;
md += `> 작업 결과의 정리본은 [CLONE.md](../CLONE.md)·[RUNBOOK.md](../RUNBOOK.md). 이 파일은 "왜 그렇게 했는지"를 찾을 때 본다.\n\n`;

md += `## 세션 목록\n\n| # | 제목 | 기간 (KST) | 사용자 메시지 | 세션 ID |\n| --- | --- | --- | --- | --- |\n`;
list.forEach((s, i) => {
  const n = s.entries.filter((e) => e.kind === 'user').length;
  md += `| ${i + 1} | ${s.title || '(제목 없음)'} | ${kst(s.start)} ~ ${kst(s.end)} | ${n} | \`${s.id}\` |\n`;
});

md += `\n## 사용자 요청 순서 (목차)\n`;
let reqNo = 0;
list.forEach((s, i) => {
  md += `\n**세션 ${i + 1}. ${s.title || ''}**\n\n`;
  for (const e of s.entries) if (e.kind === 'user') { reqNo++; md += `${reqNo}. [${kst(e.ts)}] ${short(redact(e.text), 110)}\n`; }
});

reqNo = 0;
list.forEach((s, i) => {
  md += `\n---\n\n## 세션 ${i + 1}. ${s.title || '(제목 없음)'}\n\n`;
  let tools = [];
  const flushTools = () => {
    if (!tools.length) return;
    md += `<details><summary>도구 사용 ${tools.length}건</summary>\n\n${tools.map((t) => `- ${t}`).join('\n')}\n\n</details>\n\n`;
    tools = [];
  };
  for (const e of s.entries) {
    if (e.kind === 'tool') { tools.push(redact(e.text)); continue; }
    flushTools();
    if (e.kind === 'user') {
      reqNo++;
      md += `### 🧑 사용자 #${reqNo} · ${kst(e.ts)}\n\n${redact(e.text)}${e.images ? `\n\n(이미지 ${e.images}장 첨부)` : ''}\n\n`;
    } else if (e.kind === 'assistant') {
      md += `**🤖 Claude**\n\n${redact(e.text)}\n\n`;
    } else {
      md += `_${e.text}_\n\n`;
    }
  }
  flushTools();
});

// Claude 기억 파일 (새 환경에서 handoff:restore 가 제자리에 돌려놓는다)
const memFiles = [];
for (const dir of sourceDirs) {
  const m = path.join(dir, 'memory');
  if (!fs.existsSync(m)) continue;
  for (const f of fs.readdirSync(m).filter((f) => f.endsWith('.md'))) {
    memFiles.push([f, redact(fs.readFileSync(path.join(m, f), 'utf8'))]);
  }
}

// 마지막 안전장치: .env.local 의 비밀값이 가리기를 빠져나갔으면 아무것도 쓰지 않고 멈춘다
const envFile = path.join(REPO, '.env.local');
if (fs.existsSync(envFile)) {
  const leaked = [];
  const outputs = [md, ...memFiles.map(([, t]) => t)];
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(.+?)["']?\s*$/);
    if (!m || /^NEXT_PUBLIC_|^ONDAP_|_ID$|_URI$|_SCOPE$/.test(m[1]) || m[2].length < 8) continue;
    if (outputs.some((t) => t.includes(m[2]))) leaked.push(m[1]);
  }
  if (leaked.length) {
    console.error(`✗ 비밀값이 결과에 남아 있어 멈춥니다: ${leaked.join(', ')} → 가리기 규칙을 고친 뒤 다시 실행하세요. (파일은 쓰지 않았습니다)`);
    process.exit(1);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'CONVERSATION-HISTORY.md'), md);
const memOut = path.join(OUT, 'memory');
fs.mkdirSync(memOut, { recursive: true });
for (const [f, t] of memFiles) fs.writeFileSync(path.join(memOut, f), t);
const memCount = memFiles.length;

// 대화 원본 백업 (저장소 바깥)
fs.mkdirSync(RAW, { recursive: true });
for (const s of list) {
  fs.copyFileSync(s.file, path.join(RAW, path.basename(s.file)));
  const side = s.file.replace(/\.jsonl$/, '');
  if (fs.existsSync(side)) copyDir(side, path.join(RAW, s.id));
}

const userCount = list.reduce((n, s) => n + s.entries.filter((e) => e.kind === 'user').length, 0);
const rel = (p) => path.relative(REPO, p).replaceAll('\\', '/');
console.log(`✓ 대화 이력: ${rel(path.join(OUT, 'CONVERSATION-HISTORY.md'))} (세션 ${list.length}개, 사용자 메시지 ${userCount}개, ${(Buffer.byteLength(md) / 1024).toFixed(0)}KB)`);
console.log(`✓ Claude 기억: ${rel(memOut)}/ (${memCount}개)`);
console.log(`✓ 대화 원본 백업(저장소 바깥): ${RAW} (${list.length}개)`);

if (process.argv.includes('--zip')) {
  const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');
  const zip = path.join(os.homedir(), 'Desktop', `온답-인계-${stamp}.zip`);
  // node_modules·빌드 결과는 새 환경에서 다시 만들어지므로 뺀다. .env.local(비밀값)과 대화 원본은 들어간다 → zip은 공유 금지
  execFileSync('tar', [
    '-a', '-c', '-f', zip,
    '--exclude=node_modules', '--exclude=.next', '--exclude=*.tsbuildinfo',
    '-C', path.dirname(ONDAP_ROOT), path.basename(ONDAP_ROOT),
  ], { stdio: 'inherit' });
  console.log(`✓ 인계 묶음: ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(1)}MB) — 비밀값이 들어 있으니 공유하지 말 것`);
}
console.log('→ 다음: git add docs/handoff && git commit && git push');
