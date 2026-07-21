import React, { useCallback, useEffect, useState } from 'react';
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

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await listProjectMembers(projectId);
      const memberList = Array.isArray(res) ? res : [];
      setMembers(memberList);
      onMembersChange?.(memberList);
    } finally {
      setLoading(false);
    }
  }, [onMembersChange, projectId]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  const handleAddAuthMembers = async (selectedUsers: any[] = []) => {
    if (!projectId) return;

    // 左侧小列表使用授权对象弹窗选人，确认时只提交新增且尚未加入项目的人员。
    const currentMemberIdSet = new Set(members.map((member) => String(member.userId)));
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
      void fetchMembers();
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
    void fetchMembers();
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
      void fetchMembers();
      setShowAgentModal(false);
      setBindingMember(null);
    } catch {
      message.error(t('bindFailed'));
    }
  };

  const getMemberKey = (member: any) => `${member.memberId || member.userId || member.userCode || ''}`;

  const getMemberAvatarText = (member: any) => {
    const memberName = `${member.userName || member.userId || '?'}`;
    return memberName.slice(-2);
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

      <Spin spinning={loading}>
        {members.length === 0 ? (
          // 成员空态与需求 Tab 统一使用简洁图标，保持项目详情各列表的视觉一致。
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty')} />
        ) : (
          <>
            {/* 成员列表复用任务 Tab 的无分隔线紧凑行样式。 */}
            <List
              split={false}
              dataSource={members}
              renderItem={(member: any) => {
                const memberKey = getMemberKey(member);
                const isCreatorMember = isProjectOwnerMember(member, creatorId);
                return (
                  <List.Item
                    className="project-member-row"
                    onMouseEnter={() => setHoveredMemberKey(memberKey)}
                    onMouseLeave={() => {
                      if (openActionMemberKey !== memberKey) {
                        setHoveredMemberKey(undefined);
                      }
                    }}
                  >
                    <List.Item.Meta
                      avatar={<div className="project-member-avatar">{getMemberAvatarText(member)}</div>}
                      title={
                        <span className="project-member-title">
                          <span className={`${styles.projectMemberName} project-member-name`}>
                            {member.userName || member.userId}
                          </span>
                          {/* 创建者标签紧跟成员名称展示，和禁删判断使用同一套规则。 */}
                          {isCreatorMember && (
                            <Tag className="project-member-role-tag" color="blue">
                              {t('creator')}
                            </Tag>
                          )}
                        </span>
                      }
                      description={
                        <span className={styles.projectMemberDescription}>{member.agentName || t('unboundAgent')}</span>
                      }
                    />
                    {renderMemberActionMenu(member)}
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
