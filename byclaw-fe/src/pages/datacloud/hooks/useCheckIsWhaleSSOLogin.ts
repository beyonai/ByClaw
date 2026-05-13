import { useSelector } from '@umijs/max';

export const IWHALE_SSO_LOGIN_TYPE = 'iwhale';

export default function useCheckIsWhaleSSOLogin() {
  const userInfo = useSelector(({ user }) => user.userInfo);
  return userInfo && userInfo.loginType === IWHALE_SSO_LOGIN_TYPE;
}
