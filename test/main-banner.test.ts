import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBanner,
  deleteBanner,
  getActiveBanner,
  listBanners,
  setActiveBanner,
  updateBanner,
} from '../src/data/banner-repository.ts';
import manifest from '../src/app/manifest.ts';

test('1. 배너 레포지토리: 로컬 기본 배너 3종(기본형·추석·크리스마스)이 준비되어 있다', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'banner-test-'));
  process.env.ONDAP_TEST_DATA_DIR = tmp;

  try {
    const banners = await listBanners();
    assert.ok(banners.length >= 3, '최소 3개 이상의 기본 배너가 있어야 한다');

    const defaultBanner = banners.find((b) => b.id === 'banner-default');
    const chuseokBanner = banners.find((b) => b.id === 'banner-chuseok');
    const christmasBanner = banners.find((b) => b.id === 'banner-christmas');

    assert.ok(defaultBanner, '기본형 배너 존재');
    assert.ok(chuseokBanner, '추석 배너 존재');
    assert.ok(christmasBanner, '크리스마스 배너 존재');

    assert.equal(defaultBanner.isActive, true, '초기 상태는 기본형 배너가 활성 상태여야 한다');
    assert.equal(chuseokBanner.isActive, false, '초기 추석 배너는 비활성 상태');
    assert.equal(christmasBanner.isActive, false, '초기 크리스마스 배너는 비활성 상태');

    assert.equal(chuseokBanner.imageUrl, '/banners/chuseok.webp');
    assert.equal(christmasBanner.imageUrl, '/banners/christmas.webp');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('2. 배너 활성화: 단일 원자적 전환 및 없는 ID 상태 보존 검증', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'banner-test-'));
  process.env.ONDAP_TEST_DATA_DIR = tmp;

  try {
    // 1) 추석 배너 활성화
    const activated = await setActiveBanner('banner-chuseok');
    assert.equal(activated.id, 'banner-chuseok');
    assert.equal(activated.isActive, true);

    const all = await listBanners();
    const activeList = all.filter((b) => b.isActive);
    assert.equal(activeList.length, 1, '활성 배너는 시스템 전체에서 오직 1개여야 한다');
    assert.equal(activeList[0].id, 'banner-chuseok');

    // 2) 존재하지 않는 ID로 활성화 시도 시 에러 발생 및 기존 상태(추석 배너 활성) 100% 보존
    await assert.rejects(
      () => setActiveBanner('non-existent-banner-id'),
      /존재하지 않는 배너 ID입니다/
    );

    const currentAfterFail = await getActiveBanner();
    assert.ok(currentAfterFail);
    assert.equal(currentAfterFail.id, 'banner-chuseok', '실패 시 기존 활성 배너 상태가 보존되어야 한다');

    const allAfterFail = await listBanners();
    assert.equal(allAfterFail.filter((b) => b.isActive).length, 1);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('3. 새 배너 생성 및 수정: 유효성 검증 및 활성 배너 불변식 유지', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'banner-test-'));
  process.env.ONDAP_TEST_DATA_DIR = tmp;

  try {
    // 제목 누락 방어
    await assert.rejects(
      () => createBanner({ title: '   ' }),
      /배너 제목을 입력해 주세요/
    );

    // 새 배너 생성 (활성화)
    const created = await createBanner({
      title: '새봄 맞이 프로모션 배너',
      imageUrl: '/banners/uploads/spring.webp',
      linkUrl: 'https://dapcue.vercel.app/packaging',
      altText: '새봄 맞이 답례품 기획전',
      isActive: true,
      seasonType: 'custom',
    });

    assert.ok(created.id.startsWith('banner-'));
    assert.equal(created.title, '새봄 맞이 프로모션 배너');
    assert.equal(created.isActive, true);

    // 새 배너가 활성화되었으므로 다른 배너들은 모두 비활성화되어 정확히 1개 유지
    const current = await getActiveBanner();
    assert.equal(current?.id, created.id);
    const all = await listBanners();
    assert.equal(all.filter((b) => b.isActive).length, 1);

    // 수정: 비활성화하려 하면 기본 배너로 자동 안전 전환되어 활성 배너 0개 방지
    await updateBanner(created.id, { isActive: false });
    const fallbackActive = await getActiveBanner();
    assert.equal(fallbackActive?.id, 'banner-default', '활성 배너 비활성화 시 기본형으로 안전 대체');
    const allFallback = await listBanners();
    assert.equal(allFallback.filter((b) => b.isActive).length, 1);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('4. 배너 삭제 및 Fail-safe: 기본형 삭제 불가 & 활성 배너 삭제 시 기본형 자동 복구', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'banner-test-'));
  process.env.ONDAP_TEST_DATA_DIR = tmp;

  try {
    // 1) 기본형 배너 삭제 시도 -> 에러
    await assert.rejects(
      () => deleteBanner('banner-default'),
      /기본형 배너는 삭제할 수 없습니다/
    );

    // 2) 커스텀 배너 생성 후 활성화
    const custom = await createBanner({
      title: '임시 이벤트 배너',
      isActive: true,
    });
    assert.equal(custom.isActive, true);

    // 3) 활성 커스텀 배너 삭제 -> 기본형 배너가 자동으로 활성화되어 활성 1개 불변식 유지
    await deleteBanner(custom.id);

    const active = await getActiveBanner();
    assert.ok(active);
    assert.equal(active.id, 'banner-default', '활성 배너 삭제 시 기본형 배너로 자동 안전 복구');
    assert.equal(active.isActive, true);

    const all = await listBanners();
    assert.equal(all.filter((b) => b.isActive).length, 1, '정확히 1개의 활성 배너 유지');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('5. 활성 배너 API (/api/banner/active): CORS, Cache, XSS 방어 검증', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'banner-test-'));
  process.env.ONDAP_TEST_DATA_DIR = tmp;

  try {
    const { GET, OPTIONS } = await import('../src/app/api/banner/active/route.ts');

    // OPTIONS preflight 확인
    const optRes = await OPTIONS();
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get('access-control-allow-origin'), '*');

    // GET 확인
    const res = await GET();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const json = await res.json();
    assert.equal(json.id, 'banner-default');
    assert.equal(json.isActive, true);
    assert.equal(json.badgeText, '답례큐 AI 추천 큐레이션');
    assert.equal(json.headline, '자리에 맞는 답례, 답례큐가 추천드려요.');
    assert.equal(json.subText, '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.');

    // XSS 악성 링크 URL 방어 검증
    await updateBanner('banner-default', { linkUrl: 'javascript:alert(1)' });
    const xssRes = await GET();
    const xssJson = await xssRes.json();
    assert.equal(xssJson.linkUrl, 'https://dapcue.vercel.app/', '위험한 javascript: 스키마는 안전한 기본 URL로 대체되어야 한다');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('6. 카페24 메인 배너 기본 문구 및 높이 축소(약 10%) 검증', () => {
  const ctaHtml = readFileSync(join(process.cwd(), 'cafe24', 'ondap-cta.html'), 'utf8');
  const mobileHtml = readFileSync(join(process.cwd(), 'cafe24', 'mobile-index.html'), 'utf8');

  for (const html of [ctaHtml, mobileHtml]) {
    // 기본 배너 문구 검증
    assert.ok(html.includes('답례큐 AI 추천 큐레이션'), '브랜드 문구 갱신 확인');
    assert.ok(html.includes('자리에 맞는 답례,<br class="ondap-br"> 답례큐가 추천드려요.'), '헤드라인 갱신 확인');
    assert.ok(
      html.includes('행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.'),
      '서브텍스트 갱신 확인'
    );

    // 높이 축소 검증 (패딩 축소: 30px -> 26px, 버튼 52px -> 46px)
    assert.ok(html.includes('padding:26px 34px;'), 'PC 패딩 약 10% 축소 확인');
    assert.ok(html.includes('min-height:46px;'), '버튼 높이 약 11% 축소 확인');
    assert.ok(html.includes('margin:24px auto;'), '래퍼 마진 축소 확인');
  }
});

