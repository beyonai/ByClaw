import { Button, Dropdown, Empty, Input, List, Modal, Spin, Tabs, Tag, Typography, message } from 'antd';
import {
  DeleteOutlined,
  DisconnectOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { dataItemTypeMap } from '@/pages/manager/components/PersonnelModel';
import { bindMemberAgent, listProjectMembers, saveProjectMembers, unbindMemberAgent } from '@/service/devloop';
import { POST } from '@/service/common/request';
import { getAgentChatAvatar } from '@/utils/agent';
import { getDisplayUserNameInChat } from '@/utils/chat';
import smallDetailStyles from '@/layout/sider/components/ProjectSpaceList/index.module.less';
import type { ProjectMember, ProjectSpace } from '../../types';
import { getArrayData } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  compact?: boolean;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

const PAGE_SIZE = 20;
const AGENT_PAGE_SIZE = 10;

const getMemberAvatarText = (member: ProjectMember) =>
  getDisplayUserNameInChat(`${member.userName || member.userCode || member.userId || ''}`.trim()) || '?';

const ProjectMembers: React.FC<Props> = ({
  project,
  keyword = '',
  compact = false,
  onToolbarChange,
  onRefreshToolbarChange,
}) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const currentUserId = userInfo.userId ?? userInfo.id;
  const currentUserCode = userInfo.userCode;
  const currentUserName = userInfo.userName ?? userInfo.name;
  const [allMembers, setAllMembers] = useState<ProjectMember[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [bindingMember, setBindingMember] = useState<ProjectMember | null>(null);
  const [agentKeyword, setAgentKeyword] = useState('');
  const [agentOptions, setAgentOptions] = useState<any[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentPage, setAgentPage] = useState(1);
  const [hasMoreAgents, setHasMoreAgents] = useState(false);
  const [agentTab, setAgentTab] = useState<'personal' | 'group'>('personal');
  const initialLoadProjectRef = useRef<string | null>(null);
  const savingMembersRef = useRef(false);
  const agentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentQueryVersionRef = useRef(0);
  const agentLoadingMoreRef = useRef(false);
  const isProjectCreator = useMemo(
    () =>
      currentUserId !== undefined &&
      (`${currentUserId}` === `${project.createBy}` ||
        `${currentUserCode || ''}` === `${project.createBy}` ||
        `${currentUserName || ''}` === `${project.createBy}` ||
        allMembers.some(
          (member) =>
            `${member.userId}` === `${currentUserId}` &&
            ['owner', 'creator'].includes(`${member.role || ''}`.toLowerCase())
        )),
    [allMembers, currentUserCode, currentUserId, currentUserName, project.createBy]
  );
  const isCurrentUserMember = useCallback(
    (member: ProjectMember) => currentUserId !== undefined && `${currentUserId}` === `${member.userId}`,
    [currentUserId]
  );

  const loadMembers = useCallback(async () => {
    if (!project.projectId) return;
    setLoading(true);
    try {
      const response = await listProjectMembers(Number(project.projectId));
      setAllMembers(getArrayData(response) as ProjectMember[]);
      setVisibleCount(PAGE_SIZE);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.loadFailed' }));
      setAllMembers([]);
    } finally {
      setLoading(false);
    }
  }, [intl, project.projectId]);

  const isOwnerMember = useCallback(
    (member: ProjectMember) =>
      ['owner', 'creator'].includes(`${member.role || ''}`.toLowerCase()) ||
      `${member.userId}` === `${project.createBy}`,
    [project.createBy]
  );

  const normalizeSelectedMember = useCallback(
    (member: ProjectMember) => ({
      ...member,
      // 与小详情保持一致：授权选择器通过 id/name/type 渲染右侧已选列表。
      id: `user_${member.userId}`,
      name: member.userName || member.userCode || `${member.userId}`,
      type: dataItemTypeMap.user,
      cannotDel: isOwnerMember(member),
    }),
    [isOwnerMember]
  );

  const handleOpenAddMember = useCallback(async () => {
    if (!project.projectId || !isProjectCreator || addMemberLoading) return;
    setAddMemberLoading(true);
    try {
      // 打开面板时重新获取完整成员集合，避免其它入口修改后已选成员回显过期。
      const response = await listProjectMembers(Number(project.projectId));
      const members = getArrayData(response) as ProjectMember[];
      setSelectedMembers(members.map(normalizeSelectedMember));
      setAddMemberOpen(true);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.addFailed' }));
    } finally {
      setAddMemberLoading(false);
    }
  }, [addMemberLoading, intl, isProjectCreator, normalizeSelectedMember, project.projectId]);

  const handleSaveMembers = useCallback(
    async (selectedUsers: any[] = []) => {
      if (!project.projectId || !isProjectCreator || savingMembersRef.current) return;
      savingMembersRef.current = true;
      setSavingMembers(true);
      try {
        // 保存前重新读取成员，创建者即使在选择器中被异常取消也必须补回。
        const response = await listProjectMembers(Number(project.projectId));
        const currentMembers = getArrayData(response) as ProjectMember[];
        const selectedUserMap = new Map<string, string | number>();
        selectedUsers.forEach((user) => {
          const userId = user.userId ?? `${user.id || ''}`.replace(/^user_/, '');
          if (userId !== undefined && userId !== null && `${userId}` !== '') {
            selectedUserMap.set(`${userId}`, userId);
          }
        });

        const removedOwners = currentMembers.filter(
          (member) => isOwnerMember(member) && !selectedUserMap.has(`${member.userId}`)
        );
        if (removedOwners.length) {
          message.warning(intl.formatMessage({ id: 'projectSpace.members.creatorCannotRemove' }));
          removedOwners.forEach((member) => selectedUserMap.set(`${member.userId}`, member.userId));
        }

        const currentUserIds = new Set(currentMembers.map((member) => `${member.userId}`));
        const selectedUserIds = Array.from(selectedUserMap.values());
        const hasChanges =
          currentUserIds.size !== selectedUserMap.size ||
          Array.from(selectedUserMap.keys()).some((userId) => !currentUserIds.has(userId));
        if (hasChanges) {
          // 与小详情使用同一保存方式：一次提交最终成员集合，
          // 由后端统一处理新增、删除和去重。
          await saveProjectMembers({ projectId: Number(project.projectId), userIds: selectedUserIds });
          message.success(intl.formatMessage({ id: 'projectSpace.members.saveSuccess' }));
          await loadMembers();
        }
        setAddMemberOpen(false);
        setSelectedMembers([]);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.saveFailed' }));
      } finally {
        savingMembersRef.current = false;
        setSavingMembers(false);
      }
    },
    [intl, isOwnerMember, isProjectCreator, loadMembers, project.projectId]
  );

  const clearAgentSearchTimer = useCallback(() => {
    if (agentSearchTimerRef.current) {
      clearTimeout(agentSearchTimerRef.current);
      agentSearchTimerRef.current = null;
    }
  }, []);

  const loadAgentOptions = useCallback(
    async (page = 1, keyword = '', append = false, type: 'personal' | 'group' = 'personal') => {
      if (append && agentLoadingMoreRef.current) return;

      // 与小详情一致，使用查询版本和追加锁避免旧搜索结果覆盖新关键字。
      const queryVersion = append ? agentQueryVersionRef.current : agentQueryVersionRef.current + 1;
      if (append) {
        agentLoadingMoreRef.current = true;
      } else {
        agentQueryVersionRef.current = queryVersion;
        agentLoadingMoreRef.current = false;
      }

      setAgentLoading(true);
      try {
        const response = await POST<any>('/byaiService/api/v2/digitEmploy/discover', {
          keyword: keyword.trim(),
          pageNum: page,
          pageSize: AGENT_PAGE_SIZE,
          ...(type === 'group' ? { agentType: '017' } : {}),
        });
        if (queryVersion !== agentQueryVersionRef.current) return;

        const list = response?.data?.list || response?.list || response?.data || [];
        const nextPageList = Array.isArray(list) ? list : [];
        const rawTotal = response?.data?.total ?? response?.total;
        const total = Number(rawTotal);
        const hasValidTotal = rawTotal !== undefined && rawTotal !== null && rawTotal !== '' && Number.isFinite(total);
        setAgentOptions((currentList) => {
          if (!append) return nextPageList;
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
      } catch (error: any) {
        if (queryVersion === agentQueryVersionRef.current) {
          if (!append) setAgentOptions([]);
          setHasMoreAgents(false);
          message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.agentLoadFailed' }));
        }
      } finally {
        if (append && queryVersion === agentQueryVersionRef.current) {
          agentLoadingMoreRef.current = false;
        }
        if (queryVersion === agentQueryVersionRef.current) {
          setAgentLoading(false);
        }
      }
    },
    [intl]
  );

  const handleAgentKeywordChange = useCallback(
    (keyword: string) => {
      setAgentKeyword(keyword);
      clearAgentSearchTimer();
      agentQueryVersionRef.current += 1;
      agentLoadingMoreRef.current = false;
      setAgentLoading(false);
      setHasMoreAgents(false);
      // 输入停止 300ms 后查询，保持与小详情相同的搜索节奏。
      agentSearchTimerRef.current = setTimeout(() => {
        agentSearchTimerRef.current = null;
        void loadAgentOptions(1, keyword, false, agentTab);
      }, 300);
    },
    [agentTab, clearAgentSearchTimer, loadAgentOptions]
  );

  const handleAgentSearchSubmit = useCallback(
    (keyword: string) => {
      clearAgentSearchTimer();
      setAgentKeyword(keyword);
      void loadAgentOptions(1, keyword, false, agentTab);
    },
    [agentTab, clearAgentSearchTimer, loadAgentOptions]
  );

  const handleAgentListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMoreAgents || agentLoading || agentLoadingMoreRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;
      void loadAgentOptions(agentPage + 1, agentKeyword, true, agentTab);
    },
    [agentKeyword, agentLoading, agentPage, agentTab, hasMoreAgents, loadAgentOptions]
  );

  const handleCloseAgentModal = useCallback(() => {
    clearAgentSearchTimer();
    // 关闭后使尚未完成的请求失效，避免再次打开时闪回旧列表。
    agentQueryVersionRef.current += 1;
    agentLoadingMoreRef.current = false;
    setBindingMember(null);
    setAgentOptions([]);
    setAgentLoading(false);
    setHasMoreAgents(false);
    setAgentTab('personal');
  }, [clearAgentSearchTimer]);

  const handleOpenAgentModal = useCallback(
    (member: ProjectMember) => {
      clearAgentSearchTimer();
      agentQueryVersionRef.current += 1;
      agentLoadingMoreRef.current = false;
      setBindingMember(member);
      setAgentKeyword('');
      setAgentOptions([]);
      setAgentPage(1);
      setHasMoreAgents(false);
      setAgentLoading(false);
      setAgentTab('personal');
      void loadAgentOptions(1, '', false, 'personal');
    },
    [clearAgentSearchTimer, loadAgentOptions]
  );

  const handleAgentTabChange = useCallback(
    (tab: string) => {
      const nextTab = tab as 'personal' | 'group';
      setAgentTab(nextTab);
      clearAgentSearchTimer();
      agentQueryVersionRef.current += 1;
      agentLoadingMoreRef.current = false;
      setAgentOptions([]);
      setAgentPage(1);
      setHasMoreAgents(false);
      setAgentLoading(false);
      void loadAgentOptions(1, agentKeyword, false, nextTab);
    },
    [agentKeyword, clearAgentSearchTimer, loadAgentOptions]
  );

  useEffect(
    () => () => {
      clearAgentSearchTimer();
      agentQueryVersionRef.current += 1;
      agentLoadingMoreRef.current = false;
    },
    [clearAgentSearchTimer]
  );

  const handleBindAgent = useCallback(
    async (agent: any) => {
      if (!bindingMember?.memberId) return;
      try {
        await bindMemberAgent({
          memberId: Number(bindingMember.memberId),
          agentId: Number(agent.resourceId ?? agent.agentId ?? agent.id),
        });
        message.success(
          intl.formatMessage(
            { id: 'projectSpace.members.bindSuccess' },
            { name: agent.resourceName || agent.name || agent.agentName || '' }
          )
        );
        handleCloseAgentModal();
        await loadMembers();
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.bindFailed' }));
      }
    },
    [bindingMember, handleCloseAgentModal, intl, loadMembers]
  );

  const handleUnbindAgent = useCallback(
    (member: ProjectMember) => {
      if (!member.memberId || !member.agentId) return;
      Modal.confirm({
        title: intl.formatMessage({ id: 'projectSpace.members.unbindAgent' }),
        content: intl.formatMessage(
          { id: 'projectSpace.members.unbindConfirm' },
          { name: member.userName || member.userCode || member.userId }
        ),
        okText: intl.formatMessage({ id: 'projectSpace.members.confirmUnbind' }),
        cancelText: intl.formatMessage({ id: 'common.cancel' }),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await unbindMemberAgent(Number(member.memberId));
            message.success(intl.formatMessage({ id: 'projectSpace.members.unbindSuccess' }));
            await loadMembers();
          } catch (error: any) {
            message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.unbindFailed' }));
          }
        },
      });
    },
    [intl, loadMembers]
  );

  const handleRemoveMember = useCallback(
    (member: ProjectMember) => {
      if (!isProjectCreator || `${member.userId}` === `${project.createBy}`) {
        message.warning(intl.formatMessage({ id: 'projectSpace.members.creatorCannotRemove' }));
        return;
      }
      Modal.confirm({
        title: intl.formatMessage({ id: 'projectSpace.members.removeMember' }),
        content: intl.formatMessage(
          { id: 'projectSpace.members.removeConfirm' },
          { name: member.userName || member.userId }
        ),
        okText: intl.formatMessage({ id: 'projectSpace.members.remove' }),
        okButtonProps: { danger: true },
        onOk: async () => {
          const remaining = allMembers
            .filter((item) => `${item.userId}` !== `${member.userId}`)
            .map((item) => item.userId);
          await saveProjectMembers({ projectId: Number(project.projectId), userIds: remaining });
          message.success(intl.formatMessage({ id: 'projectSpace.members.removeSuccess' }));
          await loadMembers();
        },
      });
    },
    [allMembers, intl, isProjectCreator, loadMembers, project.createBy, project.projectId]
  );

  useEffect(() => {
    const projectKey = `${project.projectId}`;
    // React 严格模式下避免成员 Tab 首次挂载重复请求。
    if (initialLoadProjectRef.current === projectKey) return;
    initialLoadProjectRef.current = projectKey;
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    onToolbarChange?.(
      isProjectCreator ? (
        <div className={styles.headerActions}>
          <Button
            type="text"
            size="small"
            className={styles.resourceCardExpandButton}
            icon={<PlusOutlined />}
            aria-label={intl.formatMessage({ id: 'projectSpace.members.addMember' })}
            loading={addMemberLoading}
            onClick={handleOpenAddMember}
          />
        </div>
      ) : null
    );
    onRefreshToolbarChange?.(
      <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadMembers()}>
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => {
      onToolbarChange?.(null);
      onRefreshToolbarChange?.(null);
    };
  }, [
    addMemberLoading,
    handleOpenAddMember,
    intl,
    isProjectCreator,
    loadMembers,
    loading,
    onRefreshToolbarChange,
    onToolbarChange,
  ]);

  useEffect(() => {
    // 顶部搜索条件变化时从首批成员开始展示，避免沿用上一次展开数量。
    setVisibleCount(PAGE_SIZE);
  }, [keyword]);

  const filteredMembers = allMembers.filter((member) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return true;
    return `${member.userName || ''} ${member.userCode || ''} ${member.userId}`
      .toLowerCase()
      .includes(normalizedKeyword);
  });
  const visibleMembers = filteredMembers.slice(0, visibleCount);
  const hasMore = visibleCount < filteredMembers.length;
  const sentinelRef = useInfiniteScroll(
    () => setVisibleCount((current) => Math.min(current + PAGE_SIZE, filteredMembers.length)),
    hasMore && !loading
  );

  return (
    <>
      <div className={styles.dataPanel}>
        <Spin spinning={loading}>
          {visibleMembers.length ? (
            compact ? (
              <div className={styles.membersCompactCard}>
                {filteredMembers.map((member) => {
                  const isOwner = `${member.role || ''}`.toLowerCase() === 'owner';
                  const canOperate = isProjectCreator || isCurrentUserMember(member);
                  return (
                    <Dropdown
                      key={`${member.memberId || member.userId}`}
                      trigger={['hover']}
                      placement="bottomRight"
                      menu={{
                        items: [
                          ...(canOperate
                            ? [
                                {
                                  key: 'bind-agent',
                                  icon: <RobotOutlined />,
                                  label: intl.formatMessage({
                                    id: member.agentId
                                      ? 'projectSpace.members.changeAgent'
                                      : 'projectSpace.members.bindAgent',
                                  }),
                                },
                                ...(member.agentId
                                  ? [
                                      {
                                        key: 'unbind-agent',
                                        danger: true,
                                        icon: <DisconnectOutlined />,
                                        label: intl.formatMessage({ id: 'projectSpace.members.unbindAgent' }),
                                      },
                                    ]
                                  : []),
                                ...(isProjectCreator && !isOwner
                                  ? [
                                      {
                                        key: 'remove-member',
                                        danger: true,
                                        icon: <DeleteOutlined />,
                                        label: intl.formatMessage({ id: 'projectSpace.members.removeMember' }),
                                      },
                                    ]
                                  : []),
                              ]
                            : []),
                        ],
                        onClick: ({ key }) => {
                          if (key === 'bind-agent') handleOpenAgentModal(member);
                          if (key === 'unbind-agent') handleUnbindAgent(member);
                          if (key === 'remove-member') handleRemoveMember(member);
                        },
                      }}
                    >
                      <span className={styles.memberCompactTag}>
                        <span className={styles.memberCompactAvatar}>{getMemberAvatarText(member)}</span>
                        <span className={styles.memberCompactName}>
                          {member.userName || member.userCode || `${member.userId}`}
                        </span>
                        {canOperate && <MoreOutlined className={styles.memberCompactMore} />}
                      </span>
                    </Dropdown>
                  );
                })}
              </div>
            ) : (
              <div className={styles.dataCardGrid}>
                {visibleMembers.map((member) => {
                  const isOwner = `${member.role || ''}`.toLowerCase() === 'owner';
                  const isCurrentUser = isCurrentUserMember(member);
                  const canOperate = isProjectCreator || isCurrentUser;
                  const memberCreateTime =
                    member.createTime && dayjs(member.createTime).isValid()
                      ? dayjs(member.createTime).format('YYYY-MM-DD HH:mm')
                      : member.createTime || '-';
                  return (
                    <article
                      key={`${member.memberId || member.userId}`}
                      className={styles.dataCard}
                      tabIndex={canOperate ? 0 : -1}
                    >
                      <div className={styles.memberCardIdentity}>
                        {/* 成员头像复用系统用户头像规则，使用方形主色底并展示姓名后两个字。 */}
                        <div className={styles.memberUserAvatar}>{getMemberAvatarText(member)}</div>
                        <div className={styles.memberCardName}>
                          <Typography.Text strong ellipsis>
                            {member.userName || member.userCode || `${member.userId}`}
                          </Typography.Text>
                          <Typography.Text type="secondary" ellipsis>
                            {member.userCode || `${member.userId}`}
                          </Typography.Text>
                        </div>
                      </div>
                      <Tag
                        className={styles.memberRoleTag}
                        color={isOwner ? 'gold' : isCurrentUser ? 'blue' : 'default'}
                      >
                        {isOwner
                          ? intl.formatMessage({ id: 'projectSpace.members.owner' })
                          : isCurrentUser
                          ? intl.formatMessage({ id: 'projectSpace.members.currentUser' })
                          : intl.formatMessage({ id: 'projectSpace.members.member' })}
                      </Tag>
                      <div className={styles.memberCardMeta}>
                        <Typography.Text className={styles.memberCardAgent} type="secondary" ellipsis>
                          <span>
                            {member.agentName || intl.formatMessage({ id: 'projectSpace.members.unboundAgent' })}
                          </span>
                        </Typography.Text>
                        {/* 成员创建时间只展示到分钟，悬停操作出现时主动让出右下角空间。 */}
                        <Typography.Text className={styles.memberCardCreateTime} type="secondary">
                          {memberCreateTime}
                        </Typography.Text>
                      </div>
                      {canOperate && (
                        <Dropdown
                          trigger={['hover']}
                          placement="bottomRight"
                          menu={{
                            items: [
                              {
                                key: 'bind-agent',
                                icon: <RobotOutlined />,
                                label: intl.formatMessage({
                                  id: member.agentId
                                    ? 'projectSpace.members.changeAgent'
                                    : 'projectSpace.members.bindAgent',
                                }),
                              },
                              ...(member.agentId
                                ? [
                                    {
                                      key: 'unbind-agent',
                                      danger: true,
                                      icon: <DisconnectOutlined />,
                                      label: intl.formatMessage({ id: 'projectSpace.members.unbindAgent' }),
                                    },
                                  ]
                                : []),
                              ...(isProjectCreator && !isOwner
                                ? [
                                    {
                                      key: 'remove-member',
                                      danger: true,
                                      icon: <DeleteOutlined />,
                                      label: intl.formatMessage({ id: 'projectSpace.members.removeMember' }),
                                    },
                                  ]
                                : []),
                            ],
                            onClick: ({ key }) => {
                              if (key === 'bind-agent') {
                                handleOpenAgentModal(member);
                              } else if (key === 'unbind-agent') {
                                handleUnbindAgent(member);
                              } else if (key === 'remove-member') {
                                handleRemoveMember(member);
                              }
                            },
                          }}
                        >
                          <Button className={styles.memberCardMore} type="text" size="small" icon={<MoreOutlined />} />
                        </Dropdown>
                      )}
                    </article>
                  );
                })}
              </div>
            )
          ) : (
            !loading && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={intl.formatMessage({ id: 'projectSpace.members.empty' })}
              />
            )
          )}
          <div ref={sentinelRef} className={styles.loadMoreSentinel} />
        </Spin>
      </div>
      {addMemberOpen && (
        <AddAuthModal
          title={intl.formatMessage({ id: 'projectSpace.members.addMember' })}
          onlyUser
          showPost={false}
          value={selectedMembers}
          confirmLoading={savingMembers}
          onCancel={() => {
            setAddMemberOpen(false);
            setSelectedMembers([]);
          }}
          onOk={handleSaveMembers}
        />
      )}
      <Modal
        open={!!bindingMember}
        title={intl.formatMessage(
          { id: 'projectSpace.members.bindAgentTitle' },
          { name: bindingMember?.userName || '' }
        )}
        onCancel={handleCloseAgentModal}
        footer={null}
        width={520}
      >
        {/* 搜索和列表结构直接对齐小详情，加载态统一由下方列表承载。 */}
        <Input.Search
          placeholder={intl.formatMessage({ id: 'projectSpace.members.searchAgent' })}
          value={agentKeyword}
          onChange={(event) => handleAgentKeywordChange(event.target.value)}
          onSearch={handleAgentSearchSubmit}
          enterButton={<SearchOutlined />}
          className={smallDetailStyles.agentSearchInput}
        />
        <Tabs
          activeKey={agentTab}
          onChange={handleAgentTabChange}
          size="small"
          items={[
            { key: 'personal', label: intl.formatMessage({ id: 'projectSpace.members.agentTabPersonal' }) },
            { key: 'group', label: intl.formatMessage({ id: 'projectSpace.members.agentTabGroup' }) },
          ]}
        />
        <Spin spinning={agentLoading}>
          <div className={smallDetailStyles.agentList} onScroll={handleAgentListScroll}>
            {agentOptions.length === 0 ? (
              <Empty description={intl.formatMessage({ id: 'projectSpace.members.emptyAgents' })} />
            ) : (
              <List
                dataSource={agentOptions}
                renderItem={(agent: any) => (
                  <List.Item
                    actions={[
                      <Button key="select" type="link" size="small" onClick={() => void handleBindAgent(agent)}>
                        {intl.formatMessage({ id: 'projectSpace.members.select' })}
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <div className={smallDetailStyles.agentListAvatar}>
                          {getAgentChatAvatar(agent.chatAvatar || agent.avatar || agent.icon || agent.resourceLogoUrl)}
                        </div>
                      }
                      title={agent.resourceName || agent.name || agent.agentName}
                      description={
                        <span
                          className={smallDetailStyles.agentListDescription}
                          title={agent.resourceDesc || agent.description || agent.desc || ''}
                        >
                          {agent.resourceDesc || agent.description || agent.desc || ''}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </Spin>
      </Modal>
    </>
  );
};

export default ProjectMembers;
