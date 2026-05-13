import React, { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useContext } from 'react';
import dayjs from 'dayjs';
import { debounce } from 'lodash';
import { Pagination, Badge } from 'antd';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import styles from './index.module.less';
import skillIcon from '@/pages/manager/assets/defResourceIcon.png';
import employeeIcon from '@/pages/manager/assets/Avatar.png';
import knowledgeIcon from '@/pages/manager/assets/knowledge.png';
import { resourceStatus } from '@/pages/manager/constants/digitalResource';
import { OrgMgrContext } from '@/pages/manager/pages/OrgMgr';

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

  const isLoading = useSelector(
    ({ loading }) => loading.effects['orgMgr/listResource'] || loading.effects['employeeMgr/selectDigitalEmployeeByQo']
  );

  const [data, setData] = useState({
    dataSource: [],
    total: 0,
  });
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: 10,
  });

  const getEmployeeListType = useCallback(() => {
    if (selectValue === 1) return 'manager';
    if (selectValue === 2) return 'authorize';
    return '';
  }, [selectValue]);

  const getListOwnResource = useCallback(
    debounce((params) => {
      if (activeTab === 'employee') {
        dispatch({
          type: 'employeeMgr/selectDigitalEmployeeByQo',
          payload: {
            orgId: grantToObjId,
            pageNum: params?.pageNum || params?.pageNum || pageInfo.pageNum,
            pageSize: params?.pageSize || pageInfo.pageSize,
            keyword: searchValue,
            type: getEmployeeListType(),
            systemCodes: sourceValue,
            catalogIds: fieldValue?.map((item) => Number(item)).filter((item) => !Number.isNaN(item)),
          },
          success: (resData) => {
            const list = Array.isArray(resData?.list) ? resData.list : Array.isArray(resData?.list) ? resData.list : [];
            const pageNum = resData?.pageNum || params?.pageNum || params?.pageNum || 1;
            const pageSize = resData?.pageSize || params?.pageSize || 10;
            const total = resData?.total !== null && resData?.total !== undefined ? resData.total : list.length;

            setData({ dataSource: list.map(normalizeRow), total });
            setPageInfo({ pageNum, pageSize });
          },
        });
        return;
      }

      let grantResourceTypeList = ['AGENT', 'MCP', 'TOOL', 'TOOLKIT'];
      if (activeTab === 'knowledge') {
        grantResourceTypeList = ['KG_DOC', 'KG_QA', 'KG_TERM'];
      }

      dispatch({
        type: 'orgMgr/listResource',
        payload: {
          grantToObjId: grantToObjId ? `${grantToObjId}` : undefined,
          pageNum: pageInfo.pageNum,
          pageSize: pageInfo.pageSize,
          keyword: searchValue,
          grantToObjType: 'ORG',
          authType: selectValue,
          grantResourceTypeList,
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
    [grantToObjId, pageInfo, searchValue, selectValue, activeTab, fieldValue, sourceValue, getEmployeeListType]
  );

  useEffect(() => {
    if (selectedOrg?.orgId) {
      getListOwnResource({ pageNum: 1, pageSize: 10 });
    }
  }, [selectedOrg, activeTab, selectValue, fieldValue, sourceValue]);

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
          dataIndex: 'resourceType',
          width: 80,
        },
      ]
      : []),
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.status' }),
      dataIndex: 'resourceStatus',
      width: 80,
      // filters: [
      //   {
      //     text: intl.formatMessage({ id: 'orgMgr.digital.draft' }),
      //     value: 0,
      //   },
      //   {
      //     text: intl.formatMessage({ id: 'orgMgr.digital.reviewing' }),
      //     value: 1,
      //   },
      //   {
      //     text: intl.formatMessage({ id: 'orgMgr.digital.published' }),
      //     value: 2,
      //   },
      //   {
      //     text: intl.formatMessage({ id: 'orgMgr.digital.unpublished' }),
      //     value: 3,
      //   },
      // ],
      // onFilter: (value, record) => record.resourceStatus === value,
      render: (text) => {
        const statusItem = resourceStatus.find((ele) => {
          return ele.value === text;
        });
        if (!statusItem) return null;
        return <Badge color={statusItem.color} text={statusItem.text} />;
      },
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.organizationExtra' }),
      dataIndex: 'manOrgName',
      width: '110px',
      // filterDropdown: (FilterDropdownProps) => {
      //   const { setSelectedKeys, selectedKeys, confirm, clearFilters, onclose } = FilterDropdownProps;
      //   console.log(FilterDropdownProps)
      //   return (
      //     <div style={{ padding: 12, height: 300 }} className="ub ub-ver">
      //       <div className="ub-f1" style={{ overflow: 'auto', marginBottom: 12 }}>
      //         <Tree
      //           treeData={flatOrgTree}
      //           onCheck={(e) => {
      //             console.log(e)
      //           }}
      //           fieldNames={{
      //             title: 'orgName',
      //             key: 'orgId',
      //             children: 'children',
      //           }}
      //           selectable={false}
      //           defaultExpandAll
      //           blockNode
      //           checkable
      //           // selectedKeys={selectedOrg?.orgId ? [selectedOrg.orgId] : []}
      //         />
      //       </div>
      //       <div className="ub ub-ac ub-pe gap8">
      //         <Button onClick={() => {
      //           clearFilters();
      //         }}>
      //           {intl.formatMessage({ id: 'common.clear' })}
      //         </Button>
      //         <Button
      //           type="primary"
      //           onClick={() => {
      //           confirm();
      //         }}>
      //           {intl.formatMessage({ id: 'common.confirm' })}
      //         </Button>
      //       </div>
      //     </div>
      //   )
      // },
      // onFilter: (value, record) => record.resourceStatus === value,
    },
    ...(selectValue === 2
      ? [
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
      ]
      : []),
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.createTime' }),
      dataIndex: 'createTime',
      width: '110px',
      render: (text) => (text ? dayjs(Number(text) || text).format('YYYY-MM-DD HH:mm:ss') : '-'),
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
