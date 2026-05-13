import React, { useEffect, useRef } from 'react';

const SubAppContainer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('[SubAppContainer] mounted');
    return () => {
      console.log('[SubAppContainer] unmounted');
    };
  }, []);

  return (
    <div
      id="subapp-container"
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
      }}
    />
  );
};

export default SubAppContainer;
