/* eslint-disable max-len,@typescript-eslint/no-non-null-assertion */
import React, { useMemo, useCallback, useState, useEffect } from 'react';
import classNames from 'classnames';
import dayjs from 'dayjs';
import {
  Button,
  Collapse,
  Drawer,
  DrawerProps,
  Empty,
  Input,
  Segmented,
  Spin,
  Table,
  Tabs,
  Typography,
  message,
} from 'antd';
import { createPortal } from 'react-dom';
import { CloseOutlined, LinkOutlined } from '@ant-design/icons';
import { compact } from 'lodash';
import Image from '@/components/Image';
import {
  generateResourceCurl,
  queryResourceDetail,
  queryResourceMembers,
  runResourceCurl,
  queryMCPToolsList,
  querySkillUsedDigitalEmployees,
} from '@/pages/manager/service/resources';
import { copyWithMessage } from '@/utils/copy';
import {
  RenderItem,
  getMCPToolsRenderConfig,
  getSchemaRenderConfig,
  isByclawCodeAgentResource,
} from './SkillDetailDrawer.utils';
import styles from './SkillDetailDrawer.module.less';
import { resourceBizTypeMap } from '@/constants/knowledge';
import { useIntl, getIntl } from '@umijs/max';
import { getRuntimeActualUrl } from '@/utils';
import useAppStore from '@/models/common/useAppStore';
import { getssoToken } from '@/utils/auth';
import MCPTestPanel from './components/MCPTestPanel';

const { Paragraph } = Typography;
const SKILL_BIZ_TYPE = 'SKILL';

interface SkillDetailDrawerProps extends DrawerProps {
  resourceId?: string;
  panel?: boolean;
}

export type ISkillDetail = {
  name?: string;
  avatar?: string;
  description?: string;
  version?: string;
  manager?: string;
  organization?: string;
  createUserName?: string;
  items?: RenderItem[];
  loading?: boolean;
  devConfig?: any;
  resourceStatus?: number;
  resourceBizType?: string;
  systemCode?: string;
  resourceId?: string;
  resourceCode?: string;
  resourceSourcePkId?: string;
  extInfo?: any;
};

interface SkillUsedDigitalEmployee {
  resourceId?: string | number;
  resourceName?: string;
  useStartTime?: string | number;
}

interface ResourceMemberItem {
  grantToObjName?: string;
  grantToObjId?: string | number;
}

// 获取与列表一致的资源图标地址
const getResourceIconUrl = (data?: any) => {
  const { avatar, resourceLogoUrl } = data || {};
  const val = avatar || resourceLogoUrl;
  if (!val) return '';
  const url = String(val);
  return url.startsWith('http') ? url : `/byaiService${url}`;
};

// 表格组件，支持树形结构展开
interface SchemaTableProps {
  columns: any[];
  dataSource: any[];
  size?: 'small' | 'middle' | 'large';
}

const getTitleByBizType = (bizType?: string) => {
  const intl = getIntl();
  if (bizType === resourceBizTypeMap.MCP) return intl.formatMessage({ id: 'common.mcpService' });
  if (bizType === resourceBizTypeMap.TOOL) return intl.formatMessage({ id: 'common.tool' });
  if (bizType === resourceBizTypeMap.TOOLKIT) return intl.formatMessage({ id: 'common.toolkit' });
  if (bizType === resourceBizTypeMap.AGENT) return intl.formatMessage({ id: 'common.agent' });
  return intl.formatMessage({ id: 'common.detail' });
};

// 获取状态文本
const getStatusText = (status?: number) => {
  const intl = getIntl();
  if (status === 2) return intl.formatMessage({ id: 'resourceStatus.published' });
  if (status === 3) return intl.formatMessage({ id: 'resourceStatus.unpublished' });
  if (status === 0) return intl.formatMessage({ id: 'resourceStatus.draft' });
  if (status === 1 || status === 4) return intl.formatMessage({ id: 'resourceStatus.reviewing' });
  if (status === 5) return intl.formatMessage({ id: 'resourceStatus.notPassed' });
  return '';
};

