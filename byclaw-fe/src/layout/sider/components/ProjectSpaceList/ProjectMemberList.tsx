import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Input, List, Modal, Spin, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, MoreOutlined, PlusOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { addProjectMember, bindMemberAgent, listProjectMembers, removeProjectMember } from '@/service/devloop';
import { POST } from '@/service/common/request';
import { getAgentChatAvatar } from '@/utils/agent';
import { getDisplayUserNameInChat } from '@/utils/chat';
import ListEndMessage from './ListEndMessage';
import styles from './index.module.less';

interface ProjectMemberListProps {
  projectId?: number;
  creatorId?: string | number;
  onMembersChange?: (members: any[]) => void;
}

// 成员接口当前一次返回项目成员，左侧窄面板按固定数量分段渲染并在触底时继续展示。
const MEMBER_PAGE_SIZE = 20;
// 绑定数字员工接口按 10 条一页请求，弹窗滚动到底部时继续加载下一页。
const AGENT_PAGE_SIZE = 10;

const getMemberUserId = (member: any) => member.userId ?? String(member.id || '').replace(/^user_/, '');

const isProjectOwnerMember = (member: any, creatorId?: string | number) => {
  // 新老数据都兼容：新数据有 owner role，老数据用项目创建人 ID 兜底。
  const isOwnerRole = ['owner', 'creator'].includes(`${member?.role || ''}`.toLowerCase());
  return isOwnerRole || (!!creatorId && `${getMemberUserId(member)}` === `${creatorId}`);
};

