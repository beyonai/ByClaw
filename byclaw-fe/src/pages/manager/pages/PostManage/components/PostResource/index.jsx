import React, { forwardRef, useImperativeHandle, useState, useEffect, useCallback } from 'react';
import { Button, Pagination, Tag } from 'antd';
import { get } from 'lodash';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import { KeepAlive } from 'react-activation';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import styles from './index.module.less';
import skillIcon from '@/pages/manager/assets/defResourceIcon.png';
import employeeIcon from '@/pages/manager/assets/Avatar.png';
import knowledgeIcon from '@/pages/manager/assets/knowledge.png';
import { ownerTypeMap, resourceStatus } from '@/pages/manager/constants/digitalResource';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import { buildResourceCommonColumns } from '@/pages/manager/utils/resourceColumns';

const PostResource = (props, ref) => {
  const { selectedPost, searchValue, activeTab, record } = props;

  const dispatch = useDispatch();
  const intl = useIntl();
  // const navigate = useNavigate();

  const isLoading = useSelector(({ loading }) => loading.effects['orgMgr/listResource']);

  const [data, setData] = useState({
    dataSource: [],
    total: 0,
  });
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: 10,
  });

  // 技能详情抽屉（复用 asset/skills 的详情能力）
  const { placeholder: SkillDetailDrawerHolder, show: showSkillDetailDrawer } = useSkillDetailDrawer();

  const getResourceBizTypeList = useCallback(() => {
    if (activeTab === 'employee') {
      return ['DIG_EMPLOYEE'];
    }
    if (activeTab === 'knowledge') {
      return ['KG_DOC', 'KG_QA', 'KG_TERM'];
    }
    if (activeTab === 'tool') {
      return ['AGENT', 'MCP', 'TOOLKIT'];
    }
    if (activeTab === 'view') {
      return ['VIEW'];
    }
    if (activeTab === 'object') {
      return ['OBJECT'];
    }
    return [];
  }, [activeTab]);

  const getListOwnResource = useCallback(
    (params) => {
      const userType = get(record, 'positionUserType', '');
      const resourceBizTypeList = getResourceBizTypeList();
      dispatch({
        type: 'orgMgr/listResource',
        payload: {
          grantToObjId: userType ? record?.id : selectedPost,
          pageNum: pageInfo.pageNum,
          pageSize: pageInfo.pageSize,
          keyword: searchValue,
          grantToObjType: 'POST',
          authType: 2,
          resourceBizTypeList,
          ...params,
        },
        success: (res) => {
          const { data: resData } = res || {};
          const list = resData?.list || [];
          const pageNum = resData?.pageNum || resData?.pageNum || 1;
          const pageSize = resData?.pageSize || 10;
          const total = resData?.total !== null && resData?.total !== undefined ? resData.total : list.length;

          let dataSource = list;
          if (
            ((resData?.pageNum === null || resData?.pageNum === undefined) &&
              (resData?.pageNum === null || resData?.pageNum === undefined) &&
              (resData?.pageSize === null || resData?.pageSize === undefined)) ||
            list.length > pageSize
          ) {
            console.warn('[PostResource] server returned no pagination or too many list, apply client paginate', {
              totalRows: list.length,
              pageNum,
              pageSize,
            });
            dataSource = list.slice((pageNum - 1) * pageSize, pageNum * pageSize);
          }

          setData({ dataSource, total });
          setPageInfo({ pageNum, pageSize });
        },
      });
    },
    [record, selectedPost, pageInfo, searchValue, getResourceBizTypeList]
  );

  useEffect(() => {
    if (selectedPost) {
      getListOwnResource({ pageNum: 1, pageSize: 10 });
    }
  }, [selectedPost, activeTab, searchValue]);

  useImperativeHandle(ref, () => ({ getListOwnResource }), [getListOwnResource]);

  const columns = [
    ...buildResourceCommonColumns({
      intl,
      activeTab,
      ownerTypeMap,
      resourceStatus,
      showTypeColumn:
        activeTab === 'knowledge' || activeTab === 'tool' || activeTab === 'view' || activeTab === 'object',
      showAuthStatus: true,
      getIconSrc: (row, tab) => {
        if (row?.resourceLogoUrl) {
          return `/aiFactoryServer${row.resourceLogoUrl}`;
        }

        switch (tab) {
          case 'employee':
            return employeeIcon;
          case 'knowledge':
            return knowledgeIcon;
          default:
            return skillIcon;
        }
      },
    }),
    // {
    //   title: intl.formatMessage({ id: 'orgMgr.table.tags' }),
    //   dataIndex: 'tags',
    //   width: 200,
    //   render: (v) => {
    //     if (!v) return null;
    //     try {
    //       const tags = JSON.parse(v);
    //       const tagText = tags.join(', ');
    //       return (
    //         <div
    //           title={tagText}
    //           style={{
    //             overflow: 'hidden',
    //             textOverflow: 'ellipsis',
    //             whiteSpace: 'nowrap',
    //           }}
    //         >
    //           {tags.map((tag, index) => (
    //             <Tag key={index}>{tag}</Tag>
    //           ))}
    //         </div>
    //       );
    //     } catch (error) {
    //       return null;
    //     }
    //   },
    // },
    // {
    //   title: intl.formatMessage({ id: 'orgMgr.table.domain' }),
    //   dataIndex: 'catalogName',
    //   width: 90,
    // },
    // {
    //   title: intl.formatMessage({ id: 'orgMgr.table.organizationExtra' }),
    //   dataIndex: 'manOrgName',
    //   width: '110px',
    // },
    // {
    //   title: intl.formatMessage({ id: 'orgMgr.table.lastShelfTime' }),
    //   dataIndex: 'shelfTime',
    //   width: '110px',
    //   sorter: (a, b) => new Date(a.shelfTime) - new Date(b.shelfTime),
    // },
  ];

  const onChange = (_, newFilter) => {
    // const finalFilter = {
    //   ...newFilter,
    // };
    // setFilter(finalFilter);
    // filterRef.current = finalFilter;
    // trigger reload
    getListOwnResource({ pageNum: 1 });
  };

  return (
    <>
      <div className={styles.content}>
        <ResizeTable
          rowKey="resourceIdPostStr"
          columns={columns}
          loading={isLoading}
          dataSource={data?.dataSource || []}
          onChange={onChange}
        />
      </div>
      <div className={styles.footer}>
        <Layout
          right={
            <div style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
              <Pagination
                showQuickJumper
                showSizeChanger
                size="small"
                showTotal={(tot, range) =>
                  intl.formatMessage({ id: 'orgMgr.pagination.total' }, { start: range[0], end: range[1], total: tot })
                }
                current={pageInfo.pageNum}
                pageSize={pageInfo.pageSize}
                onChange={(current, pageSize) => {
                  getListOwnResource({ pageNum: current, pageSize });
                }}
                total={data.total}
                className={styles.pagination}
              />
            </div>
          }
        >
          <div />
        </Layout>
      </div>

      {/* 技能详情抽屉占位（参照 asset/skills） */}
      {SkillDetailDrawerHolder}
    </>
  );
};

export default forwardRef(PostResource);
