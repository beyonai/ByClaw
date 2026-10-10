import { useIntl } from '@umijs/max';
import { openPublication, type PublicationDetail } from '@/service/employeePublication';
import { publicationErrorMessage } from '@/utils/publicationError';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function usePublicationDetailLoader(publicationId?: string) {
  const intl = useIntl();
  const [state, setState] = useState({ id: publicationId, loading: !!publicationId, error: '' });
  const sequence = useRef(0);
  const retryRef = useRef<() => void>();
  const inFlight = useRef(false);
  const hydrateRef = useRef<(detail: PublicationDetail) => void>();
  useEffect(() => {
    inFlight.current = false;
    retryRef.current = undefined;
    hydrateRef.current = undefined;
    return () => {
      sequence.current += 1;
      hydrateRef.current = undefined;
    };
  }, [publicationId]);

  const load = useCallback(
    async (onLoaded: (detail: PublicationDetail) => void) => {
      if (!publicationId || inFlight.current) return;
      inFlight.current = true;
      hydrateRef.current = onLoaded;
      const current = ++sequence.current;
      retryRef.current = () => {
        void load(onLoaded);
      };
      setState({ id: publicationId, loading: true, error: '' });
      try {
        const detail = await openPublication(publicationId);
        if (current !== sequence.current) return;
        onLoaded(detail);
        setState({ id: publicationId, loading: false, error: '' });
      } catch (error) {
        if (current !== sequence.current) return;
        setState({
          id: publicationId,
          loading: false,
          error: publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.detailLoadFailed' })),
        });
      } finally {
        if (current === sequence.current) inFlight.current = false;
      }
    },
    [intl, publicationId]
  );

  return {
    loading: !!publicationId && (state.id !== publicationId || state.loading),
    error: state.id === publicationId ? state.error : '',
    load,
    hydrate: (detail: PublicationDetail) => hydrateRef.current?.(detail),
    retry: () => retryRef.current?.(),
  };
}
