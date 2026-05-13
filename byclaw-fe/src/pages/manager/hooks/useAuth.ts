// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { listAuthDetail, batchHandleAuth, allowManageAuth } from '@/pages/manager/service/DigitalResourceMgr';
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
  }, [grantType, grantObjType, grantObjId, getGrantItem]);

  // 编辑授权
  const setAuth = useCallback(
    (cb) => {
      if (!grantType || !grantObjType || authLoading) return;
      setAuthLoading(true);

      if (grantType === grantTypeMap.useAuth) {
        // 使用授权：使用 batchHandleAuth 接口
        // 授权对象的 grantType 是 FORCE_USE
        const authObjectList =
          redList?.map((item) => ({
            ...transFormGrandItem(item),
            grantType: 'FORCE_USE',
          })) || [];

        // 排除对象的 grantType 是 FORCE_USE
        const blackObjectList =
          blackList?.map((item) => ({
            ...transFormGrandItem(item),
            grantType: 'FORCE_USE',
          })) || [];

        const authParams = {
          orgId,
          grantObjId,
          grantObjType,
          redList: authObjectList,
          blackList: blackObjectList,
          resourceId: grantObjId, // 资源授权使用
        };
        // 开发态：传递pid参数
        if (pid) {
          authParams.pid = pid;
        }
        batchHandleAuth(authParams, authApiPath).then((res) => {
          setAuthLoading(false);
          if (res && res.code === 0) {
            message.success('授权成功');
            if (cb) cb();
          } else {
            message.error(`授权失败：${res?.msg}`);
          }
        });
      } else {
        // 管理授权：保持原有逻辑
        const manageAuthParams = {
          orgId,
          grantObjId,
          grantObjType,
          redList: redList?.map(transFormGrandItem),
          blackList: blackList?.map(transFormGrandItem),
          resourceId: grantObjId, // 资源授权使用
        };
        // 开发态：传递pid参数
        if (pid) {
          manageAuthParams.pid = pid;
        }
        allowManageAuth(manageAuthParams, authApiPath).then((res) => {
          setAuthLoading(false);
          if (res && res.code === 0) {
            message.success('授权成功');
            if (cb) cb();
          } else {
            message.error(`授权失败：${res?.msg}`);
          }
        });
      }
    },
    [redList, blackList, authLoading, grantType, grantObjType, grantObjId, orgId, transFormGrandItem, pid, authApiPath]
  );

  // 初始化详情
  useEffect(() => {
    getDetail();
  }, [getDetail]);

  return {
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