const getArrayData = (response: any): any[] => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const formatDateTime = (value?: string | number) => {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : String(value);
};

const formatMemberNames = (members?: ResourceMemberItem[], fallback?: string) => {
  const names = (Array.isArray(members) ? members : [])
    .map((item) => item?.grantToObjName || item?.grantToObjId)
    .filter(Boolean);
  if (names.length) {
    return names.join('、');
  }
  return fallback || '-';
};

const buildSkillUsedDigitalEmployeeItem = (employees: SkillUsedDigitalEmployee[]): RenderItem => {
  const intl = getIntl();
  return {
    type: 'table',
    label: intl.formatMessage({ id: 'skillDetail.usedDigitalEmployees' }),
    columns: [
      {
        dataIndex: 'resourceName',
        title: intl.formatMessage({ id: 'skillDetail.digitalEmployeeName' }),
        render: (text: React.ReactNode) => text || '-',
      },
      {
        dataIndex: 'useStartTime',
        title: intl.formatMessage({ id: 'skillDetail.useStartTime' }),
        width: 180,
        render: (text: string | number) => formatDateTime(text),
      },
    ],
    dataSource: employees.map((item, index) => ({
      ...item,
      key: item.resourceId ?? index,
    })),
  };
};

const buildSkillDetailItems = (resp: any, memberResp: any, usedEmployees: SkillUsedDigitalEmployee[]) => {
  const intl = getIntl();
  const schemaItems = getSchemaRenderConfig(resp).filter((item) => item.type !== 'empty');
  const baseItems: RenderItem[] = [
    {
      type: 'text',
      label: intl.formatMessage({ id: 'skillDetail.manager' }),
      children: formatMemberNames(memberResp?.managerList, resp?.manUserName),
    },
    {
      type: 'text',
      label: intl.formatMessage({ id: 'skillDetail.userPerson' }),
      children: formatMemberNames(memberResp?.useList),
    },
    buildSkillUsedDigitalEmployeeItem(usedEmployees),
  ];

  return [...baseItems, ...schemaItems];
};

const SchemaTable: React.FC<SchemaTableProps> = ({ columns, dataSource, size = 'small' }) => {
  // 检查数据源是否有树形结构
  const hasTreeStructure = dataSource?.some((record: any) => record.children?.length > 0);

  // 计算所有节点的 key，用于默认展开
  const defaultExpandedRowKeys = useMemo(() => {
    if (!hasTreeStructure) return [];
    const keys: React.Key[] = [];
    const collect = (nodes: any[]) => {
      nodes.forEach((node) => {
        keys.push(node.key);
        if (node.children?.length) {
          collect(node.children);
        }
      });
    };
    collect(dataSource || []);
    return keys;
  }, [dataSource, hasTreeStructure]);

  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>(defaultExpandedRowKeys);

  useEffect(() => {
    // 数据源变化时，默认展开全部
    setExpandedRowKeys(defaultExpandedRowKeys);
  }, [defaultExpandedRowKeys]);

  let expandableConfig;
  if (hasTreeStructure) {
    expandableConfig = {
      expandedRowKeys,
      onExpandedRowsChange: (keys: React.Key[]) => setExpandedRowKeys([...keys]),
    };
  }

  return (
    <Table
      rootClassName={styles.schemaTable}
      size={size}
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      rowKey="key"
      tableLayout="fixed"
      expandable={expandableConfig}
    />
  );
};

