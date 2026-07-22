import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Input, List, Modal, Spin, Tag, message } from 'antd';
import { DeleteOutlined, MoreOutlined, PlusOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { addProjectMember, bindMemberAgent, listProjectMembers, removeProjectMember } from '@/service/devloop';
import { POST } from '@/service/common/request';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

interface ProjectMemberListProps {
  projectId?: number;
  creatorId?: string | number;
  onMembersChange?: (members: any[]) => void;
}

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
  const [agentTotal, setAgentTotal] = useState(0);
  const memberSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberQueryVersionRef = useRef(0);

  const fetchMembers = useCallback(async (keyword = '') => {
    if (!projectId) return;
    const queryVersion = memberQueryVersionRef.current + 1;
    memberQueryVersionRef.current = queryVersion;
    setLoading(true);
    try {
      const res = await listProjectMembers(projectId, keyword);
      if (queryVersion !== memberQueryVersionRef.current) return;
      const memberList = Array.isArray(res) ? res : [];
      setMembers(memberList);
      if (!keyword.trim()) onMembersChange?.(memberList);
    } finally {
      if (queryVersion === memberQueryVersionRef.current) {
        setLoading(false);
      }
    }
  }, [onMembersChange, projectId]);

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

  const handleSearchAgent = async (page = 1) => {
    setAgentSearching(true);
    try {
      const res = await POST<any>('/byaiService/api/v2/digitEmploy/discover', {
        keyword: agentKeyword.trim(),
        pageNum: page,
        pageSize: 10,
      });
      const list = res?.data?.list || res?.list || res?.data || [];
      const total = res?.data?.total || res?.total || 0;
      setAgentList(Array.isArray(list) ? list : []);
      setAgentTotal(total);
      setAgentPage(page);
    } catch {
      setAgentList([]);
    } finally {
      setAgentSearching(false);
    }
  };

  const handleOpenAgentModal = (member: any) => {
    setBindingMember(member);
    setAgentKeyword('');
    setAgentList([]);
    setAgentPage(1);
    setAgentTotal(0);
    setShowAgentModal(true);
    setTimeout(() => {
      void handleSearchAgent(1);
    }, 100);
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
      setShowAgentModal(false);
      setBindingMember(null);
    } catch {
      message.error(t('bindFailed'));
    }
  };

  const getMemberKey = (member: any) => `${member.memberId || member.userId || member.userCode || ''}`;

  const getMemberAvatarText = (member: any) => {
    // 成员头像只展示姓名首字，和项目详情内的紧凑圆形图标保持一致。
    const memberName = `${member.userName || member.userId || ''}`.trim();
    return Array.from(memberName)[0] || '?';
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
    <div>
      <div className={styles.detailMemberToolbar}>
        <div className={styles.detailSectionHeader}>
          <span>{t('count', { count: members.length })}</span>
          <Button
            size="small"
            className={styles.detailHeaderActionButton}
            icon={<PlusOutlined />}
            onClick={() => setShowAuthAddModal(true)}
          >
            {t('add')}
          </Button>
        </div>
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
      </div>

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
              dataSource={members}
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
                      <div
                        className={`${styles.detailRequirementIcon} project-member-avatar ${
                          isCreatorMember ? 'project-member-avatar-creator' : 'project-member-avatar-regular'
                        }${showCurrentUserState ? ' project-member-avatar-current-user' : ''}`}
                      >
                        {getMemberAvatarText(member)}
                      </div>
                      <div className={styles.detailRequirementMain}>
                        <div className="project-member-title">
                          <strong className="project-member-name">{member.userName || member.userId}</strong>
                          {/* 创建者标签紧跟成员名称展示，和禁删判断使用同一套规则。 */}
                          {isCreatorMember && (
                            <Tag className="project-member-role-tag" color="blue">
                              {t('creator')}
                            </Tag>
                          )}
                          {showCurrentUserState && (
                            <Tag className="project-member-role-tag" color="green">
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
          </>
        )}
      </Spin>

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
        onCancel={() => {
          setShowAgentModal(false);
          setBindingMember(null);
        }}
        footer={null}
        width={520}
      >
        <Input.Search
          placeholder={t('searchAgent')}
          value={agentKeyword}
          onChange={(event) => setAgentKeyword(event.target.value)}
          onSearch={() => handleSearchAgent(1)}
          enterButton={<SearchOutlined />}
          loading={agentSearching}
          className={styles.agentSearchInput}
        />
        <Spin spinning={agentSearching}>
          <div className={styles.agentList}>
            {agentList.length === 0 ? (
              <Empty description={t('emptyAgents')} />
            ) : (
              <List
                dataSource={agentList}
                pagination={{
                  current: agentPage,
                  pageSize: 10,
                  total: agentTotal,
                  size: 'small',
                  onChange: (page) => handleSearchAgent(page),
                }}
                renderItem={(agent: any) => (
                  <List.Item
                    actions={[
                      <Button key="select" type="link" size="small" onClick={() => handleBindAgent(agent)}>
                        {t('select')}
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<div className={styles.agentListAvatar}>{getAgentChatAvatar(getAgentAvatar(agent))}</div>}
                      title={agent.resourceName || agent.name || agent.agentName}
                      description={agent.description || agent.desc || ''}
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
