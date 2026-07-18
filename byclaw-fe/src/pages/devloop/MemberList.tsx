import React, { useState, useEffect, useCallback } from 'react';
import { Button, List, Avatar, Tag, Modal, Input, message, Empty, Spin } from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined, RobotOutlined } from '@ant-design/icons';
import { useSelector } from '@umijs/max';
import { listProjectMembers, addProjectMember, removeProjectMember, bindMemberAgent } from '@/service/devloop';
import { POST } from '@/service/common/request';

interface MemberListProps {
  projectId?: number;
  creatorId?: string | number;
}

const getMemberUserId = (member: any) => member.userId ?? String(member.id || '').replace(/^user_/, '');

const isProjectOwnerMember = (member: any, creatorId?: string | number) => {
  // 新老数据都兼容：新数据有 owner role，老数据用项目创建人 ID 兜底。
  const isOwnerRole = ['owner', 'creator'].includes(`${member?.role || ''}`.toLowerCase());
  return isOwnerRole || (!!creatorId && `${getMemberUserId(member)}` === `${creatorId}`);
};

const MemberList: React.FC<MemberListProps> = ({ projectId, creatorId }) => {
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // 绑定数字员工
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [bindingMember, setBindingMember] = useState<any>(null);
  const [agentKeyword, setAgentKeyword] = useState('');
  const [agentList, setAgentList] = useState<any[]>([]);
  const [agentSearching, setAgentSearching] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await listProjectMembers(projectId);
      if (res) setMembers(res);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleSearch = async () => {
    if (!searchKeyword.trim()) return;
    setSearching(true);
    try {
      const res = await POST<any>('/byaiService/auth/privilegeGrant/findAll', {
        keyword: searchKeyword.trim(),
        pageSize: 10,
        pageNum: 1,
      });
      const users = res?.data?.userList || res?.userList || [];
      setSearchResults(
        users.map((u: any) => ({
          userId: String(u.userId),
          userName: u.userName,
          userCode: u.userCode || '',
          pathName: u.pathName || '',
        }))
      );
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (user: any) => {
    if (!projectId) return;
    try {
      await addProjectMember({ projectId, userId: user.userId, userCode: user.userCode, userName: user.userName });
      message.success(`已添加 ${user.userName}`);
      fetchMembers();
      setShowAddModal(false);
      setSearchKeyword('');
      setSearchResults([]);
    } catch {
      message.error('添加失败');
    }
  };

  const isCurrentUserMember = (member: any) => {
    return (
      (!!member.userId && `${member.userId}` === `${userInfo.userId || ''}`) ||
      (!!member.userCode && `${member.userCode}` === `${userInfo.userCode || ''}`)
    );
  };

  const handleRemove = (member: any) => {
    if (isProjectOwnerMember(member, creatorId)) {
      message.warning('创建者不能被删除');
      return;
    }

    Modal.confirm({
      title: isCurrentUserMember(member) ? '移除自己' : '移除成员',
      content: isCurrentUserMember(member)
        ? '移除自己后将无法继续访问该项目，确定移除吗？'
        : `确定要移除「${member.userName || member.userId}」吗？`,
      okText: '移除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeProjectMember(member.memberId);
        message.success('已移除');
        fetchMembers();
      },
    });
  };

  // 搜索数字员工
  const [agentPage, setAgentPage] = useState(1);
  const [agentTotal, setAgentTotal] = useState(0);

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
      handleSearchAgent(1);
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
      fetchMembers();
      setShowAgentModal(false);
      setBindingMember(null);
    } catch {
      message.error('绑定失败');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span>{members.length} 个成员</span>
        <Button icon={<PlusOutlined />} onClick={() => setShowAddModal(true)}>
          添加
        </Button>
      </div>

      <Spin spinning={loading}>
        {members.length === 0 ? (
          <Empty description="暂无成员" />
        ) : (
          <List
            dataSource={members}
            renderItem={(member: any) => {
              const isCreatorMember = isProjectOwnerMember(member, creatorId);
              return (
                <List.Item
                  actions={[
                    <Button
                      key="bind"
                      type="link"
                      size="small"
                      icon={<RobotOutlined />}
                      onClick={() => handleOpenAgentModal(member)}
                    >
                      {member.agentId ? '更换数字员工' : '绑定数字员工'}
                    </Button>,
                    ...(!isCreatorMember
                      ? [
                        <Button
                          key="remove"
                          type="link"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => handleRemove(member)}
                        >
                          移除
                        </Button>,
                      ]
                      : []),
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar style={{ background: isCreatorMember ? '#1677ff' : '#87d068' }}>
                        {(member.userName || '?')[0]}
                      </Avatar>
                    }
                    title={
                      <span style={{ display: 'inline-flex', maxWidth: '100%', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            minWidth: 0,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {member.userName || member.userId}
                        </span>
                        {/* 创建者标签紧跟成员名称展示，和禁删判断使用同一套规则。 */}
                        {isCreatorMember && <Tag color="blue">创建者</Tag>}
                      </span>
                    }
                    description={
                      <span>
                        {member.userCode || ''}
                        {member.agentName ? ` · 数字员工: ${member.agentName}` : ' · 未绑定数字员工'}
                      </span>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Spin>

      {/* 添加成员弹窗 */}
      <Modal
        title="添加成员"
        open={showAddModal}
        onCancel={() => {
          setShowAddModal(false);
          setSearchKeyword('');
          setSearchResults([]);
        }}
        footer={null}
        width={480}
      >
        <Input.Search
          placeholder="输入姓名或工号搜索"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onSearch={handleSearch}
          enterButton={<SearchOutlined />}
          loading={searching}
          style={{ marginBottom: 16 }}
        />
        {searchResults.length > 0 && (
          <List
            dataSource={searchResults}
            renderItem={(user: any) => {
              const alreadyMember = members.some((m) => m.userId === user.userId);
              return (
                <List.Item
                  actions={[
                    alreadyMember ? (
                      <Tag key="joined">已加入</Tag>
                    ) : (
                      <Button key="add" type="link" size="small" onClick={() => handleAdd(user)}>
                        添加
                      </Button>
                    ),
                  ]}
                >
                  <List.Item.Meta
                    avatar={<Avatar>{(user.userName || '?')[0]}</Avatar>}
                    title={user.userName}
                    description={`${user.userCode || ''} ${user.pathName || ''}`}
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Modal>

      {/* 绑定数字员工弹窗 */}
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
          onChange={(e) => setAgentKeyword(e.target.value)}
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
                      avatar={<Avatar icon={<RobotOutlined />} src={agent.avatar || agent.icon} />}
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

export default MemberList;
