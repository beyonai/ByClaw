import { getPublication, type PublicationDetail } from '@/service/employeePublication';
import { publicationErrorMessage } from '@/utils/publicationError';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function usePublicationDetailLoader(publicationId?: string) {
  const [state, setState] = useState({ id: publicationId, loading: !!publicationId, error: '' });
  const sequence = useRef(0);
  const retryRef = useRef<() => void>();
  const inFlight = useRef(false);
  useEffect(() => {
    inFlight.current = false;
    retryRef.current = undefined;
    return () => {
      sequence.current += 1;
    };
  }, [publicationId]);

  const load = useCallback(
    async (onLoaded: (detail: PublicationDetail) => void) => {
      if (!publicationId || inFlight.current) return;
      inFlight.current = true;
      const current = ++sequence.current;
      retryRef.current = () => {
        void load(onLoaded);
      };
      setState({ id: publicationId, loading: true, error: '' });
      try {
        const detail = await getPublication(publicationId);
        if (current !== sequence.current) return;
        onLoaded(detail);
        setState({ id: publicationId, loading: false, error: '' });
      } catch (error) {
        if (current !== sequence.current) return;
        setState({
          id: publicationId,
          loading: false,
          error: publicationErrorMessage(error, '发布配置加载失败，请稍后重试'),
        });
      } finally {
        if (current === sequence.current) inFlight.current = false;
      }
    },
    [publicationId]
  );

  return {
    loading: !!publicationId && (state.id !== publicationId || state.loading),
    error: state.id === publicationId ? state.error : '',
    load,
    retry: () => retryRef.current?.(),
  };
}
