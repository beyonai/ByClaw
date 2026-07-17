import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Empty, Input, List, Modal, Spin, Tag, message } from 'antd';
import { DeleteOutlined, MoreOutlined, PlusOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { addProjectMember, bindMemberAgent, listProjectMembers, removeProjectMember } from '@/service/devloop';
import { POST } from '@/service/common/request';
import { getAgentChatAvatar } from '@/utils/agent';

interface ProjectMemberListProps {
  projectId?: number;
  onMembersChange?: (members: any[]) => void;
}

const ProjectMemberList: React.FC<ProjectMemberListProps> = ({ projectId, onMembersChange }) => {
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
      message.warning('请选择要添加的成员');
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
      message.success(`已添加 ${pendingUsers.length} 个成员`);
      setShowAuthAddModal(false);
      void fetchMembers();
    } catch {
      message.error('添加失败');
    }
  };

  const handleRemove = (member: any) => {
    Modal.confirm({
      title: '移除成员',
      content: `确定要移除「${member.userName || member.userId}」吗？`,
      okText: '移除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeProjectMember(member.memberId);
        message.success('已移除');
        void fetchMembers();
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
      message.success(`已绑定数字员工「${agent.resourceName || agent.name || agent.agentName}」`);
      void fetchMembers();
      setShowAgentModal(false);
      setBindingMember(null);
    } catch {
      message.error('绑定失败');
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
              label: member.agentId ? '更换数字员工' : '绑定数字员工',
            },
            ...(member.role !== 'owner'
              ? [
                {
                  key: 'remove',
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: '移除',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span>{members.length} 个成员</span>
        <Button icon={<PlusOutlined />} onClick={() => setShowAuthAddModal(true)}>
          添加成员
        </Button>
      </div>

      <Spin spinning={loading}>
        {members.length === 0 ? (
          <Empty description="暂无成员" />
        ) : (
          <List
            dataSource={members}
            renderItem={(member: any) => {
              const memberKey = getMemberKey(member);
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
                      <span>
                        {member.userName || member.userId}
                        {member.role === 'owner' && (
                          <Tag className="project-member-role-tag" color="blue">
                            创建者
                          </Tag>
                        )}
                      </span>
                    }
                    description={<span>{member.agentName || '未绑定数字员工'}</span>}
                  />
                  {renderMemberActionMenu(member)}
                </List.Item>
              );
            }}
          />
        )}
      </Spin>

      {showAuthAddModal && (
        <AddAuthModal
          title="新增授权对象"
          onlyUser
          showPost={false}
          value={[]}
          onCancel={() => setShowAuthAddModal(false)}
          onOk={handleAddAuthMembers}
        />
      )}

      <Modal
        title={`为「${bindingMember?.userName || ''}」绑定数字员工`}
        open={showAgentModal}
        onCancel={() => {
          setShowAgentModal(false);
          setBindingMember(null);
        }}
        footer={null}
        width={520}
      >
        <Input.Search
          placeholder="搜索数字员工"
          value={agentKeyword}
          onChange={(event) => setAgentKeyword(event.target.value)}
          onSearch={() => handleSearchAgent(1)}
          enterButton={<SearchOutlined />}
          loading={agentSearching}
          style={{ marginBottom: 16 }}
        />
        <Spin spinning={agentSearching}>
          <div style={{ height: 400, overflowY: 'auto' }}>
            {agentList.length === 0 ? (
              <Empty description="暂无数字员工" />
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
                        选择
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<div style={{ width: 40, height: 40 }}>{getAgentChatAvatar(getAgentAvatar(agent))}</div>}
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
