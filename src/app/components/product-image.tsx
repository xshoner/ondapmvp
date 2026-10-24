import Image from 'next/image';

// 상품 동기화가 새 이미지 호스트를 가져와도 화면 전체를 오류로 바꾸지 않는다.
export function ProductImage({ src, alt, main = false }: { src: string; alt: string; main?: boolean }) {
  let optimize = false;
  try { const url = new URL(src); optimize = url.protocol === 'https:' && url.hostname === 'ecimg.cafe24img.com'; } catch { /* 외부 주소가 아니면 원본 표시 */ }
  const width = main ? 640 : 144, height = main ? 480 : 144;
  const style = main ? { width: '100%', height: 'auto' } : undefined;
  return optimize ? <Image src={src} alt={alt} width={width} height={height} style={style} sizes={main ? '(max-width: 600px) 100vw, 480px' : '88px'} preload={main} loading={main ? undefined : 'lazy'} />
    : <img src={src} alt={alt} width={width} height={height} style={style} loading={main ? 'eager' : 'lazy'} decoding="async" />;
}
