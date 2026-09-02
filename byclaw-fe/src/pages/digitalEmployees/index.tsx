import React, { memo, useEffect, useMemo, useState } from 'react';
import { PlusOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useDispatch, useIntl, useNavigate, useSearchParams } from '@umijs/max';
import { Badge, Button, Dropdown, Input, Menu, Modal, Popconfirm, Space, Spin, Tabs, Typography, message } from 'antd';
import { trim, debounce } from 'lodash';
import useGlobal from '@/hooks/useGlobal';
import AllDigitalEmployees from './components/AllDigitalEmployees';
import ResourceFilter, { IOnOkParams, getDefaultParams } from '@/components/Resources/components/ResourceFilter';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { getAgentChatAvatar } from '@/utils/agent';
import { navigateToEmployeeChat } from '@/utils/employeeChat';
import AntdIcon from '@/components/AntdIcon';
import { getFileUrl } from '@/utils/file';
import useDigitalEmployeeAuditCount from '@/hooks/useDigitalEmployeeAuditCount';
import { applyResourceUse, queryResourceOperationPermissions } from '@/pages/manager/service/resources';
import EmployFormModal from '@/pages/manager/pages/digitalEmployeeMgr/components/EmployFormModal';
import MdPreview from '@/components/Preview/Md';

import classnames from 'classnames';

import styles from './index.module.less';

const buildDigitalEmployeeFilterParam = (_activeTab: string, filterParam?: IOnOkParams) => ({
  ...(filterParam?.resourceStatus === '' ? { includeAllResourceStatus: true } : {}),
  ...(filterParam?.resourceStatus !== undefined && filterParam?.resourceStatus !== ''
    ? { resourceStatus: filterParam.resourceStatus }
    : {}),
  ...(filterParam?.permission ? { permission: filterParam.permission } : {}),
});

