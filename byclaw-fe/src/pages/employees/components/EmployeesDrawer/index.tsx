/* eslint-disable jsx-quotes */

import { CloseOutlined } from '@ant-design/icons';
import { Button, Collapse, Drawer, Empty, Spin, Switch, Typography, message, Tag } from 'antd';
import classNames from 'classnames';
import { isEmpty, isNil } from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';
import { getAgentChatAvatar } from '@/utils/agent';
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';

import { queryResourceDetail } from '@/service/knowledgeCenter';
import { queryTemplateList, toggleResourceEnabled } from '@/service/assistantSetting';

import { IAgentCache } from '@/typescript/agent';

import styles from './index.module.less';

const { Text, Title } = Typography;
const { Panel } = Collapse;

type IProps = {
  agentInfo?: Partial<IAgentCache>;
  coreCompetencies?: any[];
  children: React.ReactNode;

  onClose?: () => void;

  readOnly?: boolean;
  defaultOpen?: boolean;
};

const EmployeesDrawerMemory = ({
  open,
  onClose,
  agentInfo,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  agentInfo?: Partial<IAgentCache>;
  readOnly?: boolean;
}) => {
  const intl = useIntl();

  const [memoryLoading, setMemoryLoading] = useState<boolean>(false);
  const [memoryList, setMemoryList] = useState<any[] | undefined>(undefined);

  // 获取记忆规则
  const fetchMemoryRules = useCallback(async () => {
    if (!agentInfo?.id && !agentInfo?.agentId) {
      return;
    }
    const resourceId = agentInfo.id || agentInfo.agentId;
    setMemoryLoading(true);
    try {
      const res: any = await queryTemplateList({
        templateType: 'DIGITAL_EMPLOYEE',
        resourceId,
      });
      // 注意：请求封装层已经提取了 data，所以 res 直接就是 data（数组）
      if (Array.isArray(res?.list)) {
        const mapped = res?.list.map((item: any) => ({
          key: item.templateId || '',
          title: item.ruleName || '',
          defaultChecked: item.resourceEnabled ?? true,
          templateId: item.templateId || '', // 用于调用接口
          description: item.ruleContent || '', // 规则描述
          memories: Array.isArray(item.memories) ? item.memories : [], // 产品偏好数组
        }));
        setMemoryList(mapped);
      } else {
        setMemoryList([]);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('fetch memory rules failed', error);
      setMemoryList([]);
    } finally {
      setMemoryLoading(false);
    }
  }, [agentInfo]);

  // 切换记忆规则启用状态
  const handleToggleRuleEnabled = async (section: any, checked: boolean) => {
    if (!agentInfo?.id && !agentInfo?.agentId) {
      return;
    }
    const resourceId = agentInfo.id || agentInfo.agentId;
    // 乐观更新：先更新 UI
    setMemoryList(
      (prev) => prev?.map((item: any) => (item.key === section.key ? { ...item, defaultChecked: checked } : item)) || []
    );

    try {
      await toggleResourceEnabled({
        templateType: 'DIGITAL_EMPLOYEE',
        templateId: section.templateId,
        resourceEnabled: checked,
        resourceId, // 数字员工记忆规则需要传 resourceId
      });
      // 成功提示
      message.success(
        checked ? intl.formatMessage({ id: 'common.enabled' }) : intl.formatMessage({ id: 'common.disabled' })
      );
    } catch (error) {
      // 接口失败时回滚状态
      // eslint-disable-next-line no-console
      console.error('toggle resource enabled failed', error);
      // 失败提示
      message.error(intl.formatMessage({ id: 'common.operationFailed' }));
      setMemoryList(
        (prev) =>
          prev?.map((item: any) => (item.key === section.key ? { ...item, defaultChecked: !checked } : item)) || []
      );
    }
  };

  // 当记忆抽屉打开时获取数据
  useEffect(() => {
    if (open && !memoryLoading && isNil(memoryList)) {
      fetchMemoryRules();
    }
  }, [open, memoryLoading, memoryList, fetchMemoryRules]);

  return (
    <Drawer
      width={520}
      title={intl.formatMessage({ id: 'common.memory' })}
      open={open}
      onClose={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.nativeEvent) {
          e.nativeEvent.stopImmediatePropagation();
        }
        onClose();
      }}
      className={styles.memoryDrawer}
      destroyOnHidden
    >
      <div className={styles.memoryIntro}>{intl.formatMessage({ id: 'assistantSetting.memory.intro' })}</div>

      {memoryLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin />
        </div>
      ) : (
        <>
          {!isNil(memoryList) && isEmpty(memoryList) && (
            <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
          )}
          {!isNil(memoryList) && !isEmpty(memoryList) && (
            <Collapse className={styles.memoryList} ghost expandIconPosition="start">
              {memoryList.map((section: any) => (
                <Panel
                  key={section.key}
                  header={
                    <div className={styles.memorySectionHeader}>
                      <span className={styles.memorySectionTitle}>{section.title}</span>
                      <Switch
                        disabled={readOnly}
                        checked={section.defaultChecked}
                        size="small"
                        onChange={(checked) => {
                          handleToggleRuleEnabled(section, checked);
                        }}
                        onClick={(_, event) => event?.stopPropagation()}
                      />
                    </div>
                  }
                >
                  <div>
                    <div className={styles.ruleDescription}>{section.description}</div>
                    {section.memories && section.memories.length > 0 && (
                      <div className={styles.preferenceSection}>
                        <div className={styles.preferenceTitle}>
                          {intl.formatMessage({ id: 'assistantSetting.memory.userProductPreference' })}
                        </div>
                        <div className={styles.preferenceTags}>
                          {section.memories.map((memory: string, index: number) => (
                            <Tag key={index} className={styles.preferenceTag}>
                              {memory}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </Collapse>
          )}
        </>
      )}
    </Drawer>
  );
};

const EmployeesDrawerContent = (props: {
  open: boolean;
  onClose: () => void;
  agentInfo?: Partial<IAgentCache>;
  coreCompetencies?: any[];
  readOnly?: boolean;
}) => {
  const { open, onClose, readOnly = false } = props;
  const intl = useIntl();

  const [activeKey, setActiveKey] = useState<string[]>(['ability', 'chat']);
  const [memoryOpen, setMemoryOpen] = useState<boolean>(false);

  const [agentInfo, setAgentInfo] = useState<Partial<IAgentCache> | undefined>(props?.agentInfo || {});
  const [coreCompetencies, setCoreCompetencies] = useState<any[] | undefined>(props.coreCompetencies);

  const [loading, setLoading] = useState<boolean>(false);

  const hasQueryAgentInfoRef = React.useRef(false);

  // 能力图标选项
  const abilityIcons = React.useMemo(() => {
    return [
      { type: 'icon-a-List-topliebiao3', label: intl.formatMessage({ id: 'employeesDrawer.abilityIcon.list' }) },
      {
        type: 'icon-a-Application-oneyingyong3',
        label: intl.formatMessage({ id: 'employeesDrawer.abilityIcon.cube' }),
      },
      { type: 'icon-a-Asteriskxinghao3', label: intl.formatMessage({ id: 'employeesDrawer.abilityIcon.star' }) },
      { type: 'icon-a-Circles-sevenyuanquan', label: intl.formatMessage({ id: 'employeesDrawer.abilityIcon.dot' }) },
      { type: 'icon-a-Circle-threeyuanquan', label: intl.formatMessage({ id: 'employeesDrawer.abilityIcon.person' }) },
      { type: 'icon-a-Circle-fouryuanquan', label: intl.formatMessage({ id: 'employeesDrawer.abilityIcon.tool' }) },
    ];
  }, []);
  // 能力颜色选项
  const abilityColors = React.useMemo(() => {
    return [
      { value: '#EF7BE3', label: intl.formatMessage({ id: 'employeesDrawer.abilityColor.pink' }) },
      { value: '#725CFA', label: intl.formatMessage({ id: 'employeesDrawer.abilityColor.purple' }) },
      { value: '#165DFF', label: intl.formatMessage({ id: 'employeesDrawer.abilityColor.blue' }) },
      { value: '#58D764', label: intl.formatMessage({ id: 'employeesDrawer.abilityColor.green' }) },
      { value: '#FF903E', label: intl.formatMessage({ id: 'employeesDrawer.abilityColor.orange' }) },
      { value: '#FF5A5A', label: intl.formatMessage({ id: 'employeesDrawer.abilityColor.red' }) },
    ];
  }, []);

  const getAgentInfo = useCallback(({ resourceId, resourceCode }: { resourceId?: string; resourceCode?: string }) => {
    setLoading(true);
    hasQueryAgentInfoRef.current = true;
    queryResourceDetail({
      resourceId,
      resourceCode,
    })
      .then((res) => {
        if (!res) return;

        // 解析 coreCompetencies
        try {
          const coreCompetenciesStr = res?.param?.coreCompetencies;
          if (coreCompetenciesStr) {
            const parsed = JSON.parse(coreCompetenciesStr);
            setCoreCompetencies(Array.isArray(parsed) ? parsed : []);
          } else {
            setCoreCompetencies([]);
          }
        } catch (error) {
          console.error('解析 coreCompetencies 失败:', error);
          setCoreCompetencies([]);
        }

        setAgentInfo((prevState) => {
          return {
            ...(prevState || {}),
            ...res,
            id: res?.resourceId,
            agentId: res?.resourceId,
          };
        });
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!open || hasQueryAgentInfoRef.current) return;

    const hasQueryparam = agentInfo?.resourceId || agentInfo?.resourceCode;
    if (!hasQueryparam) return;

    const hasAgentId = agentInfo?.id || agentInfo?.agentId;
    if (isNil(coreCompetencies) || !hasAgentId) {
      getAgentInfo({
        resourceId: agentInfo?.resourceId,
        resourceCode: agentInfo?.resourceCode,
      });
    }
  }, [open]);

  return (
    <>
      <Drawer
        destroyOnHidden
        // maskClosable={false}
        mask={false}
        title=""
        placement="right"
        width={400}
        onClose={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (e.nativeEvent) {
            e.nativeEvent.stopImmediatePropagation();
          }
          onClose();
        }}
        open={open}
        // mask={false}
        className={styles.drawer}
        footer={null}
        styles={{
          header: {
            display: 'none',
          },
          // body: {
          //   padding: 0,
          // },
        }}
      >
        <div className={styles.container}>
          {/* 头部信息 */}
          <div className={classNames(styles.header, 'ub ub-ver ub-pj')}>
            <div className="ub ub-pj ub-ac" style={{ height: '36px' }}>
              <Button
                icon={
                  <CloseOutlined
                    style={{ fontSize: '20px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (e.nativeEvent) {
                        e.nativeEvent.stopImmediatePropagation();
                      }
                      onClose();
                    }}
                  />
                }
                type="text"
              />
            </div>
            <div className={classNames(styles.headerMain, 'ub ub-ver ub-ac')}>
              <div className={styles.avatarWrapper}>
                <div style={{ width: 52, height: 52, borderRadius: '50%' }}>
                  {getAgentChatAvatar(agentInfo?.chatAvatar)}
                </div>
              </div>
              <div className={styles.headerContent}>
                <div className={styles.titleRow}>
                  <Title level={5} className={styles.title}>
                    {agentInfo?.name}
                  </Title>
                </div>
                <div className={styles.descriptionRow}>
                  <Text className={styles.description}>{agentInfo?.resourceDesc}</Text>
                </div>
                <div className={styles.infoRow}></div>
              </div>
            </div>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin />
            </div>
          ) : (
            <>
              {/* 能力图谱 */}
              {coreCompetencies && !isEmpty(coreCompetencies) && (
                <Collapse
                  activeKey={activeKey}
                  onChange={(key) => setActiveKey(key as string[])}
                  className={classNames(styles.collapse, 'ub ub-ver overflow-hidden')}
                  expandIconPosition="end"
                >
                  <Panel
                    header={
                      <div className={styles.panelHeader}>
                        <span className={styles.panelTitle}>{intl.formatMessage({ id: 'employees.abilityMap' })}</span>
                      </div>
                    }
                    key="ability"
                  >
                    <div className={classNames(styles.functionArea, 'ub ub-ac ub-pj')}>
                      {coreCompetencies.map((competency: any, index: number) => {
                        const iconIndex = index % abilityIcons.length;
                        const colorIndex = index % abilityColors.length;
                        const icon = abilityIcons[iconIndex];
                        const color = abilityColors[colorIndex];
                        // 将十六进制颜色转换为 RGB，并添加透明度
                        const hex = color.value.replace('#', '');
                        const r = parseInt(hex.substring(0, 2), 16);
                        const g = parseInt(hex.substring(2, 4), 16);
                        const b = parseInt(hex.substring(4, 6), 16);
                        const backgroundColor = `rgba(${r}, ${g}, ${b}, 0.1)`; // 20% 透明度

                        return (
                          <div key={index} className={styles.functionCard} style={{ background: backgroundColor }}>
                            <AntdIcon type={icon.type} className={styles.functionIcon} style={{ color: color.value }} />
                            <div className={styles.functionName}>{competency.coreCompetency}</div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                </Collapse>
              )}
            </>
          )}
        </div>
      </Drawer>
      <EmployeesDrawerMemory
        readOnly={readOnly}
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        agentInfo={agentInfo}
      />
    </>
  );
};

function EmployeesDrawer(props: IProps) {
  const { agentInfo, defaultOpen = false, onClose, readOnly = false } = props;
  const [open, setOpen] = useState<boolean>(defaultOpen);

  const canClick = agentInfo?.resourceId || agentInfo?.resourceCode;

  return (
    <>
      <div
        className={classNames({
          [styles.employeesDrawer]: canClick,
        })}
        data-employees-drawer="true"
        onClick={(e) => {
          // 阻止事件冒泡到父元素（如 List.Item）
          e.stopPropagation();
          // 阻止默认行为
          e.preventDefault();

          if (canClick) {
            setOpen(true);
          }
        }}
      >
        {props.children}
      </div>
      <div
        onClick={(e) => {
          // 摆脱上层的事件委托
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {canClick && (
          <EmployeesDrawerContent
            readOnly={readOnly}
            open={open}
            onClose={() => {
              setOpen(false);
              onClose?.();
            }}
            agentInfo={agentInfo}
            coreCompetencies={props.coreCompetencies}
          />
        )}
      </div>
    </>
  );
}

export default React.memo(EmployeesDrawer);
