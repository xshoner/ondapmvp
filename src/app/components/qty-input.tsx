'use client';

// 수량 칸: 입력하는 동안은 비워 둘 수 있게 글자로 들고, 칸을 벗어나면 1~100,000으로 맞춘 값을 다시 보여 준다
// (숫자로 바로 바꾸면 지우는 순간 1이 되어 '10'을 지우고 '30'을 치면 '130'이 된다)
import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { MAX_QTY, clampQty } from '@/lib/result-query.ts';

type Props = { value: number; onValue(n: number): void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

export function QtyInput({ value, onValue, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value)); // +/- 단추처럼 밖에서 바뀐 경우만
  }, [value]);
  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={1}
      max={MAX_QTY}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== '') onValue(clampQty(e.target.value));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}
