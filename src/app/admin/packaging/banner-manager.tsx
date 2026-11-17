'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MainBanner, MainBannerInput } from '@/data/banner-repository.ts';
import {
  createBannerAction,
  deleteBannerAction,
  setActiveBannerAction,
  updateBannerAction,
  uploadBannerImageAction,
} from './banner-actions.ts';

interface Props {
  banners: MainBanner[];
}

const SEASON_LABELS: Record<string, string> = {
  default: '기본형 (텍스트/놋쇠 테두리)',
  chuseok: '추석 명절 시즌',
  christmas: '크리스마스 연말 시즌',
  custom: '직접 등록',
};

export function BannerManager({ banners }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // 등록 폼 상태
  const [title, setTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('https://dapcue.vercel.app/');
  const [altText, setAltText] = useState('');
  const [seasonType, setSeasonType] = useState<'default' | 'chuseok' | 'christmas' | 'custom'>('custom');
  const [badgeText, setBadgeText] = useState('답례큐 AI 추천 큐레이션');
  const [headline, setHeadline] = useState('자리에 맞는 답례, 답례큐가 추천드려요.');
  const [subText, setSubText] = useState('행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.');
  const [buttonText, setButtonText] = useState('답례품 추천받기');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 활성화 처리
  const handleActivate = (id: string) => {
    startTransition(async () => {
      setMessage(null);
      const res = await setActiveBannerAction(id);
      if (res.ok) {
        setMessage({ text: '메인 배너가 적용되었습니다. 카페24 메인에 즉시 반영됩니다.' });
        router.refresh();
      } else {
        setMessage({ text: res.message, error: true });
      }
    });
  };

  // 삭제 처리
  const handleDelete = (id: string, title: string) => {
    if (!confirm(`'${title}' 배너를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      setMessage(null);
      const res = await deleteBannerAction(id);
      if (res.ok) {
        setMessage({ text: '배너가 삭제되었습니다.' });
        router.refresh();
      } else {
        setMessage({ text: res.message, error: true });
      }
    });
  };

  // 파일 선택 시 미리보기
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      alert('파일 크기는 3MB 이하여야 합니다.');
      e.target.value = '';
      setPreviewUrl(null);
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) {
      alert('JPG, PNG, WEBP 파일만 업로드할 수 있습니다.');
      e.target.value = '';
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  // 신규 배너 등록
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setMessage(null);
      try {
        let imageUrl = '';
        const file = fileInputRef.current?.files?.[0];
        if (file) {
          const form = new FormData();
          form.append('file', file);
          const uploadRes = await uploadBannerImageAction(form);
          if (!uploadRes.ok || !uploadRes.data) {
            setMessage({ text: uploadRes.ok ? '업로드 실패' : uploadRes.message, error: true });
            return;
          }
          imageUrl = uploadRes.data;
        }

        const input: MainBannerInput = {
          title: title.trim(),
          imageUrl,
          linkUrl: linkUrl.trim(),
          altText: altText.trim() || title.trim(),
          isActive: false, // 등록 후 목록에서 확인하고 '적용' 버튼으로 활성화
          seasonType,
          badgeText: badgeText.trim(),
          headline: headline.trim(),
          subText: subText.trim(),
          buttonText: buttonText.trim(),
        };

        const res = await createBannerAction(input);
        if (res.ok) {
          setMessage({ text: '새 배너가 등록되었습니다. 아래 목록에서 [선택 및 적용]을 눌러 메인에 반영하세요.' });
          setTitle('');
          setAltText('');
          setPreviewUrl(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          router.refresh();
        } else {
          setMessage({ text: res.message, error: true });
        }
      } catch (err) {
        setMessage({ text: err instanceof Error ? err.message : '등록 중 오류가 발생했습니다.', error: true });
      }
    });
  };

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 1080 }}>
      {/* 1. 규격 및 연동 안내 */}
      <section style={{ background: '#f8faf9', border: '1px solid #d5ded9', borderRadius: 12, padding: '20px 24px' }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px', color: '#1f4436' }}>
          📐 메인 배너 규격 및 카페24 연동 안내
        </h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: '#3f534a' }}>
          <li><b>적용 위치</b>: 카페24 PC 및 모바일 쇼핑몰 메인의 <code>.ondap-cta</code> 배너 영역</li>
          <li><b>권장 이미지 규격</b>: 가로 <b>2400px</b> × 세로 <b>380px</b> (약 6.3:1, 모바일에서는 일부가 잘릴 수 있습니다)</li>
          <li><b>지원 파일 형식</b>: <b>JPG, PNG, WEBP</b> (최대 <b>3MB</b> 이하)</li>
          <li><b>자동 반영</b>: 목록에서 원하는 배너의 <b>[선택 및 적용]</b>을 누르면 쇼핑몰에 즉시 단 1개의 메인 배너로 자동 반영됩니다.</li>
          <li><b>장애 방어 (Fail-safe)</b>: 네트워크 장애나 서버 오류 시 카페24에 기본 내장된 정적 배너로 자동 전환되어 화면이 깨지지 않습니다.</li>
        </ul>
      </section>

      {/* 상태 알림 메시지 */}
      {message && (
        <div style={{
          padding: '12px 18px',
          borderRadius: 8,
          background: message.error ? '#fef2f2' : '#f0fdf4',
          color: message.error ? '#991b1b' : '#166534',
          border: `1px solid ${message.error ? '#fca5a5' : '#86efac'}`,
          fontSize: 14,
        }}>
          {message.text}
        </div>
      )}

      {/* 2. 새 메인 배너 등록 */}
      <section style={{ background: '#ffffff', border: '1px solid #e1e7e4', borderRadius: 12, padding: 24 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 16px', color: '#1f4436' }}>
          ➕ 새 메인 배너 등록
        </h2>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#2b3f36' }}>
                배너 이름 (관리용) <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 2026 추석 한가위 특별 배너"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ccd6d1', borderRadius: 6, fontSize: 14 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#2b3f36' }}>
                시즌 / 분류
              </label>
              <select
                value={seasonType}
                onChange={(e) => setSeasonType(e.target.value as any)}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ccd6d1', borderRadius: 6, fontSize: 14 }}
              >
                <option value="custom">직접 등록 (커스텀)</option>
                <option value="chuseok">추석 명절</option>
                <option value="christmas">크리스마스 / 연말</option>
                <option value="default">기본형</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#2b3f36' }}>
                클릭 시 이동할 링크 URL <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="url"
                required
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://dapcue.vercel.app/"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ccd6d1', borderRadius: 6, fontSize: 14 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#2b3f36' }}>
                대체 텍스트 (접근성 / alt) <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="시각장애인 스크린리더용 설명 (예: 답례큐 추석 답례품 추천 메인 배너)"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ccd6d1', borderRadius: 6, fontSize: 14 }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#2b3f36' }}>
              배너 배경 이미지 (JPG / PNG / WEBP, 최대 3MB)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              style={{ fontSize: 13 }}
            />
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#667c73' }}>
              * 이미지를 넣지 않으면 단정한 놋쇠 테두리와 배경색의 텍스트 배너로 표시됩니다.
            </p>
          </div>

          {/* 이미지 미리보기 */}
          {previewUrl && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#4b5563' }}>선택한 이미지 미리보기:</span>
              <div style={{
                marginTop: 6,
                maxHeight: 140,
                borderRadius: 8,
                overflow: 'hidden',
                background: '#1f4436',
                border: '1px solid #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img src={previewUrl} alt="업로드 이미지 미리보기" style={{ width: '100%', height: 'auto', maxHeight: 140, objectFit: 'cover' }} />
              </div>
            </div>
          )}

          {/* 고급 문구 설정 토글 */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{ background: 'none', border: 'none', color: '#1f4436', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              {showAdvanced ? '▲ 배너 내부 문구 접기' : '▼ 배너 내부 문구 직접 수정하기 (선택)'}
            </button>
          </div>

          {showAdvanced && (
            <div style={{ display: 'grid', gap: 12, background: '#fbfcfb', padding: 16, borderRadius: 8, border: '1px solid #e5ebe8' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>상단 작은 배지 문구</label>
                <input
                  type="text"
                  value={badgeText}
                  onChange={(e) => setBadgeText(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccd6d1', borderRadius: 4, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>메인 헤드라인</label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccd6d1', borderRadius: 4, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>설명 문구 (서브텍스트)</label>
                <input
                  type="text"
                  value={subText}
                  onChange={(e) => setSubText(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccd6d1', borderRadius: 4, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>우측 버튼 문구</label>
                <input
                  type="text"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccd6d1', borderRadius: 4, fontSize: 13 }}
                />
              </div>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={pending}
              style={{
                padding: '10px 24px',
                background: '#1f4436',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: pending ? 'not-allowed' : 'pointer',
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? '등록 중...' : '새 배너 등록하기'}
            </button>
          </div>
        </form>
      </section>

      {/* 3. 배너 목록 및 선택 적용 */}
      <section style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#1f4436' }}>
            📋 등록된 배너 목록 ({banners.length}개)
          </h2>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            * <b>[선택 및 적용]</b>을 누르면 쇼핑몰에 단 1개의 활성 배너로 즉시 적용됩니다.
          </span>
        </div>

        <div style={{ display: 'grid', gap: 20 }}>
          {banners.map((banner) => {
            const isActive = banner.isActive;
            return (
              <div
                key={banner.id}
                style={{
                  background: '#ffffff',
                  border: isActive ? '2px solid #1f4436' : '1px solid #e1e7e4',
                  boxShadow: isActive ? '0 4px 16px rgba(31,68,54,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
                  borderRadius: 12,
                  padding: 20,
                  display: 'grid',
                  gap: 14,
                }}
              >
                {/* 상단 메타 바 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      background: isActive ? '#1f4436' : '#e5e7eb',
                      color: isActive ? '#ffffff' : '#4b5563',
                    }}>
                      {isActive ? '★ 메인 적용 중' : '대기 중'}
                    </span>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      background: '#f3f4f6',
                      color: '#4b5563',
                    }}>
                      {SEASON_LABELS[banner.seasonType] || banner.seasonType}
                    </span>
                    <strong style={{ fontSize: 16, color: '#111827' }}>{banner.title}</strong>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!isActive ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleActivate(banner.id)}
                        style={{
                          padding: '7px 16px',
                          background: '#1f4436',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        선택 및 메인 적용
                      </button>
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1f4436' }}>
                        ✓ 현재 쇼핑몰 노출 중
                      </span>
                    )}

                    {banner.id !== 'banner-default' && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleDelete(banner.id, banner.title)}
                        style={{
                          padding: '7px 12px',
                          background: '#fff',
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          borderRadius: 6,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>

                {/* 배너 실제 형태 미리보기 (카페24 .ondap-cta 축소 렌더링) */}
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '18px 24px',
                  borderRadius: 10,
                  background: banner.imageUrl
                    ? `linear-gradient(rgba(18, 38, 30, 0.65), rgba(18, 38, 30, 0.78)), url('${banner.imageUrl}') center center / cover no-repeat`
                    : '#1f4436',
                  color: '#ffffff',
                  boxShadow: '0 4px 12px rgba(22,51,40,0.3)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    content: "''",
                    position: 'absolute',
                    inset: 5,
                    border: '1px solid rgba(214,190,140,0.45)',
                    borderRadius: 7,
                    pointerEvents: 'none',
                  }} />

                  <div style={{ position: 'relative', minWidth: 0, zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.85 }}>
                      <i style={{ display: 'inline-block', width: 7, height: 7, background: '#c4493b', transform: 'rotate(45deg)', borderRadius: 1 }} />
                      {banner.badgeText || '답례큐 AI 추천 큐레이션'}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                      {banner.headline || '자리에 맞는 답례, 답례큐가 추천드려요.'}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
                      {banner.subText || '행사와 받는 분, 예산만 알려주시면 답례큐 특허 AI 격식지수로 비교해 세 가지를 추천합니다.'}
                    </div>
                  </div>

                  <div style={{
                    position: 'relative',
                    flexShrink: 0,
                    zIndex: 1,
                    padding: '8px 18px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    background: '#ffffff',
                    color: '#1f4436',
                  }}>
                    {banner.buttonText || '답례품 추천받기'}
                  </div>
                </div>

                {/* 링크 및 상세 정보 */}
                <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  <span><b>링크</b>: <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1f4436' }}>{banner.linkUrl}</a></span>
                  <span><b>대체 텍스트(alt)</b>: {banner.altText}</span>
                  {banner.imageUrl && <span><b>이미지 경로</b>: <code>{banner.imageUrl}</code></span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
