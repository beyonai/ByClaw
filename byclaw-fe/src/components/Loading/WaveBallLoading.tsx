import React from 'react';

import { getPublicPath } from '@/utils';

function WaveBallLoading(props: { style: React.CSSProperties }) {
  const { style } = props;

  return (
    <img key="WaveBallLoading" src={`${getPublicPath()}svg/WaveBallLoading.svg`} style={style} alt="WaveBallLoading" />
  );
}

export default WaveBallLoading;
