// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { listAuthDetail, batchHandleAuth, allowManageAuth } from '@/pages/manager/service/DigitalResourceMgr';
import useAuthorizationTask from './useAuthorizationTask';
import { grantTypeMap } from '@/pages/manager/constants/digitalResource';

function useAuth({
  authType, // useAuth | mgrAuth
  grantObjType = 'DIG_EMPLOYEE',
  grantObjId,
  orgId,
  pid, // 开发态：项目ID
  authApiPath,
}) {
  const [redList, setRedList] = useState([]);
  const [blackList, setBlackList] = useState([]);
  const [applicantList, setApplicantList] = useState([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const grantType = grantTypeMap[authType];
  // 资源中心合并显示正式使用授权；数字员工及员工组保留各自的授权同步契约。
  const includeUseGrantFamily =
    authType === 'useAuth' &&
    grantObjType !== 'DIG_EMPLOYEE' &&
    authApiPath === '/byaiService/auth/privilegeGrant/setResourceUsers';

  // 详情item格式化出参
  const getGrantItem = useCallback(
    (ele) => ({
      ...ele,
      id: `${ele.grantToObjType.toLowerCase()}_${ele.grantToObjId}`,
      name: ele.grantToObjName,
      type: ele.grantToObjType,
    }),
    []
  );

  // 编辑item格式化入惨
  const transFormGrandItem = useCallback((ele) => {
    const [, grantToObjId] = ele.id.split('_');
    return {
      grantToObjId,
      grantToObjType: ele.type,
    };
  }, []);

  // 请求详情
  const getDetail = useCallback(() => {
    if (!grantType || !grantObjType || !grantObjId) return;
    setDetailLoading(true);
    listAuthDetail({
      grantType, // 授权类型 AVAILABLE_USE:使用授权,FORCE_USE：强制使用,ALLOW_MANAGE:管理授权
      grantObjType, // 授权资源类型,AGNET:智能体,DOC:文档库,DB:数据库,PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录,TAG:标签
      grantObjId,
      ...(includeUseGrantFamily ? { includeUseGrantFamily: true } : {}),
    })
      .then((detailRes) => {
        if (detailRes && detailRes.code === 0) {
          setRedList(detailRes.data?.redList?.map(getGrantItem) || []);
          setBlackList(detailRes.data?.blackList?.map(getGrantItem) || []);
        } else {
          message.error(`查询详情失败：${detailRes?.msg}`);
        }
        setApplicantList([]);
      })
      .catch((error) => {
        message.error(`查询详情失败：${error}`);
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }, [grantType, grantObjType, grantObjId, getGrantItem, includeUseGrantFamily]);

  const background = useAuthorizationTask({
    enabled: [
      '/byaiService/auth/privilegeGrant/setResourceUsers',
      '/byaiService/auth/privilegeGrant/setResourceManagers',
    ].includes(authApiPath),
    resourceId: grantObjId,
    onCompleted: getDetail,
  });
  const usesBackground = [
    '/byaiService/auth/privilegeGrant/setResourceUsers',
    '/byaiService/auth/privilegeGrant/setResourceManagers',
  ].includes(authApiPath);

  const setAuth = useCallback(
    async (cb) => {
      if (!grantType || !grantObjType || authLoading || background.taskBlocked) return;
      setAuthLoading(true);
      const use = grantType === grantTypeMap.useAuth;
      const target = (item) => ({ ...transFormGrandItem(item), ...(use ? { grantType: 'FORCE_USE' } : {}) });
      const params = {
        orgId,
        grantObjId,
        grantObjType,
        resourceId: grantObjId,
        redList: redList?.map(target) || [],
        blackList: blackList?.map(target) || [],
        ...(pid ? { pid } : {}),
        ...(includeUseGrantFamily ? { includeUseGrantFamily: true } : {}),
      };
      try {
        if (usesBackground) {
          await background.submitTask(params, use ? 'USE' : 'MANAGE', cb);
        } else {
          const response = await (use ? batchHandleAuth : allowManageAuth)(params, authApiPath);
          if (!response || response.code !== 0) throw new Error(response?.msg || '请求失败');
          message.success('授权成功');
          cb?.();
        }
      } catch (error) {
        message.error(`授权失败：${error?.message || '网络异常，请重试'}`);
      } finally {
        setAuthLoading(false);
      }
    },
    [
      redList,
      blackList,
      grantType,
      grantObjType,
      grantObjId,
      orgId,
      pid,
      authApiPath,
      includeUseGrantFamily,
      transFormGrandItem,
      authLoading,
      usesBackground,
      background.taskBlocked,
      background.submitTask,
    ]
  );

  // 初始化详情
  useEffect(() => {
    getDetail();
  }, [getDetail]);

  return {
    ...background,
    redList,
    blackList,
    applicantList,
    setRedList,
    setBlackList,
    setApplicantList,
    setAuth,
    authLoading,
    detailLoading,
  };
}

export default useAuth;
