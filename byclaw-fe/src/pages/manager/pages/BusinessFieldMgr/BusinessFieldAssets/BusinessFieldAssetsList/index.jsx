import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Pagination, message } from 'antd';
import { connect } from 'dva';
import { useIntl } from '@umijs/max';
import { debounce } from 'lodash';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import { ownerTypeMap, resourceStatus } from '@/pages/manager/constants/digitalResource';
import { buildResourceCommonColumns } from '@/pages/manager/utils/resourceColumns';
import defResourceIcon from '@/pages/manager/assets/defResourceIcon.png';
import employeeIcon from '@/pages/manager/assets/Avatar.png';
import knowledgeIcon from '@/pages/manager/assets/knowledge.png';
import { ALL_FIELD_KEY } from '../../components/BusinessFieldTree';
import styles from './index.module.less';

const BusinessFieldAssetsList = ({ selectedField, assetType, searchKeyword, dispatch }) => {
  const intl = useIntl();
  const [dataSource, setDataSource] = useState([]);
  const [loading, setLoading] = useState(false);
  const prevSearchKeywordRef = useRef(searchKeyword);

  const temp = useRef({}); // 保存当前的筛选和排序状态
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: 10,
    total: 0,
  });

  // 根据资产类型映射 resourceBizTypeList
  const getResourceBizTypeList = (type) => {
    const typeMap = {
      toolset: ['TOOLKIT', 'TOOL'], // 工具集
      employee: ['DIG_EMPLOYEE'], // 数字员工
      businessOntology: [], // 业务本体（待确认）
      knowledge: ['KG_DOC', 'KG_QA', 'KG_TERM'], // 知识资产
      tool: ['AGENT', 'MCP', 'TOOLKIT'], // 工具资产
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

      const getResourceLogoUrl = (item) => {
        const logoUrl = item.resourceLogoUrl || item.avatar || item.logoUrl || item.pluginUrl;
        return logoUrl;
      };

      const isAllCategory = selectedField?.fieldId === ALL_FIELD_KEY;
      const catalogId = selectedField?.fieldId ?? selectedField?.catalogId;

      const payload = {
        ...(isAllCategory ? {} : { catalogId }),
        keyword: searchKeyword || '',
        resourceStatusList: params.resourceStatusList ?? [],
        resourceBizTypeList,
        shelfTime,
        publishTime,
        pageNum: params.pageNum ?? pageInfo.pageNum,
        pageSize: params.pageSize ?? pageInfo.pageSize,
        ...params,
      };

      dispatch({
        type: 'businessFieldMgr/getFieldAssets',
        payload,
        success: (res) => {
          const { data } = res;
          // 根据实际接口返回的数据结构进行字段映射
          const mappedData = (data?.list || []).map((item) => {
            const {
              resourceId,
              resourceName,
              resourceDesc,
              avatar,
              resourceLogoUrl,
              logoUrl,
              pluginUrl,
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
              resourceLogoUrl: getResourceLogoUrl({ ...item, resourceLogoUrl, avatar, logoUrl, pluginUrl }),
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
            pageNum: payload.pageNum || prev.pageNum,
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
      const params = { pageNum: 1, ...values };

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
    if (selectedField?.fieldId === ALL_FIELD_KEY || selectedField?.fieldId >= 0) {
      getList({ pageNum: 1 });
    } else {
      setDataSource([]);
      setPageInfo((prev) => ({ ...prev, total: 0 }));
    }
  }, [selectedField?.fieldId, selectedField?.catalogId, assetType]);

  // 搜索防抖处理：搜索关键词变化时，重置分页到第1页
  useEffect(() => {
    if (selectedField?.fieldId === undefined && selectedField?.catalogId === undefined) {
      return;
    }

    // 如果搜索关键词变化了
    if (prevSearchKeywordRef.current !== searchKeyword) {
      prevSearchKeywordRef.current = searchKeyword;

      const debouncedFn = debounce(() => {
        onSearch({ pageNum: 1 });
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
    () =>
      buildResourceCommonColumns({
        intl,
        activeTab: assetType,
        ownerTypeMap,
        resourceStatus,
        getIconSrc: (record, tab) => {
          if (record?.resourceLogoUrl) {
            const logoUrl = `${record.resourceLogoUrl}`;
            return logoUrl.startsWith('/') ? `/aiFactoryServer${logoUrl}` : logoUrl;
          }

          switch (tab) {
            case 'employee':
              return employeeIcon;
            case 'knowledge':
              return knowledgeIcon;
            default:
              return defResourceIcon;
          }
        },
      }),
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
            const start = (pageInfo.pageNum - 1) * pageInfo.pageSize + 1;
            const end = Math.min(pageInfo.pageNum * pageInfo.pageSize, tot);
            return intl.formatMessage({ id: 'businessField.assets.pagination.total' }, { start, end, total: tot });
          }}
          current={pageInfo.pageNum}
          pageSize={pageInfo.pageSize}
          onChange={(pageNum, pageSize) => {
            onSearch({ pageNum, pageSize });
          }}
          total={pageInfo.total}
          className={`${styles.pagination} mb-8`}
        />
      </div>
    </>
  );
};

export default connect()(BusinessFieldAssetsList);