const DigitalEmployeesPage: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const [searchParams, setSearchParams] = useSearchParams();
  const { count: auditCount } = useDigitalEmployeeAuditCount();

  const [isLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabFromUrl = searchParams.get('tab');
    return tabFromUrl === 'official' ? 'official' : 'available';
  });
  const [keywords, setKeywords] = useState<Record<string, string>>({});
  const [dropdownParam, setDropdownParam] = useState<IOnOkParams>(getDefaultParams());
  const AvailableGroupRef = React.useRef<any>(null);
  const AvailableEmployeeRef = React.useRef<any>(null);
  const OfficialGroupRef = React.useRef<any>(null);
  const OfficialEmployeeRef = React.useRef<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [enterpriseCreateOpen, setEnterpriseCreateOpen] = useState(false);

  const handleEmployeeChat = React.useCallback(
    (employee: any, question?: string) => {
      navigateToEmployeeChat({
        employee,
        dispatch,
        navigate,
        setAgentId,
        setSessionId,
        initialQuestion: question,
      });
    },
    [dispatch, navigate, setAgentId, setSessionId]
  );

  // 监听引导模式事件
  useEffect(() => {
    const handleGuideFindTabEnter = (data: { key: string }) => {
      if (data.key) {
        setActiveTab(data.key);
      }
    };

    EventEmitter.on('guide-find-tab-enter', handleGuideFindTabEnter);

    return () => {
      EventEmitter.off('guide-find-tab-enter', handleGuideFindTabEnter);
    };
  }, [EventEmitter]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    const legacyTabMap: Record<string, string> = { personal: 'available', enterprise: 'official', group: 'official' };
    const nextTab = legacyTabMap[tabFromUrl || ''] || tabFromUrl;
    if ((nextTab === 'available' || nextTab === 'official') && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextSearchParams.get('tab') !== activeTab) {
      nextSearchParams.set('tab', activeTab);
      setSearchParams(nextSearchParams);
    }
  }, [activeTab, searchParams, setSearchParams]);

  const getSearch = React.useCallback(
    debounce((otherParam?: any) => {
      const refs =
        activeTab === 'available' ? [AvailableGroupRef, AvailableEmployeeRef] : [OfficialGroupRef, OfficialEmployeeRef];
      refs.forEach((item) => item.current?.getSearch?.(keywords[activeTab] || '', otherParam || dropdownParam));
    }, 500),
    [activeTab, dropdownParam, keywords]
  );

  useEffect(() => {
    const handleRefreshList = () => {
      getSearch();
    };
    EventEmitter.on('digitalEmployees-refresh-list', handleRefreshList);
    return () => {
      EventEmitter.off('digitalEmployees-refresh-list', handleRefreshList);
    };
  }, [EventEmitter, getSearch]);

  useEffect(() => {
    dispatch({
      type: 'employees/getAllDigitalEmployees',
    });
  }, []);

  const tabBarExtraContent = (
    <Space>
      <ResourceFilter
        onOk={(param: any) => {
          setDropdownParam(param);
          getSearch(param);
        }}
        defaultParam={dropdownParam}
        activeTab={activeTab}
        alwaysShowStatusFilter
      />
      <Input
        suffix={
          <SearchOutlined
            onClick={() => {
              getSearch();
            }}
          />
        }
        placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
        className={styles.searchInput}
        onChange={(e) => {
          setKeywords({ ...keywords, [activeTab]: trim(e.target.value) });
        }}
        value={keywords[activeTab] ?? ''}
        onPressEnter={() => {
          // debugger;
          getSearch();
        }}
      />
      <Dropdown
        trigger={['click']}
        overlay={
          <Menu
            items={[
              { key: 'personal', label: '创建个人数字员工' },
              { key: 'personal-group', label: '创建个人数字员工组' },
              { key: 'enterprise', label: '创建企业数字员工' },
              { key: 'enterprise-group', label: '创建企业数字员工组' },
            ]}
            onClick={({ key }) => {
              if (key === 'enterprise') {
                setEnterpriseCreateOpen(true);
                return;
              }
              const [ownerType, group] = key.split('-');
              const params = new URLSearchParams({ ownerType, digitalType: 'FROM_MANUALLY' });
              if (group) params.set('agentType', '017');
              sessionStorage.setItem(
                'EmployeeDetail_prevRoute',
                `${window.location.pathname}${window.location.search}`
              );
              navigate(`/digitalEmployeesCreate?${params.toString()}`);
            }}
          />
        }
      >
        <Button type="primary" icon={<PlusOutlined />} id="guideStep2-6">
          创建
        </Button>
      </Dropdown>
      <Badge count={auditCount} size="small" offset={[-2, 2]}>
        <Button icon={<UnorderedListOutlined />} onClick={() => navigate('/myEmployees')}>
          我的员工
        </Button>
      </Badge>
    </Space>
  );

  return (
    <div className={classnames(styles.container, 'full-height ub ub-ver')}>
      <Spin
        spinning={isLoading}
        wrapperClassName={styles.spinningWrapper}
        tip={intl.formatMessage({ id: 'common.loading' })}
      >
        <Tabs
          className={classnames(styles.tabs, 'full-height')}
          activeKey={activeTab}
          tabBarExtraContent={tabBarExtraContent}
          onChange={(key) => {
            const nextTab = key;
            const nextSearchParams = new URLSearchParams(searchParams);
            setDropdownParam(getDefaultParams());
            nextSearchParams.set('tab', nextTab);
            setActiveTab(nextTab);
            setSearchParams(nextSearchParams);
          }}
        >
          <Tabs.TabPane tab="我可用的" key="available">
            <div id="availableDigitalEmployeesScroller" className={styles.tabContent}>
              <div className={styles.sectionTitle}>数字员工组</div>
              <AllDigitalEmployees
                mode="group"
                source="available"
                ref={AvailableGroupRef}
                onEmployeeClick={setPreview}
                onChatEmployee={handleEmployeeChat}
                hideCategories
                buildFilterParam={buildDigitalEmployeeFilterParam}
                compactLayout
                scrollableTarget="availableDigitalEmployeesScroller"
              />
              <div className={styles.sectionTitle}>数字员工</div>
              <AllDigitalEmployees
                mode="employee"
                source="available"
                ref={AvailableEmployeeRef}
                onEmployeeClick={setPreview}
                onChatEmployee={handleEmployeeChat}
                hideCategories
                buildFilterParam={buildDigitalEmployeeFilterParam}
                compactLayout
                scrollableTarget="availableDigitalEmployeesScroller"
              />
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab="官方推荐" key="official">
            <div id="officialDigitalEmployeesScroller" className={styles.tabContent}>
              <div className={styles.sectionTitle}>数字员工组</div>
              <AllDigitalEmployees
                mode="group"
                source="official"
                ref={OfficialGroupRef}
                onEmployeeClick={setPreview}
                onChatEmployee={handleEmployeeChat}
                hideCategories
                buildFilterParam={buildDigitalEmployeeFilterParam}
                compactLayout
                scrollableTarget="officialDigitalEmployeesScroller"
              />
              <div className={styles.sectionTitle}>数字员工</div>
              <AllDigitalEmployees
                mode="employee"
                source="official"
                ref={OfficialEmployeeRef}
                onEmployeeClick={setPreview}
                onChatEmployee={handleEmployeeChat}
                hideCategories
                buildFilterParam={buildDigitalEmployeeFilterParam}
                compactLayout
                scrollableTarget="officialDigitalEmployeesScroller"
              />
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Spin>
      {/* eslint-disable-next-line @typescript-eslint/no-use-before-define */}
      <EmployeePreviewModal
        employee={preview}
        onClose={() => setPreview(null)}
        onCreateTask={(question?: string) => {
          if (!preview) return;
          setPreview(null);
          // 弹窗与卡片统一复用同一个进入会话方法，避免两套路由初始化逻辑产生差异。
          handleEmployeeChat(preview, question);
        }}
      />
      <EmployFormModal open={enterpriseCreateOpen} type="add" onCancel={() => setEnterpriseCreateOpen(false)} />
    </div>
  );
};

