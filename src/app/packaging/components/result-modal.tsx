'use client';

import { useEffect, useState } from 'react';
import { orderUrl } from '@/packaging/client.ts';
import { isMobileUA } from '@/lib/device.ts';
import type { PackagingOptionInfo } from '@/packaging/pricing.ts';
import { won } from '@/lib/result-query.ts';

interface Props {
  code: string;
  preview: string | null;
  cutClip: string;
  product: {
    productNo?: number;
    name: string;
    url: string;
  };
  quantity: number;
  from: string;
  packagingOption?: PackagingOptionInfo | null;
  onEditMore: () => void;
}

export function ResultModal({
  code,
  preview,
  cutClip,
  product,
  quantity,
  from,
  packagingOption,
  onEditMore,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [currentOption, setCurrentOption] = useState<PackagingOptionInfo | null>(packagingOption ?? null);
  const [isCheckingLatest, setIsCheckingLatest] = useState(Boolean(product.productNo));
  const [ordering, setOrdering] = useState(false);

  // 모달 진입 시 최신 가격 재조회 및 실패 처리
  useEffect(() => {
    if (!product.productNo) return;
    let active = true;
    setIsCheckingLatest(true);
    fetch(`/api/packaging/option-price?product=${product.productNo}&refresh=1`, { cache: 'no-store' })
      .then(async (r) => {
        if (!active) return;
        if (!r.ok) {
          setCurrentOption({
            status: 'unconfirmed',
            productNo: product.productNo,
            unitPrice: null,
            reason: 'api_error',
          });
          return;
        }
        const json = await r.json();
        const data: PackagingOptionInfo = json?.data ?? json;
        if (active) {
          if (data && data.productNo === product.productNo) {
            setCurrentOption(data);
          } else {
            setCurrentOption({
              status: 'unconfirmed',
              productNo: product.productNo,
              unitPrice: null,
              reason: 'api_error',
            });
          }
        }
      })
      .catch(() => {
        if (active) {
          setCurrentOption({
            status: 'unconfirmed',
            productNo: product.productNo,
            unitPrice: null,
            reason: 'api_error',
          });
        }
      })
      .finally(() => {
        if (active) setIsCheckingLatest(false);
      });

    return () => {
      active = false;
    };
  }, [product.productNo]);

  // 창을 오래 열어 둔 뒤 주문하러 갈 때 이동 직전 최종 가격 재확인
  const handleOrderGo = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!product.productNo) return;
    e.preventDefault();
    if (ordering) return;
    setOrdering(true);
    const targetHref = orderUrl(product.url, code, quantity);
    // 사용자 클릭 중 창을 열어야 비동기 조회 뒤 팝업 차단을 피할 수 있다.
    const orderWindow = from === 'cafe24' ? null : window.open('about:blank', '_blank');
    if (orderWindow) orderWindow.opener = null;

    try {
      const res = await fetch(`/api/packaging/option-price?product=${product.productNo}&refresh=1`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const data: PackagingOptionInfo = json?.data ?? json;
        if (data && data.productNo === product.productNo) {
          setCurrentOption(data);
        } else {
          setCurrentOption({ status: 'unconfirmed', productNo: product.productNo, unitPrice: null, reason: 'api_error' });
        }
      } else {
        setCurrentOption({ status: 'unconfirmed', productNo: product.productNo, unitPrice: null, reason: 'api_error' });
      }
    } catch {
      setCurrentOption({ status: 'unconfirmed', productNo: product.productNo, unitPrice: null, reason: 'api_error' });
    } finally {
      setOrdering(false);
      if (from === 'cafe24' || !orderWindow) {
        window.location.href = targetHref;
      } else {
        orderWindow.location.href = targetHref;
      }
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 복사 권한 오류 시 무시
    }
  };

  // PC 환경인 경우 스마트폰 주문 연동용 QR 코드 생성
  useEffect(() => {
    if (isMobileUA() || typeof window === 'undefined') return;
    let live = true;
    void import('qrcode-generator')
      .then(({ default: qrcode }) => {
        const q = qrcode(0, 'M');
        q.addData(`${window.location.origin}/packaging/mine?code=${code}`);
        q.make();
        if (live) setQr(q.createDataURL(4, 2));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="디자인 코드 발급 완료">
      <div className="modal card pkg-result-modal">
        <div className="pkg-result-header">
          <span className="pkg-result-check-icon">✓</span>
          <h2 style={{ fontSize: 21, margin: '8px 0 0' }}>포장 디자인 저장 완료!</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            디자인이 성공적으로 저장되었습니다. 아래 코드로 쇼핑몰에서 주문을 완료해 주세요.
          </p>
        </div>

        {preview && (
          <div className="pkg-result-preview-wrap">
            <img
              src={preview}
              alt="저장된 스티커 디자인"
              width={140}
              height={140}
              style={{ clipPath: cutClip }}
            />
          </div>
        )}

        {/* 발급된 디자인 코드 */}
        <div className="pkg-result-code-card">
          <span className="small muted">답례큐 디자인 코드</span>
          <div className="design-code">{code}</div>
          <button
            type="button"
            className="btn ghost small"
            style={{ marginTop: 8 }}
            onClick={copyCode}
          >
            {copied ? '✓ 코드가 복사되었습니다' : '코드 복사하기'}
          </button>
        </div>

        {/* 쇼핑몰 주문 연계 안내 */}
        <div className="pkg-order-instructions">
          <b>주문 진행 방법</b>
          <ol className="steps-list" style={{ marginTop: 8 }}>
            <li>
              <b>‘주문하러 가기’</b>를 누르면 쇼핑몰 상품 페이지로 이동합니다. (수량은 <b>{quantity}개</b>로 자동 연동을 시도하나, 쇼핑몰 화면에서 수량을 다시 한 번 확인해 주세요.)
            </li>
            <li>
              상품 페이지에서 <b>포장 디자인 서비스</b> 옵션과 수량을 자동 선택하도록 시도합니다. 자동 선택되지 않으면 옵션을 직접 선택하고 합계를 확인해 주세요.{' '}
              {isCheckingLatest ? (
                <>최신 포장비를 확인하고 있습니다...{' '}</>
              ) : currentOption?.status === 'confirmed' && currentOption.unitPrice !== null ? (
                <>예상 포장비는 {won(currentOption.unitPrice)} × {quantity.toLocaleString('ko-KR')}개 = <b>{won(currentOption.unitPrice * quantity)}</b>입니다.{' '}</>
              ) : (
                <>예상 포장비는 쇼핑몰 상세 페이지에서 확인해 주세요.{' '}</>
              )}
              옵션이 보이지 않으면 고객센터에 문의해 주세요. (※ 최종 결제 금액 및 배송비는 쇼핑몰 기준)
            </li>
            <li>‘바로 구매하기’를 누르면 로그인 또는 <b>비회원 구매</b>로 주문할 수 있습니다.</li>
            <li>
              주문서 작성 화면의 <b>‘답례큐 포장 디자인 코드’</b>(또는 온답 포장 디자인 코드) 칸에 코드가 자동 입력되었는지 확인해 주세요. 칸이 비어 있거나 비회원 주문 시에는 위 &lsquo;코드 복사하기&rsquo;를 눌러 직접 붙여넣어 주세요.
            </li>
          </ol>
        </div>

        {qr && (
          <div className="qr-box">
            <img src={qr} alt="휴대폰 주문 QR" width={96} height={96} />
            <div className="small muted">
              <b>스마트폰으로 디자인 확인하기</b>
              <p style={{ margin: '2px 0 0' }}>
                휴대폰 카메라로 QR 코드를 스캔하면 <b>답례큐 내 디자인 상세 조회 페이지</b>로 연결되어, 저장된 포장 디자인을 확인하고 쇼핑몰 주문을 진행하실 수 있습니다.
              </p>
              {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                <p className="small" style={{ color: 'var(--brass)', margin: '4px 0 0', fontSize: 11.5 }}>
                  ※ 현재 로컬 개발 환경(127.0.0.1)의 주소이므로 외부 스마트폰으로 스캔 시 접속되지 않습니다. (로컬 브라우저에서 직접 이용해 주세요)
                </p>
              )}
            </div>
          </div>
        )}

        <div className="pkg-result-actions" style={{ display: 'grid', gap: 8, marginTop: 20 }}>
          <a
            className="btn block large"
            href={orderUrl(product.url, code, quantity)}
            target={from === 'cafe24' ? '_self' : '_blank'}
            rel="noreferrer"
            onClick={handleOrderGo}
          >
            {ordering ? '최신 가격 확인 후 이동 중...' : '주문하러 가기 ›'}
          </a>
          <button type="button" className="btn ghost block" onClick={onEditMore}>
            디자인 더 수정하기
          </button>
          <a
            className="link-btn small"
            style={{ textAlign: 'center', marginTop: 4 }}
            href="/packaging/mine"
          >
            내 디자인 목록 보러가기
          </a>
        </div>
      </div>
    </div>
  );
}