const ProjectMemberList: React.FC<ProjectMemberListProps> = ({ projectId, creatorId, onMembersChange }) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  // 成员面板文案集中使用同一命名空间，便于与项目详情其它 Tab 保持一致。
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.members.${id}` }, values),
    [intl]
  );
  const [members, setMembers] = useState<any[]>([]);
  const [memberSearchKeyword, setMemberSearchKeyword] = useState('');
  const [visibleMemberCount, setVisibleMemberCount] = useState(MEMBER_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [showAuthAddModal, setShowAuthAddModal] = useState(false);
  const [hoveredMemberKey, setHoveredMemberKey] = useState<string>();
  const [openActionMemberKey, setOpenActionMemberKey] = useState<string>();

  const [showAgentModal, setShowAgentModal] = useState(false);
  const [bindingMember, setBindingMember] = useState<any>(null);
  const [agentKeyword, setAgentKeyword] = useState('');
  const [agentList, setAgentList] = useState<any[]>([]);
  const [agentSearching, setAgentSearching] = useState(false);
  const [agentPage, setAgentPage] = useState(1);
  const [hasMoreAgents, setHasMoreAgents] = useState(false);
  const memberSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberQueryVersionRef = useRef(0);
  const agentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentQueryVersionRef = useRef(0);
  const agentLoadingMoreRef = useRef(false);

  const fetchMembers = useCallback(
    async (keyword = '') => {
      if (!projectId) return;
      const queryVersion = memberQueryVersionRef.current + 1;
      memberQueryVersionRef.current = queryVersion;
      setLoading(true);
      try {
        const res = await listProjectMembers(projectId, keyword);
        if (queryVersion !== memberQueryVersionRef.current) return;
        const memberList = Array.isArray(res) ? res : [];
        setMembers(memberList);
        setVisibleMemberCount(MEMBER_PAGE_SIZE);
        if (!keyword.trim()) onMembersChange?.(memberList);
      } finally {
        if (queryVersion === memberQueryVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [onMembersChange, projectId]
  );

  useEffect(() => {
    if (memberSearchTimerRef.current) {
      clearTimeout(memberSearchTimerRef.current);
      memberSearchTimerRef.current = null;
    }
    memberQueryVersionRef.current += 1;
    setMemberSearchKeyword('');
    void fetchMembers('');
  }, [fetchMembers]);

  useEffect(
    () => () => {
      if (memberSearchTimerRef.current) clearTimeout(memberSearchTimerRef.current);
    },
    []
  );

  const handleMemberSearchChange = useCallback(
    (value: string) => {
      setMemberSearchKeyword(value);
      if (memberSearchTimerRef.current) clearTimeout(memberSearchTimerRef.current);

      // 成员搜索与会话、需求、任务列表统一使用 300ms 防抖和后端模糊查询。
      memberSearchTimerRef.current = setTimeout(() => {
        void fetchMembers(value.trim());
        memberSearchTimerRef.current = null;
      }, 300);
    },
    [fetchMembers]
  );

  const handleMemberSearchSubmit = useCallback(() => {
    if (memberSearchTimerRef.current) {
      clearTimeout(memberSearchTimerRef.current);
      memberSearchTimerRef.current = null;
    }
    void fetchMembers(memberSearchKeyword.trim());
  }, [fetchMembers, memberSearchKeyword]);

  const visibleMembers = useMemo(() => members.slice(0, visibleMemberCount), [members, visibleMemberCount]);
  const hasMoreMembers = visibleMemberCount < members.length;

  const handleMemberListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMoreMembers) return;

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;

      // 成员数据已在当前查询中返回，触底时按 20 条递增显示，避免一次性渲染过多卡片。
      setVisibleMemberCount((prev) => Math.min(prev + MEMBER_PAGE_SIZE, members.length));
    },
    [hasMoreMembers, members.length]
  );

  const refreshMembersAfterMutation = useCallback(async () => {
    if (!projectId) return;
    try {
      const keyword = memberSearchKeyword.trim();
      if (!keyword) {
        await fetchMembers('');
        return;
      }

      // 搜索状态仅展示命中数据；成员发生变更后仍需向父组件同步完整成员集。
      const allMemberRes = await listProjectMembers(projectId);
      const allMembers = Array.isArray(allMemberRes) ? allMemberRes : [];
      onMembersChange?.(allMembers);
      await fetchMembers(keyword);
    } catch (error) {
      console.error('Failed to refresh project members:', error);
    }
  }, [fetchMembers, memberSearchKeyword, onMembersChange, projectId]);

  const handleAddAuthMembers = async (selectedUsers: any[] = []) => {
    if (!projectId) return;

    // 左侧小列表使用授权对象弹窗选人，确认时只提交新增且尚未加入项目的人员。
    let currentMemberList: any[] = [];
    try {
      const currentMemberRes = await listProjectMembers(projectId);
      currentMemberList = Array.isArray(currentMemberRes) ? currentMemberRes : [];
    } catch {
      message.error(t('addFailed'));
      return;
    }
    const currentMemberIdSet = new Set(currentMemberList.map((member) => String(member.userId)));
    const pendingUsers = selectedUsers.filter((user) => {
      const userId = user.userId ?? String(user.id || '').replace(/^user_/, '');
      return userId && !currentMemberIdSet.has(String(userId));
    });

    if (!pendingUsers.length) {
      message.warning(t('selectMembers'));
      return;
    }

    try {
      await Promise.all(
        pendingUsers.map((user) => {
          const userId = user.userId ?? String(user.id || '').replace(/^user_/, '');
          return addProjectMember({
            projectId,
            userId,
            userCode: user.userCode,
            userName: user.userName || user.name,
          });
        })
      );
      message.success(t('addSuccess', { count: pendingUsers.length }));
      setShowAuthAddModal(false);
      void refreshMembersAfterMutation();
    } catch {
      message.error(t('addFailed'));
    }
  };

  const isCurrentUserMember = (member: any) => {
    return (
      (!!member.userId && `${member.userId}` === `${userInfo.userId || ''}`) ||
      (!!member.userCode && `${member.userCode}` === `${userInfo.userCode || ''}`)
    );
  };

  const removeMember = async (member: any) => {
    await removeProjectMember(member.memberId);
    message.success(t('removeSuccess'));
    void refreshMembersAfterMutation();
  };

  const handleRemove = (member: any) => {
    if (isProjectOwnerMember(member, creatorId)) {
      message.warning(t('creatorCannotRemove'));
      return;
    }

    Modal.confirm({
      title: isCurrentUserMember(member) ? t('removeSelf') : t('removeMember'),
      content: isCurrentUserMember(member)
        ? t('removeSelfConfirm')
        : t('removeConfirm', { name: `${member.userName || member.userId}` }),
      okText: t('remove'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeMember(member);
      },
    });
  };

  const clearAgentSearchTimer = useCallback(() => {
    if (agentSearchTimerRef.current) {
      clearTimeout(agentSearchTimerRef.current);
      agentSearchTimerRef.current = null;
    }
  }, []);

  const handleSearchAgent = useCallback(async (page = 1, keyword = '', append = false) => {
    if (append && agentLoadingMoreRef.current) return;

    // 新查询递增版本号，避免前一次搜索或上一页请求覆盖当前关键字的结果。
    const queryVersion = append ? agentQueryVersionRef.current : agentQueryVersionRef.current + 1;
    if (append) {
      agentLoadingMoreRef.current = true;
    } else {
      agentQueryVersionRef.current = queryVersion;
      agentLoadingMoreRef.current = false;
    }

    setAgentSearching(true);
    try {
      const res = await POST<any>('/byaiService/api/v2/digitEmploy/discover', {
        keyword: keyword.trim(),
        pageNum: page,
        pageSize: AGENT_PAGE_SIZE,
      });
      if (queryVersion !== agentQueryVersionRef.current) return;

      const list = res?.data?.list || res?.list || res?.data || [];
      const nextPageList = Array.isArray(list) ? list : [];
      const rawTotal = res?.data?.total ?? res?.total;
      const total = Number(rawTotal);
      const hasValidTotal = rawTotal !== undefined && rawTotal !== null && rawTotal !== '' && Number.isFinite(total);

      setAgentList((currentList) => {
        if (!append) return nextPageList;

        // 触底追加时按数字员工 ID 去重，避免数据更新时相邻页出现重复项。
        const agentIds = new Set(
          currentList.map((agent) => `${agent.resourceId || agent.agentId || agent.id || agent.resourceCode || ''}`)
        );
        return currentList.concat(
          nextPageList.filter((agent) => {
            const agentId = `${agent.resourceId || agent.agentId || agent.id || agent.resourceCode || ''}`;
            if (!agentId || !agentIds.has(agentId)) {
              if (agentId) agentIds.add(agentId);
              return true;
            }
            return false;
          })
        );
      });
      setAgentPage(page);
      setHasMoreAgents(
        nextPageList.length > 0 &&
          (hasValidTotal ? page * AGENT_PAGE_SIZE < total : nextPageList.length === AGENT_PAGE_SIZE)
      );
    } catch {
      if (queryVersion === agentQueryVersionRef.current) {
        if (!append) setAgentList([]);
        setHasMoreAgents(false);
      }
    } finally {
      if (append && queryVersion === agentQueryVersionRef.current) {
        agentLoadingMoreRef.current = false;
      }
      if (queryVersion === agentQueryVersionRef.current) {
        setAgentSearching(false);
      }
    }
  }, []);

  const handleAgentKeywordChange = useCallback(
    (keyword: string) => {
      setAgentKeyword(keyword);
      clearAgentSearchTimer();
      agentQueryVersionRef.current += 1;
      agentLoadingMoreRef.current = false;
      setAgentSearching(false);
      setHasMoreAgents(false);

      // 输入停止 300ms 后再请求，减少模糊搜索时的接口调用频次。
      agentSearchTimerRef.current = setTimeout(() => {
        agentSearchTimerRef.current = null;
        void handleSearchAgent(1, keyword);
      }, 300);
    },
    [clearAgentSearchTimer, handleSearchAgent]
  );

  const handleAgentSearchSubmit = useCallback(
    (keyword: string) => {
      clearAgentSearchTimer();
      setAgentKeyword(keyword);
      void handleSearchAgent(1, keyword);
    },
    [clearAgentSearchTimer, handleSearchAgent]
  );

  const handleAgentListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMoreAgents || agentSearching || agentLoadingMoreRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;

      // 接近列表底部时追加下一页，替代原来的页码切换。
      void handleSearchAgent(agentPage + 1, agentKeyword, true);
    },
    [agentKeyword, agentPage, agentSearching, handleSearchAgent, hasMoreAgents]
  );

  const handleCloseAgentModal = useCallback(() => {
    clearAgentSearchTimer();
    // 关闭弹窗后使未完成请求失效，避免下次打开时写入旧数据。
    agentQueryVersionRef.current += 1;
    agentLoadingMoreRef.current = false;
    setShowAgentModal(false);
    setBindingMember(null);
  }, [clearAgentSearchTimer]);

  useEffect(
    () => () => {
      clearAgentSearchTimer();
      agentQueryVersionRef.current += 1;
      agentLoadingMoreRef.current = false;
    },
    [clearAgentSearchTimer]
  );

  const handleOpenAgentModal = (member: any) => {
    clearAgentSearchTimer();
    agentQueryVersionRef.current += 1;
    agentLoadingMoreRef.current = false;
    setBindingMember(member);
    setAgentKeyword('');
    setAgentList([]);
    setAgentPage(1);
    setHasMoreAgents(false);
    setAgentSearching(false);
    setShowAgentModal(true);
    void handleSearchAgent(1, '');
  };

  const handleBindAgent = async (agent: any) => {
    if (!bindingMember) return;
    try {
      await bindMemberAgent({
        memberId: bindingMember.memberId,
        agentId: agent.resourceId || agent.agentId || agent.id,
      });
      message.success(t('bindSuccess', { name: `${agent.resourceName || agent.name || agent.agentName}` }));
      void refreshMembersAfterMutation();
      handleCloseAgentModal();
    } catch {
      message.error(t('bindFailed'));
    }
  };

  const getMemberKey = (member: any) => `${member.memberId || member.userId || member.userCode || ''}`;

  const getMemberAvatarText = (member: any) => {
    // 成员图标沿用左侧底部用户头像规则，展示姓名后两位而非首字。
    return getDisplayUserNameInChat(`${member.userName || member.userId || ''}`.trim()) || '?';
  };

  const getAgentAvatar = (agent: any) => agent.chatAvatar || agent.avatar || agent.icon || agent.resourceLogoUrl;

  const renderMemberActionMenu = (member: any) => {
    const memberKey = getMemberKey(member);
    const showAction = hoveredMemberKey === memberKey || openActionMemberKey === memberKey;

    if (!showAction) return null;

    return (
      <Dropdown
        trigger={['hover']}
        placement="bottomRight"
        menu={{
          items: [
            {
              key: 'bind',
              icon: <RobotOutlined />,
              label: member.agentId ? t('changeAgent') : t('bindAgent'),
            },
            ...(!isProjectOwnerMember(member, creatorId)
              ? [
                {
                  key: 'remove',
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: t('remove'),
                },
              ]
              : []),
          ],
          onClick: ({ key }) => {
            if (key === 'bind') {
              handleOpenAgentModal(member);
              return;
            }
            if (key === 'remove') {
              handleRemove(member);
            }
          },
        }}
        onOpenChange={(open) => setOpenActionMemberKey(open ? memberKey : undefined)}
      >
        <Button className="project-member-more" type="text" size="small" icon={<MoreOutlined />} />
      </Dropdown>
    );
  };

  return (
    <div className={styles.detailMemberPanel}>
      <div className={styles.detailMemberToolbar}>
        <div className={`${styles.searchInput} ${styles.detailMemberSearch}`}>
          <Input
            allowClear
            placeholder={t('searchPlaceholder')}
            suffix={<SearchOutlined onClick={handleMemberSearchSubmit} />}
            value={memberSearchKeyword}
            onChange={(event) => handleMemberSearchChange(event.target.value)}
            onPressEnter={handleMemberSearchSubmit}
          />
        </div>
        {/* 图标按钮的悬停文案明确为添加成员，避免与其他“添加”操作混淆。 */}
        <Tooltip title={t('addMember')} placement="top">
          {/* 添加成员收敛为搜索框右侧图标操作，避免工具栏占两行。 */}
          <Button
            aria-label={t('addMember')}
            size="small"
            className={`${styles.detailHeaderActionButton} ${styles.detailMemberAddButton}`}
            icon={<PlusOutlined />}
            onClick={() => setShowAuthAddModal(true)}
          />
        </Tooltip>
      </div>

      <div className={styles.detailMemberScroll} onScroll={handleMemberListScroll}>
        <Spin spinning={loading}>
          {members.length === 0 ? (
            // 成员空态与需求 Tab 统一使用简洁图标，保持项目详情各列表的视觉一致。
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={memberSearchKeyword.trim() ? t('searchEmpty') : t('empty')}
            />
          ) : (
            <>
              {/* 成员列表复用需求 Tab 的无边框紧凑卡片样式。 */}
              <List
                className="project-member-list"
                split={false}
                dataSource={visibleMembers}
                renderItem={(member: any) => {
                  const memberKey = getMemberKey(member);
                  const isCreatorMember = isProjectOwnerMember(member, creatorId);
                  // 当前登录用户沿用移除确认的身份判断，确保头像与身份标签状态一致。
                  const isCurrentUser = isCurrentUserMember(member);
                  // 创建者身份优先展示，创建者本人不叠加当前用户配色或标签。
                  const showCurrentUserState = isCurrentUser && !isCreatorMember;
                  return (
                    <List.Item
                      className={`${styles.detailRequirementItem} project-member-row`}
                      onMouseEnter={() => setHoveredMemberKey(memberKey)}
                      onMouseLeave={() => {
                        if (openActionMemberKey !== memberKey) {
                          setHoveredMemberKey(undefined);
                        }
                      }}
                    >
                      <div className={styles.detailRequirementSummary}>
                        {/* 成员头像不复用需求图标，直接沿用左侧底部用户头像的方形主色样式。 */}
                        <div className="project-member-avatar">{getMemberAvatarText(member)}</div>
                        <div className={styles.detailRequirementMain}>
                          <div className="project-member-title">
                            <strong className="project-member-name">{member.userName || member.userId}</strong>
                            {/* 创建者标签紧跟成员名称展示，和禁删判断使用同一套规则。 */}
                            {isCreatorMember && (
                              <Tag className="project-member-role-tag" color="blue">
                                {t('creator')}
                              </Tag>
                            )}
                            {/* 当前用户标签与创建者保持同一颜色体系，头像继续沿用普通成员底色。 */}
                            {showCurrentUserState && (
                              <Tag className="project-member-role-tag" color="blue">
                                {t('currentUser')}
                              </Tag>
                            )}
                          </div>
                          <span>{member.agentName || t('unboundAgent')}</span>
                        </div>
                        {renderMemberActionMenu(member)}
                      </div>
                    </List.Item>
                  );
                }}
              />
              {/* 所有成员分段展示完成后，展示与数字员工列表一致的到底提示。 */}
              {!hasMoreMembers && !loading && <ListEndMessage />}
            </>
          )}
        </Spin>
      </div>

      {showAuthAddModal && (
        <AddAuthModal
          title={t('addAuthorizedObject')}
          onlyUser
          showPost={false}
          value={[]}
          onCancel={() => setShowAuthAddModal(false)}
          onOk={handleAddAuthMembers}
        />
      )}

      <Modal
        title={t('bindAgentTitle', { name: bindingMember?.userName || '' })}
        open={showAgentModal}
        onCancel={handleCloseAgentModal}
        footer={null}
        width={520}
      >
        {/* 查询加载态统一由下方列表展示，避免搜索框和列表同时转圈。 */}
        <Input.Search
          placeholder={t('searchAgent')}
          value={agentKeyword}
          onChange={(event) => handleAgentKeywordChange(event.target.value)}
          onSearch={handleAgentSearchSubmit}
          enterButton={<SearchOutlined />}
          className={styles.agentSearchInput}
        />
        <Spin spinning={agentSearching}>
          <div className={styles.agentList} onScroll={handleAgentListScroll}>
            {agentList.length === 0 ? (
              <Empty description={t('emptyAgents')} />
            ) : (
              <List
                dataSource={agentList}
                renderItem={(agent: any) => (
                  <List.Item
                    actions={[
                      <Button key="select" type="link" size="small" onClick={() => handleBindAgent(agent)}>
                        {t('select')}
                      </Button>,
                    ]}
                  >
                    {/* 数字员工发现接口的标准描述字段为 resourceDesc，兼容历史 description/desc。 */}
                    <List.Item.Meta
                      avatar={<div className={styles.agentListAvatar}>{getAgentChatAvatar(getAgentAvatar(agent))}</div>}
                      title={agent.resourceName || agent.name || agent.agentName}
                      description={agent.resourceDesc || agent.description || agent.desc || ''}
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </Spin>
      </Modal>
    </div>
  );
};

export default ProjectMemberList;