test('7. PWA 기능 온전 보존: manifest display: standalone 유지', () => {
  const mf = manifest();
  assert.equal(mf.display, 'standalone', '사용자 지침에 따라 기존 PWA standalone 설정을 온전히 보존한다');
  assert.equal(mf.name, '답례큐 답례 큐레이션');
  assert.ok(mf.icons && mf.icons.length >= 2, 'PWA 아이콘 등록 유지');
});

test('8. 최적화된 배경 이미지 파일(추석·크리스마스) 보존 및 형식 확인', () => {
  const chuseokWebp = readFileSync(join(process.cwd(), 'public', 'banners', 'chuseok.webp'));
  const christmasWebp = readFileSync(join(process.cwd(), 'public', 'banners', 'christmas.webp'));

  assert.ok(chuseokWebp.length > 5000 && chuseokWebp.length < 500000, '추석 webp 최적화 용량 확인');
  assert.ok(christmasWebp.length > 5000 && christmasWebp.length < 500000, '크리스마스 webp 최적화 용량 확인');

  // WEBP 매직 바이트 확인
  const isWebp = (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  assert.ok(isWebp(chuseokWebp), '추석 파일이 유효한 WEBP 형식이어야 함');
  assert.ok(isWebp(christmasWebp), '크리스마스 파일이 유효한 WEBP 형식이어야 함');
});

test('9. ondap-helper.js의 배너 동적 반영 및 Fail-safe 보존 검증', () => {
  const helperSrc = readFileSync(join(process.cwd(), 'public', 'cafe24', 'ondap-helper.js'), 'utf8');
  assert.ok(helperSrc.includes('applyMainBanner'), 'applyMainBanner 함수가 존재해야 함');
  assert.ok(helperSrc.includes('/api/banner/active'), 'active 배너 엔드포인트 호출 확인');
  assert.ok(helperSrc.includes('.ondap-cta'), '.ondap-cta 요소 탐색 확인');
  assert.ok(helperSrc.includes('b.altText'), '접근성 alt/aria-label 처리 확인');
  assert.ok(helperSrc.includes('b.imageUrl'), '시즌/커스텀 배경 이미지 처리 확인');
  assert.ok(helperSrc.includes('catch(function'), '장애 시 fail-safe 에러 핸들링 확인');
});

test('10. 긴급 보안 검증: banner-assets 전용 격리 & packaging-assets 정책 침범 금지', () => {
  const migrationSql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20261117000000_main_banners.sql'),
    'utf8'
  );

  // 1. packaging-assets에 대한 SELECT 정책 변경이나 삽입이 절대 없어야 함
  assert.ok(
    !migrationSql.includes("bucket_id = 'packaging-assets'"),
    '마이그레이션에 packaging-assets 정책이 포함되어서는 안 된다'
  );
  assert.ok(
    !migrationSql.includes("'packaging-assets'"),
    '마이그레이션에 packaging-assets 버킷이 언급되어서는 안 된다'
  );

  // 2. banner-assets 전용 버킷 선언 확인
  assert.ok(migrationSql.includes("'banner-assets'"), 'banner-assets 전용 버킷 선언 확인');
  assert.ok(migrationSql.includes("bucket_id = 'banner-assets'"), '스토리지 정책이 banner-assets에만 국한되어야 함');

  // 3. RPC 함수 보안 확인
  assert.ok(migrationSql.includes('set_active_main_banner'), 'RPC 함수 선언 확인');
  assert.ok(migrationSql.includes("set search_path = ''"), 'search_path 안전 격리 확인');
  assert.ok(migrationSql.includes('(select private.is_admin())'), 'RPC 내 관리자 권한 확인');
  assert.ok(
    migrationSql.includes('revoke all on function public.set_active_main_banner(text) from public, anon;'),
    'RPC 공개 호출 권한 차단 확인'
  );

  // 4. 동시성 부분 유니크 인덱스 확인
  assert.ok(
    migrationSql.includes('create unique index if not exists main_banners_one_active'),
    '단 1개의 활성 배너만 허용하는 유니크 인덱스 확인'
  );

  // 5. banner-repository.ts에 packaging-assets 폴백이 없는지 확인
  const repoSrc = readFileSync(join(process.cwd(), 'src', 'data', 'banner-repository.ts'), 'utf8');
  assert.ok(
    !repoSrc.includes("from('packaging-assets')"),
    'banner-repository에 packaging-assets 폴백이 없어야 한다'
  );
});

