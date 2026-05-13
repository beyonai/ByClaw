import React, { useLayoutEffect, useRef } from 'react';

export interface ImageProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  width?: number | string;
  height?: number | string;
  defaultSrc?: string;
}

export const Image = (props: ImageProps) => {
  const { src, defaultSrc = '', width, height, style, ...attrs } = props;
  const ref = useRef<HTMLDivElement>(null);
  const tmp = useRef({
    target: new window.Image(),
    holder: new window.Image(),
  });

  useLayoutEffect(() => {
    if (src && ref.current) {
      tmp.current.target.onload = () => {
        ref.current?.appendChild(tmp.current.target);

        requestAnimationFrame(() => {
          tmp.current.holder.remove();
        });
      };
      tmp.current.target.src = src;
    }
  }, [src]);

  useLayoutEffect(() => {
    if (defaultSrc && ref.current) {
      tmp.current.holder.src = defaultSrc;
      ref.current.appendChild(tmp.current.holder);
    }
  }, [defaultSrc]);

  useLayoutEffect(() => {
    if (width) {
      tmp.current.target.style.width = typeof width === 'number' ? `${width}px` : width;
      tmp.current.holder.style.width = typeof width === 'number' ? `${width}px` : width;
    }
    if (height) {
      tmp.current.target.style.height = typeof height === 'number' ? `${height}px` : height;
      tmp.current.holder.style.height = typeof height === 'number' ? `${height}px` : height;
    }
  }, [width, height]);

  return <figure ref={ref} data-src={src} {...attrs} style={{ margin: 0, height: '100%', ...style }} />;
};

export default Image;
