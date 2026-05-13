import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { message } from 'antd';

interface Props extends UseMutationOptions<any, any, any, any> {
  successToast?: string | null;
  errorToast?: string | null;
}

export const useRequest = ({
  successToast,
  errorToast,
  onSuccess,
  onError,
  ...props
}: Props) => {
  const mutation = useMutation<unknown, unknown, any, unknown>({
    ...props,
    onSuccess(res, variables: void, context: unknown) {
      onSuccess?.(res, variables, context);
      if (successToast) {
        message.success(successToast);
      }
    },
    onError(err: any, variables: void, context: unknown) {
      const msg: string =
        typeof err === 'string'
          ? err
          : err?.message || err?.msg || err?.msg || errorToast || '';
      onError?.(err, variables, context);
      if (msg) {
        message.error(msg);
      }
    },
  });

  return mutation;
};
