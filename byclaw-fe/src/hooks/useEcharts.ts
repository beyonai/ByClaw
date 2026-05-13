import { useEffect, useRef } from 'react';

export default function useEcharts() {
  const echatsRef = useRef();

  useEffect(() => {
    if (echatsRef.current) {
      echatsRef.current.resize();
    }
  }, []);

  return {
    echatsRef,
  };
}
