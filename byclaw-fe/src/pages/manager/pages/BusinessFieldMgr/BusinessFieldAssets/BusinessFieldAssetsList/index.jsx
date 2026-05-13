import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Pagination, Tag, message } from 'antd';
import { connect } from 'dva';
import { useIntl, history } from '@umijs/max';
import { debounce } from 'lodash';
import dayjs from 'dayjs';
import { getAvatarUrl } from '@/pages/manager/utils/agent';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import { resourceBizTypeMap } from '@/pages/manager/constants/digitalResource';
import styles from './index.module.less';

const BusinessFieldAssetsList = ({ selectedField, assetType, searchKeyword, dispatch }) => {
  const intl = useIntl();
  const [dataSource, setDataSource] = useState([]);
  const [loading, setLoading] = useState(false);
  const prevSearchKeywordRef = useRef(searchKeyword);

  const temp = useRef({}); // 保存当前的筛选和排序状态
  const [pageInfo, setPageInfo] = useState({
    pageIndex: 1,
    pageSize: 10,
    total: 0,
  });

  // 技能详情抽屉（复用 asset/skills 的详情能力）
  const { placeholder: SkillDetailDrawerHolder, show: showSkillDetailDrawer } = useSkillDetailDrawer();

  // 根据资产类型映射 resourceBizTypeList
  const getResourceBizTypeList = (type) => {
    const typeMap = {
      toolset: ['TOOLKIT', 'TOOL'], // 工具集
      digitalEmployee: ['DIG_EMPLOYEE'], // 数字员工
      businessOntology: [], // 业务本体（待确认）
      knowledge: ['KG_DOC', 'KG_QA', 'KG_TERM'], // 知识资产
      skill: ['AGENT'], // 技能资产
      MCP: ['MCP'], // MCP服务
      dataset: [], // 数据集（待确认）
      view: ['VIEW'], // 视图
      object: ['OBJECT'], // 对象
    };
    return typeMap[type] || [];
  };

  const getList = useCallback(
    (params = {}) => {
      // if (!selectedField?.fieldId && !selectedField?.catalogId) {
      //   setDataSource([]);
      //   setPageInfo(prev => ({ ...prev, total: 0 }));
      //   return;
      // }

      setLoading(true);

      const resourceBizTypeList = getResourceBizTypeList(assetType);

      // 从 temp.current 获取排序信息
      const sortFields = temp.current.sortFields || [];
      let shelfTime = null;
      let publishTime = null;

      if (sortFields.length > 0) {
        const sortField = sortFields[0];
        if (sortField.field === 'shelfTime') {
          shelfTime = sortField.order;
        } else if (sortField.field === 'publishTime') {
          publishTime = sortField.order;
        }
      }

      const payload = {
        catalogId: selectedField?.fieldId || selectedField?.catalogId,
        keyword: searchKeyword || '',
        resourceStatusList: params.resourceStatusList ?? [],
        resourceBizTypeList,
        shelfTime,
        publishTime,
        pageIndex: params.pageIndex ?? pageInfo.pageIndex,
        pageSize: params.pageSize ?? pageInfo.pageSize,
        ...params,
      };

      dispatch({
        type: 'businessFieldMgr/getFieldAssets',
        payload,
        success: (res) => {
          const { data } = res;
          // 根据实际接口返回的数据结构进行字段映射
          const mappedData = (data?.rows || []).map((item) => {
            const {
              resourceId,
              resourceName,
              resourceDesc,
              avatar,
              tags: tagsRaw,
              catalogName,
              resourceStatus,
              orgName,
              publishTime,
              shelfTime,
            } = item;

            // 解析 tags：可能是 JSON 字符串、数组或 null
            let tags = [];
            if (tagsRaw) {
              if (Array.isArray(tagsRaw)) {
                tags = tagsRaw;
              } else if (typeof tagsRaw === 'string') {
                try {
                  // 尝试解析 JSON 字符串
                  const parsed = JSON.parse(tagsRaw);
                  tags = Array.isArray(parsed) ? parsed : [parsed];
                } catch (e) {
                  // 如果不是 JSON 字符串，则作为单个标签
                  tags = [tagsRaw];
                }
              } else {
                tags = [tagsRaw];
              }
            }

            return {
              ...item,
              // 使用 resourceId 作为唯一标识
              id: resourceId,
              // 资源名称
              name: resourceName || '',
              // 资源描述
              description: resourceDesc || '',
              // 头像（可能为null）
              avatar: avatar || null,
              // 标签（已解析为数组）
              tags,
              // 所属领域名称
              domain: catalogName || '',
              // 资源状态
              status: resourceStatus,
              // 所属组织名称
              organization: orgName || '',
              // 发布时间
              releaseTime: publishTime || '',
              // 最近上架时间
              latestListTime: shelfTime || '',
            };
          });
          setDataSource(mappedData);
          setPageInfo((prev) => ({
            ...prev,
            pageIndex: payload.pageIndex || prev.pageIndex,
            pageSize: payload.pageSize || prev.pageSize,
            total: data?.total || 0,
          }));
          setLoading(false);
        },
        fail: (res) => {
          message.warning(res?.msg || intl.formatMessage({ id: 'businessField.assets.getListFail' }));
          setPageInfo((prev) => ({ ...prev, total: 0 }));
          setLoading(false);
        },
      });
    },
    [dispatch, pageInfo, searchKeyword, assetType, selectedField?.fieldId, selectedField?.catalogId, intl]
  );

  const onSearch = useCallback(
    (values = {}, filters, sorter) => {
      const params = { pageIndex: 1, ...values };

      // 处理状态筛选
      if (filters?.status) {
        params.resourceStatusList = filters.status;
      } else if (filters && !filters.status) {
        // 如果 filters 存在但没有 status，说明清除了筛选
        params.resourceStatusList = [];
      } else {
        // 如果没有 filters，使用之前保存的值
        params.resourceStatusList = temp.current.resourceStatusList ?? [];
      }

      // 处理排序
      if (sorter?.field && sorter.order) {
        const disc = {
          releaseTime: 'publishTime',
          latestListTime: 'shelfTime',
        };
        const field = disc[sorter.field] ?? sorter.field;
        params.sortFields = [
          {
            field,
            order: sorter.order === 'ascend' ? 'asc' : 'desc',
          },
        ];
      }

      if (!sorter) {
        params.sortFields = temp.current.sortFields ?? [];
      }

      temp.current = params;
      getList(params);
    },
    [getList]
  );

  // 当选中领域、资产类型变化时，获取数据
  useEffect(() => {
    if (selectedField?.fieldId >= 0) {
      getList();
    } else {
      setDataSource([]);
      setPageInfo((prev) => ({ ...prev, total: 0 }));
    }
  }, [selectedField?.fieldId, selectedField?.catalogId, assetType]);

  // 搜索防抖处理：搜索关键词变化时，重置分页到第1页
  useEffect(() => {
    if (!selectedField?.fieldId && !selectedField?.catalogId) {
      return;
    }

    // 如果搜索关键词变化了
    if (prevSearchKeywordRef.current !== searchKeyword) {
      prevSearchKeywordRef.current = searchKeyword;

      const debouncedFn = debounce(() => {
        onSearch({ pageIndex: 1 });
      }, 300);

      debouncedFn();
      return () => {
        debouncedFn.cancel();
      };
    }
  }, [searchKeyword]);

  // const handleDetail = useCallback(
  //   (record) => {
  //     if (!record) return;
  //     const { resourceBizType, resourceSourcePkId, resourceId, createType } = record;

  //     // 数字员工：跳转数字员工详情（只读）
  //     if (assetType === 'digitalEmployee') {
  //       if (!resourceId) return;
  //       sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
  //       history.push(
  //         `/resource/employeeDetail?digitalType=${createType || 'FROM_THIRD'}&appId=${resourceId}&readOnly=true`
  //       );
  //       return;
  //     }

  //     // 知识资产：跳转文档 / QA 知识详情
  //     if (assetType === 'knowledge') {
  //       const datasetId = resourceSourcePkId || resourceId;
  //       if (!datasetId) return;
  //       if (resourceBizType === resourceBizTypeMap.KG_DOC) {
  //         history.push(`/resource/agentDoc?datasetType=4&datasetId=${datasetId}`);
  //         return;
  //       }
  //       if (resourceBizType === resourceBizTypeMap.KG_QA) {
  //         history.push(`/resource/agentDoc?datasetType=2&datasetId=${datasetId}`);
  //         return;
  //       }
  //       message.info(intl.formatMessage({ id: 'businessField.assets.knowledgeDetailNotSupported' }));
  //       return;
  //     }

  //     // 技能 / 工具集 / MCP：打开技能详情抽屉
  //     if (assetType === 'skill') {
  //       if (!resourceId) return;
  //       const titleMap = {
  //         [resourceBizTypeMap.MCP]: intl.formatMessage({ id: 'common.mcpService' }),
  //         [resourceBizTypeMap.TOOL]: intl.formatMessage({ id: 'common.tool' }),
  //         [resourceBizTypeMap.TOOLKIT]: intl.formatMessage({ id: 'common.toolkit' }),
  //         [resourceBizTypeMap.AGENT]: intl.formatMessage({ id: 'common.agent' }),
  //       };
  //       const title = titleMap[resourceBizType] || intl.formatMessage({ id: 'common.detail' });
  //       showSkillDetailDrawer({ id: resourceId, title });
  //       return;
  //     }

  //     message.info(intl.formatMessage({ id: 'businessField.assets.detailNotSupported' }));
  //   },
  //   [assetType, history, intl, showSkillDetailDrawer]
  // );

  const columns = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.name' }),
        dataIndex: 'name',
        key: 'name',
        width: 150,
        render: (text, record) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {assetType === 'digitalEmployee' && (
              <img
                width={24}
                height={24}
                style={{ borderRadius: '24px' }}
                src={getAvatarUrl(record.avatar)}
                alt="logo"
              />
            )}
            <Ellipsis tooltip lines={1}>
              {text || '-'}
            </Ellipsis>
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.description' }),
        dataIndex: 'description',
        key: 'description',
        width: 200,
        render: (text) => (
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        ),
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.tags' }),
        dataIndex: 'tags',
        key: 'tags',
        width: 120,
        render: (tags) => {
          if (!tags || !Array.isArray(tags) || tags.length === 0) return '-';
          return (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Ellipsis tooltip lines={1}>
                {tags.slice(0, 2).map((tag, index) => (
                  <Tag key={tag || index} style={{ marginBottom: 4 }}>
                    {tag}
                  </Tag>
                ))}
                {tags.length > 2 && <Tag>+{tags.length - 2}</Tag>}
              </Ellipsis>
            </div>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.domain' }),
        dataIndex: 'domain',
        key: 'domain',
        width: 120,
        render: (text) => (
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        ),
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.status' }),
        dataIndex: 'status',
        key: 'status',
        width: 110,
        filters: [
          { text: intl.formatMessage({ id: 'resourceStatus.draft' }), value: 0 },
          // { text: '待上架', value: 1 },
          { text: intl.formatMessage({ id: 'resourceStatus.published' }), value: 2 },
          { text: intl.formatMessage({ id: 'resourceStatus.unpublished' }), value: 3 },
          { text: intl.formatMessage({ id: 'orgMgr.digital.reviewing' }), value: 4 },
          { text: intl.formatMessage({ id: 'resourceStatus.notPassed' }), value: 5 },
        ],
        render: (status) => {
          // 状态映射：0-草稿 1-待上架 2-已上架 3-已下架 4-审批中 5-审批不通过
          const statusMap = {
            0: { text: intl.formatMessage({ id: 'resourceStatus.draft' }), color: 'default' },
            1: { text: intl.formatMessage({ id: 'digitalResourceMgr.status.pending' }), color: 'orange' },
            2: { text: intl.formatMessage({ id: 'resourceStatus.published' }), color: 'green' },
            3: { text: intl.formatMessage({ id: 'resourceStatus.unpublished' }), color: 'default' },
            4: { text: intl.formatMessage({ id: 'orgMgr.digital.reviewing' }), color: 'orange' },
            5: { text: intl.formatMessage({ id: 'resourceStatus.notPassed' }), color: 'red' },
          };
          const statusInfo = statusMap[status] || {
            text:
              status !== null && status !== undefined
                ? `${intl.formatMessage({ id: 'businessField.assets.table.status' })}${status}`
                : '-',
            color: 'default',
          };
          const colorMap = {
            green: '#52c41a',
            orange: '#fa8c16',
            red: '#ff4d4f',
            default: '#d9d9d9',
          };
          return (
            <span>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: colorMap[statusInfo.color] || '#d9d9d9',
                  marginRight: 6,
                }}
              />
              {statusInfo.text}
            </span>
          );
        },
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.organization' }),
        dataIndex: 'organization',
        key: 'organization',
        width: 120,
        render: (text) => (
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        ),
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.releaseTime' }),
        dataIndex: 'releaseTime',
        key: 'releaseTime',
        width: 115,
        sorter: true,
        render: (text) => {
          if (!text) return '-';
          return dayjs(text).format('YYYY-MM-DD');
        },
      },
      {
        title: intl.formatMessage({ id: 'businessField.assets.table.latestListTime' }),
        dataIndex: 'latestListTime',
        key: 'latestListTime',
        width: 115,
        sorter: true,
        render: (text) => {
          if (!text) return '-';
          return dayjs(text).format('YYYY-MM-DD');
        },
      },
      // {
      //   title: intl.formatMessage({ id: 'businessField.assets.table.action' }),
      //   key: 'action',
      //   fixed: 'right',
      //   width: 100,
      //   render: (_, record) => (
      //     <a
      //       onClick={() => {
      //         handleDetail(record);
      //       }}
      //     >
      //       {intl.formatMessage({ id: 'businessField.assets.table.detail' })}
      //     </a>
      //   ),
      // },
    ],
    [assetType, intl]
  );

  return (
    <>
      <div className={styles.container}>
        <ResizeTable
          id="businessFieldAssetsList"
          rowKey="resourceId"
          columns={columns}
          loading={loading}
          onChange={onSearch}
          dataSource={dataSource}
          className={styles.tableWrap}
        />
      </div>
      <div className="text-align-right">
        <Pagination
          showQuickJumper
          showSizeChanger
          size="small"
          showTotal={(tot) => {
            const start = (pageInfo.pageIndex - 1) * pageInfo.pageSize + 1;
            const end = Math.min(pageInfo.pageIndex * pageInfo.pageSize, tot);
            return intl.formatMessage({ id: 'businessField.assets.pagination.total' }, { start, end, total: tot });
          }}
          current={pageInfo.pageIndex}
          pageSize={pageInfo.pageSize}
          onChange={(pageIndex, pageSize) => {
            onSearch({ pageIndex, pageSize });
          }}
          total={pageInfo.total}
          className={`${styles.pagination} mb-8`}
        />
      </div>
      {/* 技能详情抽屉占位 */}
      {SkillDetailDrawerHolder}
    </>
  );
};

export default connect()(BusinessFieldAssetsList);
