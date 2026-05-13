import React, { useState, useEffect, useCallback } from 'react';
import { Input, Collapse, Switch, Spin, message, Tag, Table } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { queryMyCreatedAndSubscribedAgentsV2 } from '@/service/digitalEmployees';
import { queryTemplateList, toggleResourceEnabled } from '@/service/assistantSetting';
import { getAgentChatAvatar, agentHandler } from '@/utils/agent';
import type { IAgent } from '@/typescript/agent.d';
import styles from './DigitalEmployeeMemory.module.less';
import type { CollapseProps } from 'antd';
import Empty from '@/components/Empty';
import SectionHeader from './SectionHeader';

const { Search } = Input;

interface MemoryRule {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  templateId: string | number; // 用于调用接口
  memories?: string[]; // 产品偏好数组
  hasMemory?: boolean; // 是否有记忆
}

interface FrequentlyUsedToolMemory {
  question: string;
  questionTag: string;
  tools: Array<{
    toolName: string;
    cnt: number;
  }>;
}

interface ToolParamMemory {
  toolName: string;
  params: Array<{
    paramName: string;
    paramValue: string;
    cnt: number;
  }>;
}

const DigitalEmployeeMemory: React.FC = () => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | number | null>(null);
  const [memoryRules, setMemoryRules] = useState<MemoryRule[]>([]);
  const [frequentlyUsedToolMemory, setFrequentlyUsedToolMemory] = useState<FrequentlyUsedToolMemory[]>([]);
  const [toolParamMemory, setToolParamMemory] = useState<ToolParamMemory[]>([]);

  // 获取数字员工列表
  const fetchEmployees = useCallback(async (keyword?: string) => {
    setLoading(true);
    try {
      const res = await queryMyCreatedAndSubscribedAgentsV2({
        pageNum: 1,
        pageSize: 100,
        keyword: keyword || '',
      });
      if (res?.list) {
        const list = res.list.map((item: IAgent) => agentHandler(item));
        setEmployeeList(list);
        // 默认选中第一个，避免闭包依赖 selectedEmployeeId
        if (list.length > 0) {
          setSelectedEmployeeId((prev) => prev ?? list[0].agentId);
        }
      }
    } catch (error) {
      console.error('fetch employees failed', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // 搜索处理
  const handleSearch = (value: string) => {
    setSearchKeyword(value);
    fetchEmployees(value);
  };

  // 获取单个数字员工的记忆规则
  const fetchEmployeeRules = useCallback(async (resourceId: string | number | null) => {
    if (!resourceId) {
      setMemoryRules([]);
      setFrequentlyUsedToolMemory([]);
      setToolParamMemory([]);
      return;
    }
    setRulesLoading(true);
    try {
      const res: any = await queryTemplateList({ templateType: 'DIGITAL_EMPLOYEE', resourceId });
      // 注意：请求封装层已经提取了 data，所以 res 直接就是 data
      // res = { list: [...], toolParamMemory: [...], frequentlyUsedToolMemory: [...] }
      if (res) {
        // 处理自定义规则记忆
        if (Array.isArray(res.list)) {
          const mapped: MemoryRule[] = res.list.map((item: any) => ({
            id: item.templateId || '',
            title: item.ruleName || '',
            description: item.ruleContent || '',
            enabled: item.resourceEnabled ?? true,
            templateId: item.templateId || '',
            memories: Array.isArray(item.memories) ? item.memories : [],
            hasMemory: item.hasMemory ?? false,
          }));
          setMemoryRules(mapped);
          // 获取更新时间（取第一个规则的更新时间）
        } else {
          setMemoryRules([]);
        }

        // 处理常用工具记忆
        if (Array.isArray(res.frequentlyUsedToolMemory)) {
          setFrequentlyUsedToolMemory(res.frequentlyUsedToolMemory);
        } else {
          setFrequentlyUsedToolMemory([]);
        }

        // 处理工具参数记忆
        if (Array.isArray(res.toolParamMemory)) {
          setToolParamMemory(res.toolParamMemory);
        } else {
          setToolParamMemory([]);
        }
      } else {
        setMemoryRules([]);
        setFrequentlyUsedToolMemory([]);
        setToolParamMemory([]);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('fetch employee rules failed', error);
      setMemoryRules([]);
      setFrequentlyUsedToolMemory([]);
      setToolParamMemory([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  // 切换记忆规则启用状态
  const handleToggleRuleEnabled = async (rule: MemoryRule, checked: boolean) => {
    if (!selectedEmployeeId) {
      return;
    }
    // 乐观更新：先更新 UI
    setMemoryRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: checked } : r)));

    try {
      await toggleResourceEnabled({
        templateType: 'DIGITAL_EMPLOYEE',
        templateId: rule.templateId,
        resourceEnabled: checked,
        resourceId: selectedEmployeeId, // 数字员工记忆规则需要传 resourceId
      });
      // 成功提示
      message.success(
        checked ? intl.formatMessage({ id: 'common.enabled' }) : intl.formatMessage({ id: 'common.disabled' })
      );
    } catch (error) {
      // 接口失败时回滚状态
      // eslint-disable-next-line no-console
      console.error('toggle resource enabled failed', error);
      message.error(intl.formatMessage({ id: 'common.operationFailed' }));
      setMemoryRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !checked } : r)));
    }
  };

  useEffect(() => {
    fetchEmployeeRules(selectedEmployeeId);
  }, [selectedEmployeeId, fetchEmployeeRules]);

  const memoryRuleItems: CollapseProps['items'] = memoryRules.map((rule) => ({
    key: rule.id,
    label: (
      <div className={styles.ruleHeader}>
        <span>{rule.title}</span>
        <Switch
          size="small"
          checked={rule.enabled}
          onChange={(checked) => {
            handleToggleRuleEnabled(rule, checked);
          }}
          onClick={(checked, e) => {
            e.stopPropagation();
          }}
        />
      </div>
    ),
    children: (
      <div>
        <div className={styles.ruleDescription}>{rule.description}</div>
        {rule.memories && rule.memories.length > 0 && (
          <div className={styles.preferenceSection}>
            <div className={styles.preferenceTitle}>
              {intl.formatMessage({ id: 'assistantSetting.memory.userProductPreference' })}
            </div>
            <div className={styles.preferenceTags}>
              {rule.memories.map((memory, index) => (
                <Tag key={`${memory}-${index}`} className={styles.preferenceTag}>
                  {memory}
                </Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
  }));

  return (
    <div className={styles.container}>
      {/* 左侧面板 */}
      <div className={styles.leftPanel}>
        {/* 搜索框 */}
        <div className={styles.searchWrapper}>
          <Search
            placeholder={intl.formatMessage({ id: 'assistantSetting.memory.inputEmployeeName' })}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onSearch={handleSearch}
            allowClear
          />
        </div>

        {/* 数字员工列表 */}
        <div className={styles.employeeList}>
          {loading && <Spin style={{ width: '100%', padding: '20px', textAlign: 'center' }} />}
          {!loading && employeeList.length === 0 && (
            <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
          )}
          {!loading &&
            employeeList.length > 0 &&
            employeeList.map((employee) => (
              <div
                key={employee.agentId}
                className={`${styles.employeeCard} ${selectedEmployeeId === employee.agentId ? styles.selected : ''}`}
                onClick={() => setSelectedEmployeeId(employee.agentId)}
              >
                <div className={styles.employeeAvatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>
                <div className={styles.employeeInfo}>
                  <div className={styles.employeeName}>
                    <span className={styles.nameText}>{employee.name}</span>
                    {employee.hasMemory && (
                      <span className={styles.memoryTag}>
                        <CheckCircleOutlined className={styles.memoryIcon} />
                        <span>{intl.formatMessage({ id: 'assistantSetting.memory.hasMemory' })}</span>
                      </span>
                    )}
                  </div>
                  <div className={styles.employeeDescription} title={employee.resourceDesc || employee.intro}>
                    {employee.resourceDesc || employee.intro || ''}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* 右侧面板 */}
      <div className={styles.rightPanel}>
        {rulesLoading && <Spin style={{ width: '100%', padding: '20px', textAlign: 'center' }} />}
        {!rulesLoading && (
          <>
            {/* 工作习惯记忆 */}
            <SectionHeader
              title={intl.formatMessage({ id: 'assistantSetting.memory.workHabitMemory' })}
              iconType="icon-tongxun-fill"
              headerBackground="linear-gradient(90deg, #F2E8FF 0%, #FFF 25%)"
              iconBackground="#8D4EDA"
            />

            {/* 常用工具记忆 */}
            <div className={styles.memorySection}>
              <div className={styles.sectionTitle}>
                {intl.formatMessage({ id: 'assistantSetting.memory.frequentlyUsedToolMemory' })}
              </div>
              {frequentlyUsedToolMemory.length > 0 ? (
                <Table
                  dataSource={frequentlyUsedToolMemory}
                  rowKey={(record, index) => `tool-${index}`}
                  pagination={false}
                  size="small"
                  className={styles.memoryTable}
                  columns={[
                    {
                      title: intl.formatMessage({ id: 'assistantSetting.memory.question' }),
                      dataIndex: 'question',
                      key: 'question',
                      width: '30%',
                      render: (text: string) => (
                        <div className={styles.tableCell} title={text}>
                          {text || '-'}
                        </div>
                      ),
                    },
                    {
                      title: intl.formatMessage({ id: 'assistantSetting.memory.frequentlyUsedTool' }),
                      dataIndex: 'tools',
                      key: 'tools',
                      width: '70%',
                      render: (tools: Array<{ toolName: string; cnt: number }>) => {
                        if (!Array.isArray(tools) || tools.length === 0) {
                          return <span className={styles.tableCell}>-</span>;
                        }
                        // 显示前3个工具，如果超过3个显示 "+N"
                        const displayTools = tools.slice(0, 3);
                        const remainingCount = tools.length - 3;
                        return (
                          <div className={styles.toolTags}>
                            {displayTools.map((tool, index) => (
                              <Tag title={tool.toolName} color="#E8F3FF" key={index} className={styles.toolTag}>
                                {tool.toolName}({tool.cnt})
                              </Tag>
                            ))}
                            {remainingCount > 0 && (
                              <Tag color="#E8F3FF" className={styles.toolTag}>
                                +{remainingCount}
                              </Tag>
                            )}
                          </div>
                        );
                      },
                    },
                  ]}
                />
              ) : (
                <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
              )}
            </div>

            {/* 工具参数记忆 */}
            <div className={styles.memorySection}>
              <div className={styles.sectionTitle}>
                {intl.formatMessage({ id: 'assistantSetting.memory.toolParamMemory' })}
              </div>
              {toolParamMemory.length > 0 ? (
                <Table
                  dataSource={toolParamMemory}
                  rowKey={(record, index) => `param-${index}`}
                  pagination={false}
                  size="small"
                  className={styles.memoryTable}
                  columns={[
                    {
                      title: intl.formatMessage({ id: 'assistantSetting.memory.toolName' }),
                      dataIndex: 'toolName',
                      key: 'toolName',
                      width: '30%',
                      render: (text: string) => (
                        <div title={text} className={styles.tableCell}>
                          {text || '-'}
                        </div>
                      ),
                    },
                    {
                      title: intl.formatMessage({ id: 'assistantSetting.memory.commonParams' }),
                      dataIndex: 'params',
                      key: 'params',
                      width: '70%',
                      render: (params: Array<{ paramName: string; paramValue: string; cnt: number }>) => {
                        if (!Array.isArray(params) || params.length === 0) {
                          return <span className={styles.tableCell}>-</span>;
                        }
                        // 按 paramName 分组，整体显示为一个Tag: paramName: paramValue(cnt)、paramValue(cnt)
                        const groupedParams: Record<string, Array<{ paramValue: string; cnt: number }>> = {};
                        params.forEach((param) => {
                          if (!groupedParams[param.paramName]) {
                            groupedParams[param.paramName] = [];
                          }
                          groupedParams[param.paramName].push({ paramValue: param.paramValue, cnt: param.cnt });
                        });

                        return (
                          <div className={styles.paramTags}>
                            {Object.entries(groupedParams).map(([paramName, values]) => {
                              const paramText = `${paramName}: ${values
                                .map((v) => `${v.paramValue}(${v.cnt})`)
                                .join('、')}`;
                              return (
                                <Tag title={paramText} key={paramName} className={styles.paramTag}>
                                  {paramText}
                                </Tag>
                              );
                            })}
                          </div>
                        );
                      },
                    },
                  ]}
                />
              ) : (
                <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
              )}
            </div>

            {/* 自定义规则记忆 */}
            <SectionHeader
              title={intl.formatMessage({ id: 'assistantSetting.memory.customRuleMemory' })}
              iconType="icon-moban"
              headerBackground="linear-gradient(90deg, #E8F3FF 0%, #FFF 25%)"
              iconBackground="#165DFF"
            />
            <div className={styles.memoryRules}>
              {memoryRules.length > 0 ? (
                <Collapse items={memoryRuleItems} ghost expandIconPosition="start" defaultActiveKey={['1']} />
              ) : (
                <div className={styles.noData}>
                  <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DigitalEmployeeMemory;
