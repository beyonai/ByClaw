import { Spin } from 'antd';

const Loading = ({
  fixed = true,
  text = '',
  bg = 'rgba(255,255,255,0.5)',
  zIndex = 1000,
}: {
  fixed?: boolean;
  text?: string;
  bg?: string;
  zIndex?: number;
}) => {
  return (
    <div
      style={{
        display: 'flex',
        position: fixed ? 'fixed' : 'absolute',
        zIndex,
        background: bg,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}
    >
      <Spin spinning />
      {text && <span style={{ fontWeight: 'bold' }}>{text}</span>}
    </div>
  );
};

export default Loading;
