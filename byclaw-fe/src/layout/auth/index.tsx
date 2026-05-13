import { sessionKey, tokenKey } from '@/utils/auth';
import { useDispatch, useLocation, useSearchParams, useSelector, useNavigate } from '@umijs/max';
import { useCallback, useEffect } from 'react';

import useAppStore from '@/models/common/useAppStore';
import usePlatform from '@/hooks/usePlatform';
import { getRootUnAuthPagePath, isRootPage } from '@/utils';

const unAuthPage: { [key: string]: boolean } = {
  '/': true,
  '/404': true,
  '/chat': true,
  '/chat/': true,
  '/mobile/login': true,
};

const Auth = ({ children }: { children: JSX.Element }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [searchParams, setSearchParams] = useSearchParams();
  const [platform] = usePlatform();

  const { setLoginModalOpen } = useAppStore();

  const dispatch = useDispatch();
  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const initUserInfo = useCallback(() => {
    dispatch({
      type: 'user/initUserInfo',
      payload: {},
    });
  }, [dispatch]);

  const myNavigate = useCallback(
    (url: string) => {
      setTimeout(() => {
        navigate(url);
      }, 100);
    },
    [navigate]
  );

  const mySetSearchParams = useCallback(
    (params: URLSearchParams) => {
      setTimeout(() => {
        setSearchParams(params);
      }, 100);
    },
    [setSearchParams]
  );

  const myRedirect = useCallback((url: string) => {
    const myUrl = decodeURIComponent(url);

    if (myUrl.startsWith('http')) {
      window.location.href = myUrl;
    } else {
      myNavigate(myUrl);
    }
  }, []);

  useEffect(() => {
    if (userInfo) {
      const redirectUrl = searchParams.get('redirectUrl');

      if (redirectUrl) {
        myRedirect(redirectUrl);
      }

      return;
    }

    const haslogin = window.localStorage.getItem(sessionKey) || window.localStorage.getItem(tokenKey);
    if (haslogin) {
      initUserInfo();
      return;
    }

    const unAuthPagePath = getRootUnAuthPagePath();
    if (!isRootPage()) {
      myNavigate(`${unAuthPagePath}?openLoginModal=1`);
    }
  }, [userInfo, platform, myRedirect, mySetSearchParams, setLoginModalOpen]);

  return userInfo || unAuthPage[pathname] === true ? children : null;
};

export default Auth;