const ItemRenderer = (props: { item: RenderItem; index: number }) => {
  const { item, index } = props;
  const intl = getIntl();
  const { devConfig } = useAppStore();

  const [portalComp, setPortalComp] = useState<React.ReactNode | null>(null);

  const onToolDetail = useCallback((record: RenderItem) => {
    // 只处理列表里是工具、MCP、工具包、智能体的场景，其他保持默认
    setPortalComp(
      createPortal(
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        <SkillDetailDrawer resourceId={record?.resourceId} open onClose={() => setPortalComp(null)} />,
        document.body,
        'employees-drawer'
      )
    );
  }, []);

  const buttonOnClick = (item: RenderItem) => {
    const originalUrl = item.url || '';
    if (!devConfig?.agentDetailUrl) {
      return;
    }

    const uri = devConfig?.agentDetailUrl.split('?')[0];
    let params = '';
    // 获取第一个问号后面的值
    const firstIndex = originalUrl?.indexOf('?');
    if (firstIndex !== -1) {
      params = originalUrl?.substring(firstIndex + 1);
    }
    const botUrl = `${uri}?${params}&systemCode=BYAI&sso-token=${getssoToken() || ''}`;
    console.log('打开url地址：', botUrl);
    window.open(botUrl);
  };

  const getRenderItem = () => {
    const renderItemLabel = () => (
      <div className={styles.itemLabel}>
        {item.label && <span className={styles.itemLabelBar} />}
        {item.label}
      </div>
    );

    if (item.type === 'text') {
      return (
        <section className={styles.detailItem} key={index}>
          {renderItemLabel()}
          <div className={styles.itemText}>{item.children}</div>
        </section>
      );
    }

    if (item.type === 'tags') {
      return (
        <section className={styles.detailItem} key={index}>
          {renderItemLabel()}
          <div className={styles.itemTags}>
            {item.children.map((child, i) => (
              <span className={styles.itemTag} key={i}>
                {child}
              </span>
            ))}
          </div>
        </section>
      );
    }

    if (item.type === 'table') {
      let columns = item.columns;
      if ((item as any).tableType === 'tools') {
        columns = [
          {
            dataIndex: 'name',
            title: intl.formatMessage({ id: 'skillDetail.toolName' }),
            render: (text: React.ReactNode) => <Paragraph ellipsis={{ rows: 1 }}>{text}</Paragraph>,
          },
          {
            dataIndex: 'description',
            title: intl.formatMessage({ id: 'skillDetail.toolDescription' }),
            render: (text: React.ReactNode) => <Paragraph ellipsis={{ rows: 1 }}>{text}</Paragraph>,
          },
          {
            dataIndex: 'statusText',
            title: intl.formatMessage({ id: 'common.status' }),
            width: 90,
            render: (text: React.ReactNode) => text ?? '-',
          },
          {
            title: intl.formatMessage({ id: 'common.operation' }),
            width: 90,
            render: (_: any, record: any) => (
              <a
                onClick={() => {
                  onToolDetail?.(record);
                }}
              >
                {intl.formatMessage({ id: 'common.detail' })}
              </a>
            ),
          },
        ];
      }

      return (
        <section className={classNames(styles.detailItem, styles.detailItemWide)} key={index}>
          {renderItemLabel()}
          <div className={styles.itemTable}>
            <SchemaTable columns={columns} dataSource={item.dataSource} size="small" />
          </div>
        </section>
      );
    }

    if (item.type === 'tab1') {
      return (
        <section className={classNames(styles.detailItem, styles.detailItemWide)} key={index}>
          {renderItemLabel()}
          <div className={styles.itemTabs1}>
            <Collapse ghost collapsible="icon" defaultActiveKey={['1']}>
              {item.children.map((child, i) => (
                <Collapse.Panel header={child.label} key={i}>
                  <span className={styles.itemTabs1Title}>{child.subLabel}</span>
                  <div className={styles.itemTabs1Content}>
                    <div className={styles.itemTabs1ContentList}>
                      <div className={styles.itemTabs1ContentItem}>
                        <div className={styles.itemTabs1ContentItemLabel}>
                          <span>key</span>
                          <span>value</span>
                        </div>
                        <div className={styles.itemTabs1ContentItemValue}>12</div>
                      </div>
                    </div>
                  </div>
                </Collapse.Panel>
              ))}
            </Collapse>
          </div>
        </section>
      );
    }

    if (item.type === 'tab2') {
      return (
        <section className={classNames(styles.detailItem, styles.detailItemWide)} key={index}>
          {renderItemLabel()}
          <div className={styles.itemTabs2}>
            <Segmented options={item.children.map((child) => child.label)} />
            <div className={styles.itemTabs2Content}>123</div>
          </div>
        </section>
      );
    }

    if (item.type === 'button') {
      return (
        <section className={classNames(styles.detailItem, styles.detailItemAction)} key={index}>
          <div className={styles.itemButton} onClick={() => buttonOnClick(item)}>
            {item.children}
            <LinkOutlined className={styles.itemButtonIcon} />
          </div>
        </section>
      );
    }

    if (item.type === 'empty') {
      return (
        <section className={classNames(styles.detailItem, styles.detailItemWide)} key={index}>
          <div className={styles.itemEmpty}>
            <Empty description={intl.formatMessage({ id: 'common.noData' })} />
          </div>
        </section>
      );
    }

    return null;
  };

  return (
    <>
      {getRenderItem()}
      {portalComp}
    </>
  );
};

