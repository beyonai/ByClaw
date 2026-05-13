import React from 'react';

import { getPublicPath } from '@/utils';

function DualBallLoading(props: { style: React.CSSProperties }) {
  const { style } = props;

  return <img src={`${getPublicPath()}svg/DualBallLoading.svg`} style={style} alt="DualBallLoading" />;
}

export default DualBallLoading;
