import { useCallback, useRef, useState } from 'react';
import { App } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import useAppStore from '@/models/common/useAppStore';
import { loginOperationAccount } from '@/service/devloop';
import { getSandboxInfo, launchSandboxByUserCode, navigateSandboxBrowser, type SandboxInfo } from '@/service/sandbox';
import type { ISandboxesInfo } from '@/models/common/useAppStore';
import { getVNCUrl } from '@/utils/chat';
import type { OperationAccount, OperationIdentifier } from './types';

// 沙箱接口的 instanceEndpoints 为开放键值，全局 store 只声明已知端点，写入前按 store 结构收敛。
const toStoreSandboxInfo = (sandbox: SandboxInfo): ISandboxesInfo => ({
  endpoints: sandbox.endpoints,
  instanceEndpoints: sandbox.instanceEndpoints as ISandboxesInfo['instanceEndpoints'],
  sandboxId: sandbox.sandboxId,
  sandboxType: sandbox.sandboxType,
  userCode: sandbox.userCode,
  token: sandbox.token,
});

// 四个平台复用采集沙箱中的浏览器，登录入口只维护平台地址，不再创建独立 Recorder 会话。
export const OPERATION_PLATFORM_LOGIN_URLS: Record<string, string> = {
  WeChatAccount: 'https://mp.weixin.qq.com/',
  wechat: 'https://mp.weixin.qq.com/',
  Xiaohongshu: 'https://creator.xiaohongshu.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  WeChatChannels: 'https://channels.weixin.qq.com/',
  video: 'https://channels.weixin.qq.com/',
  Douyin: 'https://creator.douyin.com/',
  douyin: 'https://creator.douyin.com/',
};

/** 自定义链接平台的登录地址来自账号自身的 customUrl，其余平台使用预设站点。 */
export const resolveOperationAccountLoginUrl = (account: OperationAccount): string | undefined =>
  account.platformId === 'CustomLink' ? account.customUrl : OPERATION_PLATFORM_LOGIN_URLS[account.platformId];

/**
 * 运营账号登录链路：准备用户沙箱 → 打开远程桌面 → 通过 bycli 在沙箱浏览器打开登录页 → 用户确认登录完成。
 * 项目大详情与项目空间账号页共用，避免两处入口的登录行为出现差异。
 */