const RenderDetailPanel = (props: { skillDetail: ISkillDetail }) => {
  const { skillDetail } = props;
  const headerMeta = compact([skillDetail?.resourceBizType, skillDetail?.systemCode, skillDetail?.version]);

  return (
    <div className="ub ub-ver full-height">
      <div className={styles.header}>
        <span className={styles.headerAura} />
        <figure className={styles.avatar}>
          <Image
            src={skillDetail?.avatar || undefined}
            defaultSrc={getRuntimeActualUrl('/favicon.svg')}
            width={48}
            height={48}
          />
        </figure>
        <div className={styles.headerContent}>
          <div className={styles.headerTitleRow}>
            <h1 className={styles.title}>{skillDetail?.name}</h1>
            {skillDetail?.resourceStatus !== undefined && getStatusText(skillDetail?.resourceStatus) && (
              <span className={styles.status}>{getStatusText(skillDetail?.resourceStatus)}</span>
            )}
          </div>
          {skillDetail?.description && <p className={styles.description}>{skillDetail?.description}</p>}
          {!!headerMeta.length && (
            <div className={styles.headerMeta}>
              {headerMeta.map((item) => (
                <span className={styles.metaItem} key={item}>
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={classNames(styles.content, 'ub-f1 overflow-auto')}>
        {skillDetail?.items?.map((item, index) => (
          <ItemRenderer key={index} item={item} index={index} />
        ))}
      </div>
    </div>
  );
};

export default function SkillDetailDrawer(props: SkillDetailDrawerProps) {
  const { open, loading = false, onClose, resourceId, title = '', panel = false, ...restProps } = props;

  const intl = useIntl();

  const [record, setRecord] = useState<RenderItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [skillDetail, setSkillDetail] = useState<ISkillDetail>({});
  const [activeDebugTab, setActiveDebugTab] = useState('detail');
  const [curlScript, setCurlScript] = useState('');
  const [curlResult, setCurlResult] = useState('');
  const [curlGenerating, setCurlGenerating] = useState(false);
  const [curlRunning, setCurlRunning] = useState(false);
  const showToolDebugTabs = [
    resourceBizTypeMap.TOOL,
    resourceBizTypeMap.TOOLKIT,
    resourceBizTypeMap.MCP,
    resourceBizTypeMap.AGENT,
  ].includes(skillDetail?.resourceBizType || '');
  const disableTestTab = isByclawCodeAgentResource(skillDetail);
  const showTestTab = showToolDebugTabs && !disableTestTab;
  const sourceContent = skillDetail?.extInfo?.sourceContent || '';
  const targetContent = skillDetail?.extInfo?.targetContent || '';
  const copyDebugContent = (content: string) =>
    copyWithMessage(
      content,
      intl.formatMessage({ id: 'common.copySuccess' }),
      intl.formatMessage({ id: 'common.copyFail' })
    );

  const setMCPTestItem = (record: RenderItem) => {
    setRecord(record);
    setActiveDebugTab('test');
  };

  const myQueryMCPToolsList = useCallback((resourceId: string) => {
    setIsLoading(true);
    queryMCPToolsList({ resourceId })
      .then((resp) => {
        const items = getMCPToolsRenderConfig(resp, resourceId, setMCPTestItem);
        setSkillDetail((v) => ({
          ...v,
          items,
        }));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const myQueryResourceDetail = useCallback(async (resourceId: string): Promise<ISkillDetail | void> => {
    setIsLoading(true);
    try {
      const [resp, memberResp] = await Promise.all([
        queryResourceDetail({ resourceId }),
        queryResourceMembers({ resourceId }).catch(() => null),
      ]);
      if (resp) {
        const usedEmployees =
          resp?.resourceBizType === SKILL_BIZ_TYPE
            ? getArrayData(await querySkillUsedDigitalEmployees({ resourceId }).catch(() => []))
            : [];
        const items: RenderItem[] =
          resp?.resourceBizType === SKILL_BIZ_TYPE
            ? buildSkillDetailItems(resp, memberResp, usedEmployees)
            : getSchemaRenderConfig(resp);
        // 根据不同参数渲染
        const item = {
          items,
          avatar: getResourceIconUrl(resp),
          name: resp?.resourceName,
          description: resp?.resourceDesc,
          manager: resp?.manUserName,
          version: resp?.resresourceDVerid,
          organization: resp?.manOrgName,
          createUserName: resp?.createUserName,
          resourceStatus: resp?.resourceStatus,
          resourceBizType: resp?.resourceBizType,
          systemCode: resp?.systemCode || resp?.param?.systemCode,
          resourceId: resp?.resourceId,
          resourceCode: resp?.resourceCode,
          extInfo: memberResp?.extInfo || resp?.extInfo,
        };

        setSkillDetail((v) => ({ ...v, ...item }));

        return item;
      }

      return undefined;
    } catch (e) {
      message.error(e);
      return undefined;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!resourceId || !open) {
      return;
    }

    myQueryResourceDetail(resourceId).then((res) => {
      if (res?.resourceBizType === resourceBizTypeMap.MCP) {
        myQueryMCPToolsList(resourceId);
      }
    });
  }, [resourceId, open]);

  useEffect(() => {
    if (!open || resourceId) {
      setActiveDebugTab('detail');
      setCurlScript('');
      setCurlResult('');
    }
  }, [open, resourceId]);

  useEffect(() => {
    if (activeDebugTab === 'test' && !showTestTab) {
      setActiveDebugTab('detail');
    }
  }, [activeDebugTab, showTestTab]);

  useEffect(() => {
    const generateCurlScript = async () => {
      if (
        !open ||
        !resourceId ||
        !showTestTab ||
        activeDebugTab !== 'test' ||
        curlScript ||
        skillDetail?.resourceBizType === resourceBizTypeMap.MCP
      ) {
        return;
      }
      setCurlGenerating(true);
      try {
        const data = await generateResourceCurl({ resourceId });
        setCurlScript(data?.curl || '');
      } catch (error) {
        console.error('Error generating curl script:', error);
      } finally {
        setCurlGenerating(false);
      }
    };

    generateCurlScript();
  }, [open, resourceId, showTestTab, activeDebugTab, curlScript]);

  const formatContent = (content: string) => {
    if (!content) {
      return '';
    }
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  };

  const handleRunCurl = async () => {
    if (!resourceId || !curlScript.trim()) {
      return;
    }
    setCurlRunning(true);
    setCurlResult('');
    try {
      const data = await runResourceCurl({ resourceId, curl: curlScript });
      setCurlResult(JSON.stringify(data, null, 2));
    } catch (error: any) {
      setCurlResult(error?.message || String(error));
    } finally {
      setCurlRunning(false);
    }
  };

  const renderCodePanel = (content: string) => {
    const formattedContent = formatContent(content);
    if (!formattedContent) {
      return (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'skillDetail.noContent' })} />
      );
    }
    return (
      <div className={styles.debugCodePanel}>
        <pre className={styles.debugCodeBlock}>{formattedContent}</pre>
        <Button className={styles.debugCopyButton} size="small" onClick={() => copyDebugContent(formattedContent)}>
          {intl.formatMessage({ id: 'common.copy' })}
        </Button>
      </div>
    );
  };

  const renderTestPanel = () => (
    <div className={styles.debugTestPanel}>
      <div className={styles.debugCodePanel}>
        <Input.TextArea
          className={styles.debugShellEditor}
          value={curlScript}
          onChange={(event) => setCurlScript(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 14 }}
          placeholder={intl.formatMessage({
            id: curlGenerating ? 'skillDetail.generatingCurlScript' : 'skillDetail.noCurlScript',
          })}
        />
        <div className={styles.debugCodeActions}>
          <Button size="small" onClick={() => copyDebugContent(curlScript)} disabled={!curlScript}>
            {intl.formatMessage({ id: 'common.copy' })}
          </Button>
          <Button size="small" type="primary" loading={curlRunning} disabled={!curlScript} onClick={handleRunCurl}>
            {intl.formatMessage({ id: 'skillDetail.run' })}
          </Button>
        </div>
      </div>
      {curlResult && (
        <div className={styles.debugResultPanel}>
          <pre className={styles.debugCodeBlock}>{curlResult}</pre>
          <Button className={styles.debugCopyButton} size="small" onClick={() => copyDebugContent(curlResult)}>
            {intl.formatMessage({ id: 'common.copy' })}
          </Button>
        </div>
      )}
    </div>
  );

  const renderDrawerContent = () => {
    if (!showToolDebugTabs) {
      return <RenderDetailPanel skillDetail={skillDetail} />;
    }

    const isMCP = skillDetail?.resourceBizType === resourceBizTypeMap.MCP;

    return (
      <Tabs
        className={classNames(styles.detailTabs, 'full-height')}
        activeKey={activeDebugTab}
        onChange={setActiveDebugTab}
        items={compact([
          {
            key: 'detail',
            label: intl.formatMessage({ id: 'common.detail' }),
            children: <RenderDetailPanel skillDetail={skillDetail} />,
          },
          {
            key: 'sourceJson',
            label: intl.formatMessage({ id: 'skillDetail.sourceJson' }),
            children: renderCodePanel(sourceContent),
          },
          {
            key: 'targetJson',
            label: intl.formatMessage({ id: 'skillDetail.targetJson' }),
            children: renderCodePanel(targetContent),
          },
          showTestTab && {
            key: 'test',
            label: intl.formatMessage({ id: 'skillDetail.test' }),
            children: isMCP ? <MCPTestPanel record={record} skillDetail={skillDetail} /> : renderTestPanel(),
          },
        ])}
      />
    );
  };

  const detailTitle = title || getTitleByBizType(skillDetail?.resourceBizType);
  const detailContent = (
    <Spin spinning={panel ? loading || isLoading : loading} wrapperClassName="full-height-spin">
      <div className={classNames(styles.skillDetailDrawer, 'full-height')}>{renderDrawerContent()}</div>
    </Spin>
  );

  if (panel) {
    if (!open) {
      return null;
    }

    return (
      <div className={classNames(styles.skillDetailPanel, 'full-height')}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{detailTitle}</span>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </div>
        <div className={styles.panelBody}>{detailContent}</div>
      </div>
    );
  }

  return (
    <>
      <Drawer
        open={open}
        width={800}
        onClose={onClose}
        bodyStyle={{ padding: '16px 24px' }}
        title={detailTitle}
        loading={isLoading}
        mask={false}
        {...restProps}
      >
        {detailContent}
      </Drawer>
    </>
  );
}
