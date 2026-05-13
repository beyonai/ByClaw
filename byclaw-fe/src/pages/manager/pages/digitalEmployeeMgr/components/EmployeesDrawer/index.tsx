// @ts-nocheck
/* eslint-disable no-nested-ternary */
import React, { useState, useEffect, useCallback } from 'react';

import { Drawer, Typography, Tag, Spin } from 'antd';
import classNames from 'classnames';
import { useIntl, useDispatch } from '@umijs/max';
import { Image } from '@/pages/manager/components/Image';
import { getAvatarUrl } from '@/pages/manager/utils/agent';

import styles from './index.module.less';

const { Title } = Typography;

function EmployeesDrawer(props) {
  const { open, onClose, agentInfo } = props;

  const dispatch = useDispatch();
  const intl = useIntl();

  const [questionList, setQuestionList] = useState([]);
  const [detailObj, setDetailObj] = useState({});
  const [isLoadig, setIsLoadig] = useState(false);

  const getDetail = useCallback(
    (resourceIdStr) => {
      setIsLoadig(true);
      setDetailObj({});
      setQuestionList([]);

      dispatch({
        type: 'employeeMgr/getCompositeAppInfo',
        payload: {
          resourceId: resourceIdStr,
        },
        success: (res) => {
          console.log(res);
          const { resourceName, avatar: avatarUrl, prologue, resourceDesc, resourceStatus } = res || {};
          setIsLoadig(false);

          let prologueTemp = {};

          try {
            prologueTemp = JSON.parse(prologue);
          } catch (e) {
            console.error(e);
          }

          const { openingQuestion, descText } = prologueTemp || {};

          setDetailObj({
            avatar: avatarUrl,
            name: resourceName,
            intro: resourceDesc,
            prologueText: descText,
            resourceStatus,
          });

          let tempSample = [];
          try {
            tempSample = JSON.parse(openingQuestion);
          } catch (error) {
            console.error(error);
          }
          setQuestionList(tempSample);
        },
        fail: () => {
          setIsLoadig(false);
        },
      });
    },
    [dispatch]
  );

  useEffect(() => {
    console.log('agentInfo:', agentInfo?.resourceId);
    if (agentInfo?.resourceId) {
      getDetail(agentInfo.resourceId);
    }
  }, [agentInfo?.resourceId]);

  return (
    <Drawer
      destroyOnHidden
      title={intl.formatMessage({ id: 'common.detail' })}
      width={520}
      onClose={onClose}
      open={open}
      className={styles.drawer}
      footer={null}
      bodyStyle={{
        padding: 0,
      }}
    >
      <Spin spinning={isLoadig}>
        <div className={styles.container}>
          {/* 头部信息 */}
          <div className={classNames(styles.header, 'ub ub-ver ub-ac')}>
            <Image
              width={48}
              src={getAvatarUrl(detailObj?.avatar)}
              style={{ borderRadius: '50%', overflow: 'hidden' }}
            />
            <div className={styles.headerContent}>
              <Title level={4} className={styles.title}>
                {detailObj?.name}
              </Title>
              <div className={classNames(styles.infoRow, 'ub gap-4')}>
                <span>@ {agentInfo?.createUserName || '-'}</span>
                {detailObj.resourceStatus === 1 && (
                  <Tag color="warning">{intl.formatMessage({ id: 'resourceStatus.reviewing' })}</Tag>
                )}
                {detailObj.resourceStatus === 2 && (
                  <Tag color="success">{intl.formatMessage({ id: 'resourceStatus.published' })}</Tag>
                )}
                {detailObj.resourceStatus === 3 && (
                  <Tag>{intl.formatMessage({ id: 'resourceStatus.unpublished' })}</Tag>
                )}
              </div>
            </div>
          </div>

          {/* 内容信息 */}
          <div className="ub ub-ver gap-16">
            {/* 介绍描述 */}
            <div className={styles.section}>
              <span className={styles.sectionTitle}>{intl.formatMessage({ id: 'employeeDetail.description' })}</span>
              <pre className={styles.sectionContent}>
                {detailObj?.intro || intl.formatMessage({ id: 'employeeDetail.empty' })}
              </pre>
            </div>

            {/* 开场白 */}
            <div className={styles.section}>
              <span className={styles.sectionTitle}>{intl.formatMessage({ id: 'employeeDetail.opening' })}</span>
              <pre className={styles.sectionContent}>
                {detailObj?.prologueText || intl.formatMessage({ id: 'employeeDetail.empty' })}
              </pre>
            </div>

            {/* 开场白问题 */}
            <div className={styles.section}>
              <span className={styles.sectionTitle}>{intl.formatMessage({ id: 'employeeDetail.questions' })}</span>
              <div className="ub ub-ver gap-4">
                {questionList.map((item, index) => (
                  <span key={index} className={styles.sectionContent}>
                    {item || ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Spin>
    </Drawer>
  );
}

export default EmployeesDrawer;
