import React, { useState, useEffect } from 'react';
import { Spin, Divider } from 'antd';
import { useIntl } from '@umijs/max';
// import AntdIcon from '@/components/AntdIcon';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { queryMyUsual } from '@/service/digitalEmployees';
import { getAgentChatAvatar, agentHandler } from '@/utils/agent';
import type { IAgent } from '@/typescript/agent.d';
// import {
//   queryTemplateList,
//   createSuperAdminTemplate,
//   // queryEpisodicMemory,
//   toggleResourceEnabled,
//   updateScene,
//   deleteScene,
// } from '@/service/assistantSetting';
// import Memory from '@/components/QueryInput/components/Memory/components/MemoryComp';
import Empty from '@/components/Empty';
import SectionHeader from './SectionHeader';
import pageStyles from '../index.module.less';
// import dayjs from 'dayjs';
import number1 from '@/assets/number1.svg';
import number2 from '@/assets/number2.svg';
import number3 from '@/assets/number3.svg';
import styles from './SuperAssistantMemory.module.less';
// import type { CollapseProps } from 'antd';
// import { ResourceQuestion } from '@/components/QueryInput/components/ResourceQuestion';

// const { TextArea } = Input;

// interface PortraitMemory {
//   updateTime: string;
//   parsedData?: Record<string, any>; // 解析后的JSON数据，一级对象为key
// }

// interface MemoryRule {
//   id: string;
//   title: string;
//   description: string;
//   enabled: boolean;
//   templateId: string | number; // 用于调用接口
//   memories?: string[]; // 产品偏好数组
// }

// interface QuestionResourceInfo {
//   agentId: string;
//   avatar: string;
//   resourceName: string;
// }

// interface Question {
//   id: string;
//   content: string;
//   cnt: number;
//   resourceInfo: QuestionResourceInfo[];
// }

interface DigitalEmployee {
  id: string | number;
  name: string;
  description: string;
  avatar?: string;
  rank?: number; // 排名，1-3显示排名标记
}

interface SuperAssistantMemoryProps {
  userBasicInfo: any;
}