test('11. 글꼴 일관성 및 깨짐 방지: Hahmlet &text= 제한 제거 및 전체 한글 글리프 로딩 검증', () => {
  const ctaHtml = readFileSync(join(process.cwd(), 'cafe24', 'ondap-cta.html'), 'utf8');
  const mobileHtml = readFileSync(join(process.cwd(), 'cafe24', 'mobile-index.html'), 'utf8');

  for (const html of [ctaHtml, mobileHtml]) {
    // 1) &text= 쿼리 파라미터가 없어야 함 (특정 글자만 제한하는 서브셋 누락 방지)
    assert.ok(
      !html.includes('&text='),
      'Google Fonts Hahmlet URL에 &text= 서브셋 제한이 없어야 한다'
    );

    // 2) 전체 한글 unicode-range를 지원하는 정식 Hahmlet 웹폰트 링크 존재 확인
    assert.ok(
      html.includes('https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;600&display=swap'),
      '전체 한글을 지원하는 정식 Hahmlet 500/600 폰트 링크가 포함되어야 한다'
    );

    // 3) 폴백 글꼴 체계 확인
    assert.ok(
      html.includes("'Hahmlet','Nanum Myeongjo','AppleMyungjo','Batang',serif"),
      'Hahmlet 로딩 지연 또는 실패 시의 명조 계열 폴백 글꼴이 지정되어야 한다'
    );
  }
});

