'use client';

// 쉼표로 구분한 목록 칸 (해시태그·소멸위기지역). 입력하는 동안은 친 글자 그대로 두고 목록만 넘긴다:
// 매 글자마다 목록에서 다시 그리면 끝에 친 쉼표·띄어쓰기가 사라지거나 공백이 불어난다
import { useEffect, useState, type InputHTMLAttributes } from 'react';

const parse = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type Props = { value: string[]; onValue(list: string[]): void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

export function ListInput({ value, onValue, ...rest }: Props) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => {
    if (!same(parse(text), value)) setText(value.join(', ')); // 다른 상품을 열었을 때 등 밖에서 바뀐 경우만
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onValue(parse(e.target.value));
      }}
      onBlur={() => setText(value.join(', '))}
    />
  );
}