export function useOperationAccountLogin(onLoggedIn?: () => void | Promise<void>) {
  const intl = useIntl();
  const { message } = App.useApp();
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const [loginTarget, setLoginTarget] = useState<OperationAccount | null>(null);
  const [loginPreparingAccountId, setLoginPreparingAccountId] = useState<OperationIdentifier | null>(null);
  const [loginConfirming, setLoginConfirming] = useState(false);
  const loginSandboxIdRef = useRef('');

  // 关闭账号登录时同步收起全局远程桌面，避免切换账号或项目后保留旧平台页面。
  const closeRemoteDesktop = useCallback(() => {
    loginSandboxIdRef.current = '';
    setLoginTarget(null);
    setLoginPreparingAccountId(null);
    setLoginConfirming(false);
    EventEmitter.emit('beyond-main-driver-open-type', '');
  }, [EventEmitter]);

  // 优先复用采集流程已经启动的沙箱；首次使用尚无沙箱时按当前用户启动默认 openclaw 沙箱。
  const resolveSandbox = useCallback(async (): Promise<SandboxInfo> => {
    const currentSandboxes = await getSandboxInfo({});
    const runningSandbox =
      currentSandboxes.find((sandbox) => sandbox.status === 'RUNNING' && !!sandbox.sandboxId) ||
      currentSandboxes.find((sandbox) => !!sandbox.sandboxId);
    if (runningSandbox) {
      useAppStore.setState({ sandboxesInfo: toStoreSandboxInfo(runningSandbox) });
      return runningSandbox;
    }
    if (!userInfo?.userCode) throw new Error('missing_user_code');
    const launchedSandbox = await launchSandboxByUserCode({ userCode: userInfo.userCode, serviceKey: 'openclaw' });
    const sandboxInfo: SandboxInfo = {
      ...launchedSandbox,
      userCode: userInfo.userCode,
      sandboxType: 'byclaw',
      status: 'RUNNING',
    };
    useAppStore.setState({ sandboxesInfo: toStoreSandboxInfo(sandboxInfo) });
    return sandboxInfo;
  }, [userInfo?.userCode]);

  // 沙箱准备完成后立即打开远程桌面，再异步导航登录页，避免导航等待期间用户看不到扫码入口。
  const handleLogin = useCallback(
    async (account: OperationAccount) => {
      const loginUrl = resolveOperationAccountLoginUrl(account);
      if (!loginUrl) {
        message.warning(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.urlMissing' }));
        return;
      }
      if (loginPreparingAccountId !== null) return;
      setLoginPreparingAccountId(account.id);
      try {
        const sandboxInfo = await resolveSandbox();
        loginSandboxIdRef.current = sandboxInfo.sandboxId;
        setLoginTarget(account);
        EventEmitter.emit('beyond-main-driver-open-type', {
          drawerType: 'vnc',
          title: intl.formatMessage({ id: 'projectSpace.operation.accountLogin.remoteDesktop' }),
          canClose: true,
          // 账号管理页保持原位，远程桌面只覆盖右侧区域，不参与主页面宽度计算。
          overlay: true,
          width: '50vw',
        });
        EventEmitter.emit('beyond-main-driver-message', { url: getVNCUrl(toStoreSandboxInfo(sandboxInfo)) });
        try {
          // 首次登录时浏览器可能还在启动，导航失败后自动重试一次
          let navigateSuccess = false;
          try {
            await navigateSandboxBrowser({
              sandboxId: sandboxInfo.sandboxId,
              targetUrl: loginUrl,
              sessionKey: `operation-account-${account.id}`,
            });
            navigateSuccess = true;
          } catch (firstError) {
            // 首次失败，等待5秒后重试（给浏览器更多启动时间）
            await new Promise((resolve) => {
              setTimeout(resolve, 5000);
            });
            await navigateSandboxBrowser({
              sandboxId: sandboxInfo.sandboxId,
              targetUrl: loginUrl,
              sessionKey: `operation-account-${account.id}`,
            });
            navigateSuccess = true;
          }
          if (navigateSuccess) {
            message.success(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.navigateSuccess' }));
          }
        } catch {
          // 导航失败时保留远程桌面，用户仍可在沙箱浏览器中手工进入对应平台完成登录。
          message.warning(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.navigateFailed' }));
        }
      } catch {
        message.error(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.startFailed' }));
      } finally {
        setLoginPreparingAccountId(null);
      }
    },
    [EventEmitter, intl, loginPreparingAccountId, message, resolveSandbox]
  );

  const handleConfirmLogin = useCallback(async () => {
    const sandboxId = loginSandboxIdRef.current;
    if (!loginTarget || !sandboxId || loginConfirming) return;
    setLoginConfirming(true);
    try {
      await loginOperationAccount(loginTarget.id, sandboxId);
      await onLoggedIn?.();
      message.success(intl.formatMessage({ id: 'projectSpace.operation.account.loginSuccess' }));
      closeRemoteDesktop();
    } catch {
      message.error(intl.formatMessage({ id: 'projectSpace.operation.accountLogin.confirmFailed' }));
    } finally {
      setLoginConfirming(false);
    }
  }, [closeRemoteDesktop, intl, loginConfirming, loginTarget, message, onLoggedIn]);

  return {
    loginTarget,
    loginPreparingAccountId,
    loginConfirming,
    handleLogin,
    handleConfirmLogin,
    closeRemoteDesktop,
  };
}

export default useOperationAccountLogin;