const SuperAssistantMemory: React.FC<SuperAssistantMemoryProps> = ({ userBasicInfo }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  // const [portraitMemory, setPortraitMemory] = useState<PortraitMemory | null>(null);
  // const [memoryRules, setMemoryRules] = useState<MemoryRule[]>([]);
  // const [questions, setQuestions] = useState<Question[]>([]);
  const [digitalEmployees, setDigitalEmployees] = useState<DigitalEmployee[]>([]);
  // const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  // const [editingRule, setEditingRule] = useState<MemoryRule | null>(null);
  // 记录每个问题当前悬停的数字员工索引，key为question.id，value为resourceInfo的索引
  // const [hoveredResourceIndex, setHoveredResourceIndex] = useState<Record<string, number | null>>({});

  const getRankIcon = (rank?: number) => {
    if (rank === 1) return number1;
    if (rank === 2) return number2;
    if (rank === 3) return number3;
    return null;
  };

  // 获取画像记忆
  // const fetchPortraitMemory = async (cancelled: { current: boolean }): Promise<void> => {
  //   try {
  //     const res: any = await queryEpisodicMemory({ memSceneId: 10 });
  //     // 注意：请求封装层已经提取了 data，所以 res 直接就是 data
  //     // 即 res = { lastUpdateTime: "...", workDescription: [...] }
  //     if (!cancelled.current && res) {
  //       const portraitData: PortraitMemory = {
  //         updateTime: res.lastUpdateTime || '',
  //       };

  //       // 解析 portraitMemoryJson JSON字符串
  //       if (res.portraitMemoryJson) {
  //         try {
  //           const parsedJson = JSON.parse(res.portraitMemoryJson);
  //           portraitData.parsedData = parsedJson;
  //         } catch (parseError) {
  //           // JSON解析失败时仅在控制台打印错误
  //           // eslint-disable-next-line no-console
  //           console.error('parse portraitMemoryJson failed', parseError);
  //         }
  //       }

  //       setPortraitMemory(portraitData);
  //     } else if (!cancelled.current) {
  //       setPortraitMemory(null);
  //     }
  //   } catch (error) {
  //     // 接口失败时仅在控制台打印错误，UI 仍然展示为空态
  //     // eslint-disable-next-line no-console
  //     console.error('fetch portrait memory failed', error);
  //     if (!cancelled.current) {
  //       setPortraitMemory(null);
  //     }
  //   }
  // };

  // 获取常问的问题
  // const fetchFrequentlyAskedQuestions = async (cancelled: { current: boolean }): Promise<void> => {
  //   try {
  //     const res: any = await queryEpisodicMemory({ memSceneId: 101 });
  //     // 注意：请求封装层已经提取了 data，所以 res 直接就是 data
  //     // 即 res = { frequentlyAskedQuestions: [...] }
  //     if (!cancelled.current && res) {
  //       const frequentlyAskedQuestions = Array.isArray(res.frequentlyAskedQuestions)
  //         ? res.frequentlyAskedQuestions
  //         : [];
  //       // 将 frequentlyAskedQuestions 数组映射为 Question 数组
  //       const mapped: Question[] = frequentlyAskedQuestions.map((item: any, index: number) => ({
  //         id: `${index + 1}`,
  //         content: item.memory || '',
  //         cnt: item.cnt || 0,
  //         resourceInfo: Array.isArray(item.resourceInfo) ? item.resourceInfo : [],
  //       }));
  //       setQuestions(mapped);
  //     } else if (!cancelled.current) {
  //       setQuestions([]);
  //     }
  //   } catch (error) {
  //     // 接口失败时仅在控制台打印错误，UI 仍然展示为空态
  //     // eslint-disable-next-line no-console
  //     console.error('fetch frequently asked questions failed', error);
  //     if (!cancelled.current) {
  //       setQuestions([]);
  //     }
  //   }
  // };

  // 获取自定义记忆规则
  // const fetchMemoryRules = async (cancelled: { current: boolean }): Promise<void> => {
  //   try {
  //     const res: any = await queryTemplateList({ templateType: 'SUPER_ASSISTANT' });
  //     // 注意：请求封装层已经提取了 data，所以 res 直接就是 data（数组）
  //     if (!cancelled.current && Array.isArray(res?.list)) {
  //       const mapped: MemoryRule[] = res?.list.map((item: any) => ({
  //         id: item.templateId || '',
  //         title: item.ruleName || '',
  //         description: item.ruleContent || '',
  //         enabled: item.resourceEnabled ?? true,
  //         templateId: item.templateId || '',
  //         memories: Array.isArray(item.memories) ? item.memories : [],
  //       }));
  //       // setMemoryRules(mapped);
  //     } else if (!cancelled.current) {
  //       // setMemoryRules([]);
  //     }
  //   } catch (error) {
  //     // 接口失败时仅在控制台打印错误，UI 仍然展示为空态
  //     // eslint-disable-next-line no-console
  //     // console.error('fetch memory rules failed', error);
  //     // if (!cancelled.current) {
  //     //   setMemoryRules([]);
  //     // }
  //   }
  // };

  // 切换记忆规则启用状态
  // const handleToggleRuleEnabled = async (rule: MemoryRule, checked: boolean) => {
  //   // 乐观更新：先更新 UI
  //   setMemoryRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: checked } : r)));

  //   try {
  //     await toggleResourceEnabled({
  //       templateType: 'SUPER_ASSISTANT',
  //       templateId: rule.templateId,
  //       resourceEnabled: checked,
  //       // 超级助手记忆规则不需要传 resourceId
  //     });
  //     // 成功提示
  //     message.success(
  //       checked ? intl.formatMessage({ id: 'common.enabled' }) : intl.formatMessage({ id: 'common.disabled' })
  //     );
  //   } catch (error) {
  //     // 接口失败时回滚状态
  //     // eslint-disable-next-line no-console
  //     console.error('toggle resource enabled failed', error);
  //     message.error(intl.formatMessage({ id: 'common.operationFailed' }));
  //     setMemoryRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !checked } : r)));
  //   }
  // };

  // 获取常用数字员工
  const fetchDigitalEmployees = async (cancelled: { current: boolean }): Promise<void> => {
    try {
      const res: any = await queryMyUsual({ pageNum: 1, pageSize: 6 });
      if (!cancelled.current && res?.list) {
        const list = Array.isArray(res.list) ? res.list : [];
        const mapped: DigitalEmployee[] = list.slice(0, 6).map((item: IAgent, index: number) => {
          const agent = agentHandler(item);
          return {
            id: agent.agentId,
            name: agent.name,
            description: agent.resourceDesc || agent.intro || '',
            avatar: agent.chatAvatar,
            // 如果接口没有排名字段，就按顺序取前 3 个展示名次
            ...(index < 3 ? { rank: index + 1 } : {}),
          };
        });
        setDigitalEmployees(mapped);
      }
    } catch (error) {
      // 接口失败时仅在控制台打印错误，UI 仍然展示为空态
      // eslint-disable-next-line no-console
      console.error('fetch digital employees failed', error);
      if (!cancelled.current) {
        setDigitalEmployees([]);
      }
    }
  };

  // 保存记忆规则（新增或编辑）
  // const handleSaveRule = async (values: { ruleName: string; extractionRules: string }) => {
  //   const isEditMode = !!editingRule;
  //   try {
  //     if (isEditMode && editingRule) {
  //       // 编辑模式
  //       await updateScene({
  //         templateId: editingRule.templateId,
  //         ruleName: values.ruleName,
  //         ruleContent: values.extractionRules,
  //       });
  //       message.success(intl.formatMessage({ id: 'common.updateSuccess' }));
  //     } else {
  //       // 新增模式
  //       await createSuperAdminTemplate({
  //         ruleName: values.ruleName,
  //         ruleContent: values.extractionRules,
  //         templateType: 'SUPER_ASSISTANT',
  //       });
  //       message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
  //     }
  //     setIsRuleModalOpen(false);
  //     setEditingRule(null);
  //     // 刷新列表
  //     const cancelled = { current: false };
  //     await fetchMemoryRules(cancelled);
  //   } catch (error) {
  //     // eslint-disable-next-line no-console
  //     console.error(isEditMode ? 'update memory rule failed' : 'save memory rule failed', error);
  //     message.error(
  //       isEditMode ? intl.formatMessage({ id: 'common.updateFailed' }) : intl.formatMessage({ id: 'common.saveFailed' })
  //     );
  //   }
  // };

  // 删除记忆规则
  // const handleDeleteRule = async (rule: MemoryRule) => {
  //   try {
  //     await deleteScene({ templateId: rule.templateId });
  //     message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
  //     // 刷新列表
  //     const cancelled = { current: false };
  //     await fetchMemoryRules(cancelled);
  //   } catch (error) {
  //     // eslint-disable-next-line no-console
  //     console.error('delete memory rule failed', error);
  //     message.error(intl.formatMessage({ id: 'common.deleteFailed' }));
  //   }
  // };

  // 打开编辑弹窗
  // const handleEditRule = (rule: MemoryRule) => {
  //   // setEditingRule(rule);
  //   // setIsRuleModalOpen(true);
  // };

  // 打开新增弹窗
  // const handleAddRule = () => {
  //   // setEditingRule(null);
  //   // setIsRuleModalOpen(true);
  // };

  // 关闭弹窗
  // const handleCloseModal = () => {
  //   setIsRuleModalOpen(false);
  //   setEditingRule(null);
  // };

  useEffect(() => {
    const cancelled = { current: false };
    const fetchData = async () => {
      try {
        setLoading(true);

        // 并行调用接口
        await Promise.all([
          // fetchPortraitMemory(cancelled),
          // fetchMemoryRules(cancelled),
          fetchDigitalEmployees(cancelled),
          // fetchFrequentlyAskedQuestions(cancelled),
        ]);
      } finally {
        if (!cancelled.current) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled.current = true;
    };
  }, []);

  // const memoryRuleItems: CollapseProps['items'] = memoryRules.map((rule) => ({
  //   key: rule.id,
  //   label: (
  //     <div className={styles.ruleHeader}>
  //       <span>{rule.title}</span>
  //       <div className={styles.ruleActions}>
  //         <AntdIcon
  //           type="icon-a-Editbianji"
  //           className={styles.editIcon}
  //           onClick={(e) => {
  //             e.stopPropagation();
  //             handleEditRule(rule);
  //           }}
  //           // style={{ display: 'none' }}
  //         />
  //         <Popconfirm
  //           title={intl.formatMessage({ id: 'assistantSetting.memory.deleteMemoryRuleConfirm' })}
  //           onConfirm={(e) => {
  //             e?.stopPropagation();
  //             handleDeleteRule(rule);
  //           }}
  //           onCancel={(e) => {
  //             e?.stopPropagation();
  //           }}
  //           okText={intl.formatMessage({ id: 'common.confirm' })}
  //           cancelText={intl.formatMessage({ id: 'common.cancel' })}
  //         >
  //           <AntdIcon
  //             type="icon-a-Deleteshanchu"
  //             className={styles.deleteIcon}
  //             onClick={(e) => {
  //               e.stopPropagation();
  //             }}
  //             // style={{ display: 'none' }}
  //           />
  //         </Popconfirm>
  //         <Switch
  //           size="small"
  //           checked={rule.enabled}
  //           onChange={(checked) => {
  //             handleToggleRuleEnabled(rule, checked);
  //           }}
  //           onClick={(checked, e) => {
  //             e.stopPropagation();
  //           }}
  //         />
  //       </div>
  //     </div>
  //   ),
  //   children: (
  //     <div>
  //       <div className={styles.ruleDescription}>{rule.description}</div>
  //       {rule.memories && rule.memories.length > 0 && (
  //         <div className={styles.preferenceSection}>
  //           <div className={styles.preferenceTitle}>
  //             {intl.formatMessage({ id: 'assistantSetting.memory.userProductPreference' })}
  //           </div>
  //           <div className={styles.preferenceTags}>
  //             {rule.memories.map((memory, index) => (
  //               <Tag key={index} className={styles.preferenceTag}>
  //                 {memory}
  //               </Tag>
  //             ))}
  //           </div>
  //         </div>
  //       )}
  //     </div>
  //   ),
  // }));

  return (
    <Spin spinning={loading}>
      <div className={styles.memoryContainer}>
        {/* 用户信息卡片 - 复用个人信息设置字段 */}
        <div className={styles.headCard}>
          <div className={styles.userInfoCard}>
            <div className={styles.avatarStyle}>{getDisplayUserNameInChat(userBasicInfo?.userName || '')}</div>
            <div className={styles.userInfoContent}>
              <div className={pageStyles.infoHeader}>
                <div className={pageStyles.infoValue}>
                  <div className={pageStyles.infoHeaderName}>
                    <span className={pageStyles.nameText}>{userBasicInfo?.userName || ''}</span>
                  </div>
                  <div className={pageStyles.subtext}>{userBasicInfo?.positionName || ''}</div>
                </div>
              </div>
              <div className={styles.userDetails}>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>{intl.formatMessage({ id: 'common.employeeNumber' })}</span>
                  <span className={styles.detailValue}>{userBasicInfo?.userCode || ''}</span>
                </div>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>
                    {intl.formatMessage({ id: 'assistantSetting.memory.location' })}
                  </span>
                  <span className={styles.detailValue}>{userBasicInfo?.stationName || ''}</span>
                </div>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>{intl.formatMessage({ id: 'common.email' })}</span>
                  <span className={styles.detailValue}>{userBasicInfo?.email || ''}</span>
                </div>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>
                    {intl.formatMessage({ id: 'assistantSetting.memory.rank' })}
                  </span>
                  <span className={styles.detailValue}>{userBasicInfo?.stationLevel || 'P6'}</span>
                </div>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>{intl.formatMessage({ id: 'common.nickname' })}</span>
                  <span className={styles.detailValue}>
                    {JSON.parse(userBasicInfo?.prologue || '{}').nickName || ''}
                  </span>
                </div>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>
                    {intl.formatMessage({ id: 'assistantSetting.BusinessSupervisor' })}
                  </span>
                  <span className={styles.detailValue}>{userBasicInfo?.headerName || ''}</span>
                </div>
                <div className={styles.userDetailRow}>
                  <span className={styles.detailLabel}>{intl.formatMessage({ id: 'common.department' })}</span>
                  <span className={styles.detailValue}>{userBasicInfo?.pathName || ''}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* <Divider />
        <div className={styles.memoryCard}>
          <div className={styles.portraitContent}>
            <SectionHeader
              title={intl.formatMessage({ id: 'assistantSetting.memory.portraitMemory' })}
              iconType="icon-mob-wode01"
              headerBackground="linear-gradient(90deg, #E8F3FF 0%, #FFF 25%)"
              iconBackground="#165DFF"
              updateTime={
                portraitMemory?.updateTime
                  ? dayjs(portraitMemory.updateTime).format(intl.formatMessage({ id: 'common.dateFormatFull' }))
                  : undefined
              }
              updateTimePrefix={intl.formatMessage({ id: 'assistantSetting.memory.portraitUpdatedAt' })}
            />
            * 根据解析后的JSON数据展示 *
            {portraitMemory?.parsedData ? (
              <div className={styles.portraitData}>
                {Object.entries(portraitMemory.parsedData).map(([firstLevelKey, firstLevelValue]) => {
                  // 如果一级值是对象，需要展示二级对象
                  if (
                    typeof firstLevelValue === 'object' &&
                    firstLevelValue !== null &&
                    !Array.isArray(firstLevelValue)
                  ) {
                    return (
                      <div key={firstLevelKey} className={styles.firstLevelSection}>
                        <div className={styles.firstLevelTitle}>{firstLevelKey}</div>
                        <div className={styles.secondLevelContainer}>
                          {Object.entries(firstLevelValue).map(([secondLevelKey, secondLevelValue]) => (
                            <div key={secondLevelKey} className={styles.secondLevelSection}>
                              <div className={styles.secondLevelLabel}>{secondLevelKey}</div>
                              {Array.isArray(secondLevelValue) ? (
                                <div className={styles.secondLevelContent}>
                                  <div className={styles.tagContainer}>
                                    {secondLevelValue.map((item, index) => (
                                      <Tag key={index} className={styles.portraitTag}>
                                        {String(item)}
                                      </Tag>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className={styles.secondLevelContent}>
                                  <div className={styles.tagContainer}>
                                    <Tag className={styles.portraitTag}>{String(secondLevelValue)}</Tag>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  // 如果一级值不是对象，直接展示
                  return (
                    <div key={firstLevelKey} className={styles.firstLevelSection}>
                      <div className={styles.firstLevelTitle}>{firstLevelKey}</div>
                      <div className={styles.firstLevelContent}>
                        {Array.isArray(firstLevelValue) ? (
                          <div className={styles.tagContainer}>
                            {firstLevelValue.map((item, index) => (
                              <Tag key={index} className={styles.portraitTag}>
                                {String(item)}
                              </Tag>
                            ))}
                          </div>
                        ) : (
                          <span>{String(firstLevelValue)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
            )}
          </div>
        </div> */}
        <Divider />
        <SectionHeader
          title={intl.formatMessage({ id: 'assistantSetting.memory.workHabitMemory' })}
          iconType="icon-tongxun-fill"
          headerBackground="linear-gradient(90deg, #F2E8FF 0%, #FFF 25%)"
          iconBackground="#8D4EDA"
        />
        {/* 两列布局：上排（常用数字员工 + 常问的问题） */}
        <div className={styles.twoColumnLayout}>
          {/* 左侧列：你常用的数字员工 */}
          <div className={styles.leftColumn}>
            <div className={styles.memoryCard1}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionTitleText} />
                {intl.formatMessage({ id: 'assistantSetting.memory.frequentlyUsedEmployees' })}
              </div>
              {digitalEmployees.length > 0 ? (
                <div className={styles.employeeGrid}>
                  {digitalEmployees.map((employee) => (
                    <div key={employee.id} className={styles.employeeCard}>
                      <div className={styles.employeeHeader}>
                        <div className={styles.employeeLeft}>
                          <div className={styles.employeeAvatar}>{getAgentChatAvatar(employee.avatar || '')}</div>
                          <div className={styles.employeeName}>{employee.name}</div>
                        </div>
                        {(() => {
                          const icon = getRankIcon(employee.rank);
                          return icon ? (
                            <div className={styles.rankBadge}>
                              <img src={icon} alt={`${employee.rank}`} />
                            </div>
                          ) : null;
                        })()}
                      </div>
                      <div className={styles.employeeDescription} title={employee.description}>
                        {employee.description}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
              )}
            </div>
          </div>

          {/* 右侧列：你常问的问题 */}
          {/* <div className={styles.rightColumn}>
            <div className={styles.memoryCard1}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionTitleText} />
                {intl.formatMessage({ id: 'assistantSetting.memory.frequentlyAskedQuestions' })}
              </div>
              <div className={styles.questionList}>
                {questions.length > 0 ? (
                  questions.map((question) => {
                    const currentHoveredIndex = hoveredResourceIndex[question.id];
                    // 默认显示最后一个resourceInfo的名称，如果有悬停则显示悬停的
                    let displayIndex: number | null = null;
                    if (currentHoveredIndex !== null && currentHoveredIndex !== undefined) {
                      displayIndex = currentHoveredIndex;
                    } else if (question.resourceInfo.length > 0) {
                      displayIndex = question.resourceInfo.length - 1;
                    }

                    return (
                      <div key={question.id} className={styles.questionItem}>
                        <div className={styles.questionContent} title={question.content?.replace(/\{\{[^}]+\}\}/g, '')}>
                          <ResourceQuestion text={question.content} />
                        </div>
                        <div
                          className={styles.questionResources}
                          onMouseLeave={() => {
                            setHoveredResourceIndex((prev) => ({
                              ...prev,
                              [question.id]: null,
                            }));
                          }}
                        >
                          {question.resourceInfo.length > 0 && (
                            <div className={styles.resourceAvatars}>
                              {question.resourceInfo.map((resource, index) => {
                                const isActive = displayIndex === index;
                                return (
                                  <div
                                    key={resource.agentId || index}
                                    className={styles.resourceAvatarWrapper}
                                    title={resource.resourceName}
                                    onMouseEnter={() => {
                                      setHoveredResourceIndex((prev) => ({
                                        ...prev,
                                        [question.id]: index,
                                      }));
                                    }}
                                  >
                                    <div className={styles.resourceAvatar}>{getAgentChatAvatar(resource.avatar)}</div>
                                    <div
                                      className={`${styles.resourceName} ${isActive ? styles.resourceNameActive : ''}`}
                                      title={resource.resourceName}
                                    >
                                      {resource.resourceName}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
                )}
              </div>
            </div>
          </div> */}

          {/* 左侧列：自定义记忆规则 */}
          {/* <div className={styles.leftColumn}>
            <div className={styles.memoryCard1}>
              <div
                className={styles.sectionTitleContainer}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div className={styles.sectionTitle}>
                  <span className={styles.sectionTitleText} />
                  {intl.formatMessage({ id: 'assistantSetting.memory.customMemoryRules' })}
                </div>
                <Button type="link" size="small" onClick={handleAddRule}>
                  + {intl.formatMessage({ id: 'common.add' })}
                </Button>
              </div>
              {memoryRules.length > 0 ? (
                <Collapse
                  className={styles.memoryRuleCollapse}
                  items={memoryRuleItems}
                  ghost
                  expandIconPosition="start"
                />
              ) : (
                <Empty description={intl.formatMessage({ id: 'assistantSetting.memory.noData' })} />
              )}
            </div>
          </div> */}

          {/* 右侧列：固化的任务记忆 */}
          {/* <div className={styles.rightColumn}>
            <div className={styles.memoryCard1}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionTitleText} />
                {intl.formatMessage({ id: 'assistantSetting.memory.fixedTaskMemory' })}
              </div>
              <Memory />
            </div>
          </div> */}
        </div>
      </div>

      {/* 新增/编辑记忆规则弹窗 */}
      {/* <AddMemoryRuleModal
        open={isRuleModalOpen}
        onClose={handleCloseModal}
        onSave={handleSaveRule}
        editingRule={editingRule}
      /> */}
    </Spin>
  );
};

// 新增/编辑记忆规则弹窗组件
// interface AddMemoryRuleModalProps {
//   open: boolean;
//   onClose: () => void;
//   onSave: (values: { ruleName: string; extractionRules: string }) => void;
//   editingRule?: MemoryRule | null;
// }

// const AddMemoryRuleModal: React.FC<AddMemoryRuleModalProps> = ({ open, onClose, onSave, editingRule }) => {
//   const intl = useIntl();
//   const [form] = Form.useForm();
//   const isEditMode = !!editingRule;

//   useEffect(() => {
//     if (open) {
//       if (isEditMode && editingRule) {
//         // 编辑模式：填充现有数据
//         form.setFieldsValue({
//           ruleName: editingRule.title,
//           extractionRules: editingRule.description,
//         });
//       } else {
//         // 新增模式：重置表单
//         form.resetFields();
//         form.setFieldsValue({
//           ruleName: '',
//           extractionRules: '',
//         });
//       }
//     }
//   }, [open, form, isEditMode, editingRule]);

//   const handleSave = async () => {
//     try {
//       const values = await form.validateFields();
//       onSave?.(values);
//       form.resetFields();
//       onClose();
//     } catch (error) {
//       // eslint-disable-next-line no-console
//       console.error('表单验证失败:', error);
//     }
//   };

//   const handleCancel = () => {
//     form.resetFields();
//     onClose();
//   };

//   return (
//     <Modal
//       title={
//         <span className={styles.addModalTitle}>
//           {isEditMode
//             ? intl.formatMessage({ id: 'assistantSetting.memory.editMemoryRule' })
//             : intl.formatMessage({ id: 'assistantSetting.memory.addMemoryRule' })}
//         </span>
//       }
//       open={open}
//       onCancel={handleCancel}
//       footer={null}
//       width={600}
//       centered
//       destroyOnHidden
//       maskClosable
//       className={styles.addRuleModal}
//     >
//       <Form form={form} layout="vertical" className={styles.addRuleForm}>
//         <Form.Item
//           name="ruleName"
//           label={
//             <span className={styles.requiredLabel}>
//               {intl.formatMessage({ id: 'assistantSetting.memory.ruleName' })}
//             </span>
//           }
//           rules={[{ required: true, message: intl.formatMessage({ id: 'assistantSetting.memory.inputRuleName' }) }]}
//         >
//           <Input placeholder={intl.formatMessage({ id: 'assistantSetting.memory.inputRuleName' })} />
//         </Form.Item>

//         <Form.Item
//           name="extractionRules"
//           label={
//             <span className={styles.requiredLabel}>
//               {intl.formatMessage({ id: 'assistantSetting.memory.extractionRule' })}
//             </span>
//           }
//           rules={[
//             { required: true, message: intl.formatMessage({ id: 'assistantSetting.memory.inputExtractionRule' }) },
//           ]}
//         >
//           <TextArea
//             placeholder={intl.formatMessage({ id: 'assistantSetting.memory.inputExtractionRuleExample' })}
//             rows={8}
//             className={styles.extractionRulesTextArea}
//           />
//         </Form.Item>

//         <div className={styles.addRuleFooter}>
//           <Button onClick={handleCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
//           <Button type="primary" onClick={handleSave}>
//             {isEditMode
//               ? intl.formatMessage({ id: 'common.save' })
//               : intl.formatMessage({ id: 'assistantSetting.memory.saveTemplate' })}
//           </Button>
//         </div>
//       </Form>
//     </Modal>
//   );
// };

export default SuperAssistantMemory;
