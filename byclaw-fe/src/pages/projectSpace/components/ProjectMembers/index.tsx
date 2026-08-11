import { Button, Dropdown, Empty, Input, List, Modal, Spin, Tag, Typography, message } from 'antd';
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
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

const PAGE_SIZE = 20;
const AGENT_PAGE_SIZE = 10;

const getMemberAvatarText = (member: ProjectMember) =>
  getDisplayUserNameInChat(`${member.userName || member.userCode || member.userId || ''}`.trim()) || '?';

const ProjectMembers: React.FC<Props> = ({ project, keyword = '', onToolbarChange, onRefreshToolbarChange }) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const currentUserId = userInfo.userId ?? userInfo.id;
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
  const initialLoadProjectRef = useRef<string | null>(null);
  const savingMembersRef = useRef(false);
  const agentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentQueryVersionRef = useRef(0);
  const agentLoadingMoreRef = useRef(false);
  const isProjectCreator = useMemo(
    () =>
      currentUserId !== undefined &&
      (`${currentUserId}` === `${project.createBy}` ||
        allMembers.some(
          (member) =>
            `${member.userId}` === `${currentUserId}` &&
            ['owner', 'creator'].includes(`${member.role || ''}`.toLowerCase())
        )),
    [allMembers, currentUserId, project.createBy]
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

  const loadAgentOptions = useCallback(async (page = 1, keyword = '', append = false) => {
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
        message.error(error?.message || '数字员工加载失败');
      }
    } finally {
      if (append && queryVersion === agentQueryVersionRef.current) {
        agentLoadingMoreRef.current = false;
      }
      if (queryVersion === agentQueryVersionRef.current) {
        setAgentLoading(false);
      }
    }
  }, []);

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
        void loadAgentOptions(1, keyword);
      }, 300);
    },
    [clearAgentSearchTimer, loadAgentOptions]
  );

  const handleAgentSearchSubmit = useCallback(
    (keyword: string) => {
      clearAgentSearchTimer();
      setAgentKeyword(keyword);
      void loadAgentOptions(1, keyword);
    },
    [clearAgentSearchTimer, loadAgentOptions]
  );

  const handleAgentListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMoreAgents || agentLoading || agentLoadingMoreRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      if (scrollHeight - scrollTop - clientHeight > 80) return;
      void loadAgentOptions(agentPage + 1, agentKeyword, true);
    },
    [agentKeyword, agentLoading, agentPage, hasMoreAgents, loadAgentOptions]
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
      void loadAgentOptions(1, '');
    },
    [clearAgentSearchTimer, loadAgentOptions]
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
        title: '解绑数字员工',
        content: `确定解除“${member.userName || member.userCode || member.userId}”当前绑定的数字员工吗？`,
        okText: '确定解绑',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await unbindMemberAgent(Number(member.memberId));
            message.success('数字员工解绑成功');
            await loadMembers();
          } catch (error: any) {
            message.error(error?.message || '数字员工解绑失败');
          }
        },
      });
    },
    [loadMembers]
  );

  const handleRemoveMember = useCallback(
    (member: ProjectMember) => {
      if (!isProjectCreator || `${member.userId}` === `${project.createBy}`) {
        message.warning('项目创建者不能被移除');
        return;
      }
      Modal.confirm({
        title: '移除项目成员',
        content: `确定移除成员“${member.userName || member.userId}”吗？`,
        okText: '移除',
        okButtonProps: { danger: true },
        onOk: async () => {
          const remaining = allMembers
            .filter((item) => `${item.userId}` !== `${member.userId}`)
            .map((item) => item.userId);
          await saveProjectMembers({ projectId: Number(project.projectId), userIds: remaining });
          message.success('成员已移除');
          await loadMembers();
        },
      });
    },
    [allMembers, isProjectCreator, loadMembers, project.createBy, project.projectId]
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
          <Button size="small" icon={<PlusOutlined />} loading={addMemberLoading} onClick={handleOpenAddMember}>
            {intl.formatMessage({ id: 'projectSpace.members.addMember' })}
          </Button>
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
                  <article key={`${member.memberId || member.userId}`} className={styles.dataCard} tabIndex={canOperate ? 0 : -1}>
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
                    <Tag className={styles.memberRoleTag} color={isOwner ? 'gold' : isCurrentUser ? 'blue' : 'default'}>
                      {isOwner
                        ? intl.formatMessage({ id: 'projectSpace.members.owner' })
                        : isCurrentUser
                          ? intl.formatMessage({ id: 'projectSpace.members.currentUser' })
                          : intl.formatMessage({ id: 'projectSpace.members.member' })}
                    </Tag>
                    <div className={styles.memberCardMeta}>
                      <Typography.Text className={styles.memberCardAgent} type="secondary" ellipsis>
                        <span>{member.agentName || '未绑定数字员工'}</span>
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
                              label: member.agentId ? '更换数字员工' : '绑定数字员工',
                            },
                            ...(member.agentId
                              ? [
                                {
                                  key: 'unbind-agent',
                                  danger: true,
                                  icon: <DisconnectOutlined />,
                                  label: '解绑数字员工',
                                },
                              ]
                              : []),
                            ...(isProjectCreator && !isOwner
                              ? [{ key: 'remove-member', danger: true, icon: <DeleteOutlined />, label: '移除成员' }]
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
                          {getAgentChatAvatar(
                            agent.chatAvatar || agent.avatar || agent.icon || agent.resourceLogoUrl
                          )}
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
