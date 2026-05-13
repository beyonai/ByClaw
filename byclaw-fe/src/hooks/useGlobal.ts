import GlobalContext from '@/layout/components/provider/global';
import { useContext } from 'react';

const useGlobal = () => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('useSession 必须在 SessionProvider 内使用');
  }
  return context;
};

export default useGlobal;
