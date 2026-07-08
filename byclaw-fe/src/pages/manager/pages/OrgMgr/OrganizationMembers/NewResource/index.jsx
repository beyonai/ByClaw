import React, { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useContext } from 'react';
import { debounce } from 'lodash';
import { Pagination, Button } from 'antd';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import styles from './index.module.less';
import toolIcon from '@/pages/manager/assets/defResourceIcon.png';
import employeeIcon from '@/pages/manager/assets/Avatar.png';
import knowledgeIcon from '@/pages/manager/assets/knowledge.png';
import { ownerTypeMap, resourceStatus } from '@/pages/manager/constants/digitalResource';
import { OrgMgrContext } from '@/pages/manager/pages/OrgMgr';
import { buildResourceCommonColumns } from '@/pages/manager/utils/resourceColumns';

const getRowKey = (record) =>
  record?.resourceIdNewStr || record?.resourceIdStr || record?.resourceId || record?.objId || record?.id;

const normalizeRow = (item = {}) => ({
  ...item,
  id: item.id || item.resourceId || item.objId,
  resourceId: item.resourceId || item.id || item.objId,
  resourceIdStr:
    item.resourceIdStr ||
    (item.resourceId !== null && item.resourceId !== undefined ? `${item.resourceId}` : undefined),
  resourceIdNewStr:
    item.resourceIdNewStr ||
    item.resourceIdStr ||
    (item.resourceId !== null && item.resourceId !== undefined ? `${item.resourceId}` : undefined),
  resourceName: item.resourceName || item.name || item.itemName || '-',
  description:
    item.description || item.resourceDesc || item.resource_desc || item.intro || item.desc || item.pluginDesc || '',
  resourceLogoUrl: item.resourceLogoUrl || item.avatar || item.logoUrl || item.pluginUrl || '',
  resourceType: item.resourceType || item.resourceBizType || item.grantResourceType || '',
  resourceStatus: item.resourceStatus ?? item.status,
  tags: item.tags || item.tagList,
  catalogName: item.catalogName || item.catalog_name,
  createTime: item.createTime || item.create_time || item.publishTime,
  shelfTime: item.shelfTime || item.shelf_time || item.publishTime,
});

const NewResource = (props, ref) => {
  const { searchValue, setAuthType, setAuthInfo, canEdit, selectValue, fieldValue, sourceValue, activeTab } = props;

  const dispatch = useDispatch();
  const intl = useIntl();

  const { selectedOrg } = useContext(OrgMgrContext);
  const grantToObjId = selectedOrg?.orgId;

  const isLoading = useSelector(({ loading }) => loading.effects['orgMgr/listResource']);

  const [data, setData] = useState({
    dataSource: [],
    total: 0,
  });
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: 10,
  });

  const getListOwnResource = useCallback(
    debounce((params) => {
      let resourceBizTypeList = [];
      if (activeTab === 'employee') {
        resourceBizTypeList = ['DIG_EMPLOYEE'];
      } else if (activeTab === 'knowledge') {
        resourceBizTypeList = ['KG_DOC', 'KG_QA', 'KG_TERM'];
      } else if (activeTab === 'tool') {
        resourceBizTypeList = ['AGENT', 'MCP', 'TOOLKIT'];
      } else if (activeTab === 'view') {
        resourceBizTypeList = ['VIEW'];
      } else if (activeTab === 'object') {
        resourceBizTypeList = ['OBJECT'];
      }

      dispatch({
        type: 'orgMgr/listResource',
        payload: {
          grantToObjId: grantToObjId ? `${grantToObjId}` : undefined,
          orgId: grantToObjId,
          pageNum: pageInfo.pageNum,
          pageSize: pageInfo.pageSize,
          keyword: searchValue,
          grantToObjType: 'ORG',
          authType: selectValue,
          grantResourceTypeList: resourceBizTypeList,
          systemCodes: sourceValue,
          catalogIds: fieldValue,
          ...params,
        },
        success: (res) => {
          const { data: resData } = res || {};
          const list = Array.isArray(resData) ? resData : resData?.list || resData?.list || [];
          const pageNum = resData?.pageNum || resData?.pageNum || params?.pageNum || 1;
          const pageSize = resData?.pageSize || params?.pageSize || 10;
          const total = resData?.total !== null && resData?.total !== undefined ? resData.total : list.length;
          const normalizedRows = list.map(normalizeRow);

          let dataSource = normalizedRows;
          if (
            ((resData?.pageNum === null || resData?.pageNum === undefined) &&
              (resData?.pageNum === null || resData?.pageNum === undefined) &&
              (resData?.pageSize === null || resData?.pageSize === undefined)) ||
            normalizedRows.length > pageSize
          ) {
            dataSource = normalizedRows.slice((pageNum - 1) * pageSize, pageNum * pageSize);
          }

          setData({ dataSource, total });
          setPageInfo({ pageNum, pageSize });
        },
      });
    }, 300),
    [dispatch, grantToObjId, pageInfo, searchValue, selectValue, activeTab, fieldValue, sourceValue]
  );

  useEffect(() => {
    if (selectedOrg?.orgId) {
      getListOwnResource({ pageNum: 1, pageSize: 10 });
    }
  }, [selectedOrg, activeTab, selectValue, fieldValue, sourceValue]);

  useImperativeHandle(ref, () => ({ getListOwnResource }), [getListOwnResource]);

  const columns = [
    ...buildResourceCommonColumns({
      intl,
      activeTab,
      ownerTypeMap,
      resourceStatus,
      showAuthStatus: selectValue === 2,
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
            return toolIcon;
        }
      },
    }),
    ...(canEdit && selectValue === 1
      ? [
        {
          title: intl.formatMessage({ id: 'common.operation' }),
          dataIndex: 'action',
          fixed: 'right',
          width: '160px',
          render: (_, record) => (
            <div>
              {selectValue === 1 ? (
                <>
                  <Button
                    type="link"
                    onClick={() => {
                      setAuthInfo(record);
                      setAuthType('mgrAuth');
                    }}
                    size="small"
                  >
                    {intl.formatMessage({ id: 'resourceAction.manageAuth' })}
                  </Button>
                  <Button
                    type="link"
                    onClick={() => {
                      setAuthInfo(record);
                      setAuthType('useAuth');
                    }}
                    size="small"
                  >
                    {intl.formatMessage({ id: 'resourceAction.useAuth' })}
                  </Button>
                </>
              ) : null}
            </div>
          ),
        },
      ]
      : []),
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
          rowKey={getRowKey}
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
    </>
  );
};

export default forwardRef(NewResource);
