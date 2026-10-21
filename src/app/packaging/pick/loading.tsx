import { WaitingScreen } from '../../components/page-states.tsx';

export default function Loading() {
  return <WaitingScreen title="상품을 불러오고 있습니다" sub="포장할 상품 목록을 준비하는 중입니다." />;
}
