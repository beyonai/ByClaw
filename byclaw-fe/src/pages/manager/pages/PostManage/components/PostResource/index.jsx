import React, { forwardRef, useImperativeHandle, useState, useEffect, useCallback } from 'react';
import { Button, Pagination, Badge, Tag } from 'antd';
import { get } from 'lodash';
import { useDispatch, useSelector, useIntl, useNavigate } from '@umijs/max';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import { KeepAlive } from 'react-activation';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import styles from './index.module.less';
import skillIcon from '@/pages/manager/assets/defResourceIcon.png';
import employeeIcon from '@/pages/manager/assets/Avatar.png';
import knowledgeIcon from '@/pages/manager/assets/knowledge.png';
import { resourceBizTypeMap } from '@/pages/manager/constants/digitalResource';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';

const PostResource = (props, ref) => {
  const { selectedPost, searchValue, activeTab, record } = props;

  const dispatch = useDispatch();
  const intl = useIntl();
  const navigate = useNavigate();

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

  const getListOwnResource = useCallback(
    (params) => {
      const userType = get(record, 'positionUserType', '');
      dispatch({
        type: 'orgMgr/listResource',
        payload: {
          grantToObjId: userType ? record?.id : selectedPost,
          pageNum: pageInfo.pageNum,
          pageSize: pageInfo.pageSize,
          keyword: searchValue,
          grantToObjType: 'POST',
          authType: 2,
          resourceBizTypeList:
            activeTab === 'employee'
              ? ['DIG_EMPLOYEE']
              : activeTab === 'knowledge'
                ? ['KG_DOC', 'KG_QA', 'KG_TERM']
                : ['AGENT', 'MCP', 'TOOL', 'TOOLKIT'],
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
    [selectedPost, pageInfo, searchValue, activeTab]
  );

  useEffect(() => {
    if (selectedPost) {
      getListOwnResource({ pageNum: 1, pageSize: 10 });
    }
  }, [selectedPost, activeTab, searchValue]);

  useImperativeHandle(ref, () => ({ getListOwnResource }), [getListOwnResource]);

  const columns = [
    {
      title: intl.formatMessage({ id: 'form.name' }),
      dataIndex: 'resourceName',
      width: '200px',
      render: (v, record) => {
        let iconSrc = employeeIcon;

        if (record?.resourceLogoUrl) {
          iconSrc = `/aiFactoryServer${record.resourceLogoUrl}`;
        } else {
          // 根据activeTab显示不同的默认图标
          switch (activeTab) {
            case 'employee':
              iconSrc = employeeIcon;
              break;
            case 'knowledge':
              iconSrc = knowledgeIcon;
              break;
            case 'skill':
              iconSrc = skillIcon;
              break;
            default:
              iconSrc = employeeIcon;
          }
        }

        return (
          <div className={styles.userName}>
            <img src={iconSrc} style={{ width: 20, height: 20, marginRight: 4 }} alt="logo" />
            <Ellipsis tooltip lines={1}>
              {v}
            </Ellipsis>
          </div>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'form.desc' }),
      dataIndex: 'description',
      width: 150,
    },
    ...(activeTab === 'knowledge' || activeTab === 'skill'
      ? [
        {
          title: intl.formatMessage({ id: 'orgMgr.table.type' }),
          dataIndex: 'resourceBizType',
          width: 80,
        },
      ]
      : []),
    {
      title: intl.formatMessage({ id: 'orgMgr.table.tags' }),
      dataIndex: 'tags',
      width: 200,
      render: (v) => {
        if (!v) return null;
        try {
          const tags = JSON.parse(v);
          const tagText = tags.join(', ');
          return (
            <div
              title={tagText}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tags.map((tag, index) => (
                <Tag key={index}>{tag}</Tag>
              ))}
            </div>
          );
        } catch (error) {
          return null;
        }
      },
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.domain' }),
      dataIndex: 'catalogName',
      width: 90,
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.status' }),
      dataIndex: 'resourceStatus',
      width: 80,
      filters: [
        {
          text: intl.formatMessage({ id: 'orgMgr.digital.draft' }),
          value: 0,
        },
        {
          text: intl.formatMessage({ id: 'orgMgr.digital.reviewing' }),
          value: 1,
        },
        {
          text: intl.formatMessage({ id: 'orgMgr.digital.published' }),
          value: 2,
        },
        {
          text: intl.formatMessage({ id: 'orgMgr.digital.unpublished' }),
          value: 3,
        },
      ],
      onFilter: (value, record) => record.resourceStatus === value,
      render: (val) => (
        <div>
          {val === 0 && <Badge color="#7a8799" text={intl.formatMessage({ id: 'orgMgr.digital.draft' })} />}
          {val === 1 && <Badge color="#ff7d00" text={intl.formatMessage({ id: 'orgMgr.digital.reviewing' })} />}
          {val === 2 && <Badge color="#00b42a" text={intl.formatMessage({ id: 'orgMgr.digital.published' })} />}
          {val === 3 && <Badge color="#00000080" text={intl.formatMessage({ id: 'orgMgr.digital.unpublished' })} />}
        </div>
      ),
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.organizationExtra' }),
      dataIndex: 'manOrgName',
      width: '110px',
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.authStatus' }),
      dataIndex: 'hasPermission',
      width: 80,
      render: (val) => (
        <Badge
          color={val ? '#00b42a' : '#7a8799'}
          text={
            val
              ? intl.formatMessage({ id: 'orgMgr.table.hasPermission' })
              : intl.formatMessage({ id: 'orgMgr.table.noPermission' })
          }
        />
      ),
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.createTime' }),
      dataIndex: 'createTime',
      width: '110px',
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.lastShelfTime' }),
      dataIndex: 'shelfTime',
      width: '110px',
      sorter: (a, b) => new Date(a.shelfTime) - new Date(b.shelfTime),
    },
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