export function EmployeePreviewModal({ employee, onClose, onCreateTask }: any) {
  const intl = useIntl();
  const [detail, setDetail] = useState<any>(employee);
  const [permissions, setPermissions] = useState<any>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  useEffect(() => {
    setDetail(employee);
    setPermissions(null);
    setApplyLoading(false);
    const id = employee?.resourceId || employee?.id || employee?.agentId;
    if (id) {
      getCompositeAppInfo({ resourceId: `${id}` })
        .then((response: any) => {
          const nextDetail = response?.data || response;
          if (nextDetail && typeof nextDetail === 'object') {
            setDetail((current: any) => ({ ...(current || {}), ...nextDetail }));
          }
        })
        .catch(() => undefined);
      queryResourceOperationPermissions({ resourceId: `${id}` })
        .then((res: any) => setPermissions(res?.data || res || {}))
        .catch(() => setPermissions({}));
    }
  }, [employee]);
  const employeeResourceId = detail?.resourceId || detail?.id || detail?.agentId;
  const hasUsePermission = permissions?.hasUsePermission === true;
  const isApplyPending = permissions?.useApplyPending === true || employee?.approveStatus === 'S';
  const handleApplyUse = async () => {
    if (!employeeResourceId || applyLoading || isApplyPending) return;
    setApplyLoading(true);
    try {
      await applyResourceUse({ resourceId: `${employeeResourceId}` });
      setPermissions((current: any) => ({ ...(current || {}), useApplyPending: true }));
      message.success('申请已提交，等待授权通过');
    } catch (error: any) {
      message.error(error?.message || '使用申请失败');
    } finally {
      setApplyLoading(false);
    }
  };
  const resources = useMemo(() => {
    const rawRelResourceList = Array.isArray(detail?.relResourceList) ? detail.relResourceList : [];
    const resourceMap = new Map(rawRelResourceList.map((item: any) => [`${item?.resourceId || item?.id || ''}`, item]));
    const normalizeSkill = (item: any) => {
      if (typeof item === 'string') return { name: item.trim() };
      const resource = resourceMap.get(`${item?.resourceId || item?.skillId || item?.id || ''}`) || {};
      return { ...resource, ...item };
    };
    const hasResourceName = (item: any) => {
      if (typeof item === 'string') return item.trim().length > 0;
      return Boolean(item?.resourceName || item?.name || item?.resourceCode);
    };
    const relSkills = (Array.isArray(detail?.relSkills) ? detail.relSkills : [])
      .map(normalizeSkill)
      .filter(hasResourceName);
    const configuredSkillIds = new Set(
      relSkills.map((item: any) => `${item?.resourceId || item?.skillId || item?.id || item?.resourceCode || ''}`)
    );
    const relResourceList = rawRelResourceList.filter((item: any) => {
      if (!hasResourceName(item)) return false;
      const type = `${item?.resourceBizType || item?.grantResourceType || ''}`.toUpperCase();
      if (type === 'SKILL') {
        const id = `${item?.resourceId || item?.id || item?.resourceCode || ''}`;
        return !configuredSkillIds.has(id);
      }
      return true;
    });
    const relTools = (Array.isArray(detail?.relTools) ? detail.relTools : []).filter(hasResourceName);
    const relOntology = (Array.isArray(detail?.relOntology) ? detail.relOntology : []).filter(hasResourceName);
    return [
      ...relSkills.map((item: any) => ({
        ...(typeof item === 'string' ? { name: item } : item),
        resourceBizType: 'SKILL',
      })),
      ...relTools.map((item: any) => ({ name: item, resourceName: item, resourceBizType: 'TOOL' })),
      ...relResourceList,
      ...relOntology.map((item: any) => ({ ...item, resourceBizType: 'ONTOLOGY' })),
    ];
  }, [detail]);
  const resourceTabs = useMemo(() => {
    if (detail?.agentType === '017') {
      return [
        { key: 'MEMBERS', label: '小组成员' },
        { key: 'WORK_STANDARD', label: '工作规范' },
      ];
    }
    return [
      { key: 'SKILL', label: '技能' },
      { key: 'TOOL', label: '工具' },
      { key: 'KG_DOC', label: '知识' },
      { key: 'ONTOLOGY', label: '本体' },
    ];
  }, [detail?.agentType]);
  const [resourceTab, setResourceTab] = useState('SKILL');
  const currentResources = resources.filter((item: any) => {
    const type = `${item?.resourceBizType || item?.bizType || item?.resourceType || ''}`.toUpperCase();
    if (resourceTab === 'ONTOLOGY') return type.includes('ONTOLOGY') || type === 'OBJECT' || type === 'VIEW';
    if (resourceTab === 'TOOL') return type.includes('TOOL') || type === 'MCP' || type === 'PLUGIN';
    return type === resourceTab || (resourceTab === 'KG_DOC' && type.startsWith('KG_'));
  });
  const renderResourceIcon = (item: any) => {
    const image = item?.resourceLogoUrl || item?.avatar;
    if (image) {
      return <img src={getFileUrl(image)} alt="" />;
    }
    const type = `${item?.resourceBizType || item?.bizType || item?.resourceType || ''}`.toUpperCase();
    let icon = 'icon-chajiantubiao';
    if (type === 'KG_DOC' || type.startsWith('KG_')) icon = 'icon-chuangjianfangshi-wendangku';
    if (type === 'OBJECT' || type === 'VIEW' || type === 'KG_DB') icon = 'icon-chuangjianfangshi-shujuku';
    return <AntdIcon type={icon} />;
  };
  const groupMembers = Array.isArray(detail?.employeeGroupMembers) ? detail.employeeGroupMembers : [];
  const workStandard = useMemo(() => {
    const raw = detail?.workStandard || detail?.roleAttributes || detail?.corePersonaDefinition || '';
    let parsed = raw;
    for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth += 1) {
      try {
        const next = JSON.parse(parsed);
        parsed = next;
      } catch {
        break;
      }
    }
    if (Array.isArray(parsed)) {
      const workItems = parsed.filter(
        (item: any) =>
          item?.name === '工作规范' ||
          item?.nameEn === 'Work Standard' ||
          item?.key === 'agent' ||
          item?.key === 'workStandard'
      );
      const values = (workItems.length ? workItems : parsed)
        .map((item: any) => (typeof item === 'object' && item !== null ? item.value : item))
        .filter((value: any) => value !== undefined && value !== null && `${value}`.trim())
        .map((value: any) => `${value}`.replace(/\\n/g, '\n').replace(/\\r/g, '\r'))
        .join('\n\n');
      return values;
    }
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      return `${parsed.value || ''}`.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    }
    return `${parsed || raw || ''}`.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  }, [detail]);
  const examples = useMemo(() => {
    let prologue = detail?.prologue;
    for (let depth = 0; depth < 3 && typeof prologue === 'string'; depth += 1) {
      try {
        prologue = JSON.parse(prologue);
      } catch {
        break;
      }
    }
    const raw = detail?.openingQuestion ?? detail?.openingQuestions ?? prologue?.openingQuestion;
    if (Array.isArray(raw))
      return raw
        .map((item: any) => (typeof item === 'string' ? item : item?.infoTitle || item?.question || item?.content))
        .filter(Boolean);
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
          return parsed
            .map((item: any) => (typeof item === 'string' ? item : item?.infoTitle || item?.question || item?.content))
            .filter(Boolean);
      } catch {
        return raw
          .split(/\n|；|;/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }
    return [];
  }, [detail]);
  useEffect(() => {
    setResourceTab(detail?.agentType === '017' ? 'MEMBERS' : 'SKILL');
  }, [detail?.agentType, employee]);
  let employeeTypeLabel = detail?.ownerType === 'personal' ? '个人数字员工' : '企业数字员工';
  if (detail?.agentType === '017') {
    employeeTypeLabel = detail?.ownerType === 'personal' ? '个人数字员工组' : '企业数字员工组';
  }
  return (
    <Modal
      open={!!employee}
      onCancel={onClose}
      footer={null}
      width={1230}
      centered
      destroyOnClose
      className={styles.employeePreviewModal}
      styles={{ body: { padding: 0 } }}
      title={null}
    >
      {detail && (
        <div className={styles.employeePreview}>
          <section className={styles.employeePreviewMain}>
            <div className={styles.employeePreviewHeader}>
              <div className={styles.employeePreviewAvatar}>
                {getAgentChatAvatar(detail.chatAvatar || detail.avatar)}
              </div>
              <div className={styles.employeePreviewHeaderInfo}>
                <div className={styles.employeePreviewTitleRow}>
                  <Typography.Title level={3} className={styles.employeePreviewTitle}>
                    {detail.name || detail.resourceName}
                  </Typography.Title>
                  <span className={styles.employeePreviewTag}>{employeeTypeLabel}</span>
                </div>
                {hasUsePermission ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => onCreateTask?.()}>
                    新建任务
                  </Button>
                ) : (
                  <Popconfirm
                    title={intl.formatMessage({ id: 'digitalEmployees.applyConfirm' })}
                    okText={intl.formatMessage({ id: 'common.confirm' })}
                    cancelText={intl.formatMessage({ id: 'common.cancel' })}
                    disabled={isApplyPending || applyLoading}
                    onConfirm={handleApplyUse}
                  >
                    <Button type="primary" icon={<PlusOutlined />} disabled={isApplyPending} loading={applyLoading}>
                      {isApplyPending ? '待授权通过' : '使用申请'}
                    </Button>
                  </Popconfirm>
                )}
              </div>
            </div>
            <div className={styles.employeePreviewCreator}>
              创建者: {detail.createUserName || detail.creatorName || '-'}
            </div>
            <Typography.Paragraph className={styles.employeePreviewDescription}>
              {detail.resourceDesc || detail.intro || '暂无描述'}
            </Typography.Paragraph>
            <div className={styles.exampleTitle}>试试这样问我</div>
            <div className={styles.exampleList}>
              {examples.length ? (
                examples.slice(0, 3).map((item: string, index: number) => (
                  <div
                    className={styles.exampleItem}
                    key={`${item}-${index}`}
                    onClick={() => onCreateTask?.(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onCreateTask?.(item);
                      }
                    }}
                  >
                    <span>{item}</span>
                    <span className={styles.exampleArrow}>→</span>
                  </div>
                ))
              ) : (
                <div className={styles.exampleEmpty}>暂无示例问题</div>
              )}
            </div>
          </section>
          <aside className={styles.employeePreviewAside}>
            <Tabs
              activeKey={resourceTab}
              items={resourceTabs}
              onChange={setResourceTab}
              className={styles.employeePreviewTabs}
            />
            <div className={styles.previewResourceList}>
              {resourceTab === 'WORK_STANDARD' ? (
                <div className={styles.previewWorkStandard}>
                  {workStandard ? <MdPreview content={workStandard} /> : '暂无工作规范'}
                </div>
              ) : resourceTab === 'MEMBERS' ? (
                groupMembers.length ? (
                  groupMembers.map((member: any, index: number) => (
                    <div className={styles.previewResourceItem} key={`${member?.resourceId || member?.name}-${index}`}>
                      <div className={styles.previewResourceIcon}>{getAgentChatAvatar(member?.avatar)}</div>
                      <div className={styles.previewResourceBody}>
                        <div className={styles.previewResourceName}>{member?.name || '-'}</div>
                        {member?.teamRole && <div className={styles.previewResourceDesc}>{member.teamRole}</div>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.previewResourceEmpty}>暂无小组成员</div>
                )
              ) : currentResources.length ? (
                currentResources.map((item: any, index: number) => (
                  <div
                    className={styles.previewResourceItem}
                    key={`${item?.resourceId || item?.id || item?.name}-${index}`}
                  >
                    <div className={styles.previewResourceIcon}>{renderResourceIcon(item)}</div>
                    <div className={styles.previewResourceBody}>
                      <div className={styles.previewResourceName}>
                        {item?.resourceName || item?.name || item?.resourceCode || '-'}
                      </div>
                      <div className={styles.previewResourceDesc}>
                        {item?.resourceDesc || item?.description || '暂无描述'}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.previewResourceEmpty}>
                  暂无{resourceTabs.find((item) => item.key === resourceTab)?.label}资源
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}

const DigitalEmployeesPageMemo = memo(DigitalEmployeesPage);

export default function () {
  return (
    <div style={{ height: 'calc(100vh - 16px)' }}>
      <DigitalEmployeesPageMemo />
    </div>
  );
}
