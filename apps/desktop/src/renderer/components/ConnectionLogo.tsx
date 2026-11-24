import type { ReactNode } from 'react';
import { Icon } from './Icon';

const logos = import.meta.glob<string>('../assets/connections/*', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function ConnectionLogo({
  id,
  className = 'size-5',
  fallback = <Icon name="plug" size={14} />,
}: {
  id: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const logo = Object.entries(logos).find(
    ([path]) =>
      path
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') === id,
  );
  return logo ? (
    <img
      src={logo[1]}
      alt=""
      className={`${className} object-contain ${id === 'attio' ? 'brightness-0 saturate-100 invert-[40%] sepia-[51%] saturate-[2000%] hue-rotate-[222deg]' : ''}`}
    />
  ) : (
    fallback
  );
}
