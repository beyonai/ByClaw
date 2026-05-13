import LoadingComponent from '@/components/Loading';
import { useCallback, useState } from 'react';

export const useLoading = (props?: { defaultLoading: boolean }) => {
  const [isLoading, setIsLoading] = useState(props?.defaultLoading || false);

  const Loading = useCallback(
    ({
      loading,
      fixed = true,
      text = '',
      zIndex,
    }: {
      loading?: boolean;
      fixed?: boolean;
      text?: string;
      zIndex?: number;
    }): JSX.Element | null => {
      return isLoading || loading ? <LoadingComponent fixed={fixed} text={text} zIndex={zIndex} /> : null;
    },
    [isLoading]
  );

  return {
    isLoading,
    setIsLoading,
    Loading,
  };
};