test('12. ondap-helper.js의 동적 폰트 보장(ensureHahmletFont) 및 패딩 안전 가드 검증', () => {
  const helperSrc = readFileSync(join(process.cwd(), 'public', 'cafe24', 'ondap-helper.js'), 'utf8');

  // 동적 글꼴 주입 함수 존재 및 호출 확인
  assert.ok(helperSrc.includes('function ensureHahmletFont()'), 'ensureHahmletFont 함수 구현 확인');
  assert.ok(helperSrc.includes('ensureHahmletFont()'), 'applyMainBanner 시작 시 ensureHahmletFont 호출 확인');

  // 전체 한글 Hahmlet 주입 확인
  assert.ok(
    helperSrc.includes('https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;600&display=swap'),
    '글리프 누락 스킨 대응 전체 Hahmlet 동적 주입 확인'
  );

  // 패딩 축소 안전 가드 (32px 이상일 때만 축소)
  assert.ok(
    helperSrc.includes('currentPadTop >= 32'),
    '이미 축소된 26px 스킨의 과도한 축소 방지 가드 확인'
  );
});

test('13. 관리자 미리보기 글꼴 및 모바일 반응형 뷰 지원 검증', () => {
  const managerSrc = readFileSync(
    join(process.cwd(), 'src', 'app', 'admin', 'packaging', 'banner-manager.tsx'),
    'utf8'
  );

  // 관리자 미리보기에 Hahmlet 명조 지정 확인
  assert.ok(
    managerSrc.includes("fontFamily: \"var(--font-serif), 'Hahmlet', 'Nanum Myeongjo', 'AppleMyungjo', 'Batang', serif\""),
    '관리자 미리보기 헤드라인에 Hahmlet 명조 폰트 패밀리 지정 확인'
  );

  // 굵기 600, 행간 1.35, 자간 -0.025em 일치 확인
  assert.ok(managerSrc.includes('fontWeight: 600'), '헤드라인 굵기 600 일치');
  assert.ok(managerSrc.includes("lineHeight: 1.35"), '헤드라인 행간 1.35 일치');
  assert.ok(managerSrc.includes("letterSpacing: '-0.025em'"), '헤드라인 자간 -0.025em 일치');

  // PC/모바일 뷰 전환 지원 확인
  assert.ok(managerSrc.includes("previewDevice"), '미리보기 디바이스 상태 확인');
  assert.ok(managerSrc.includes("setPreviewDevice('pc')"), 'PC 뷰 버튼 확인');
  assert.ok(managerSrc.includes("setPreviewDevice('mobile')"), '모바일 뷰 버튼 확인');
});
