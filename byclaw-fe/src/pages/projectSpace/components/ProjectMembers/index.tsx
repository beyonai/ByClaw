import { Avatar, Button, Dropdown, Empty, Input, Modal, Spin, Tag, Typography, message } from 'antd';
import {
  DeleteOutlined,
  DisconnectOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import OrgUserSelector from '@/components/OrgUserSelector';
import type { UserItem } from '@/components/OrgUserSelector/types';
import { bindMemberAgent, listProjectMembers, saveProjectMembers, unbindMemberAgent } from '@/service/devloop';
import { POST } from '@/service/common/request';
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

const ProjectMembers: React.FC<Props> = ({ project, keyword = '', onToolbarChange, onRefreshToolbarChange }) => {
  const intl = useIntl();
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const currentUserId = userInfo.userId ?? userInfo.id;
  const [allMembers, setAllMembers] = useState<ProjectMember[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [bindingMember, setBindingMember] = useState<ProjectMember | null>(null);
  const [agentKeyword, setAgentKeyword] = useState('');
  const [agentOptions, setAgentOptions] = useState<any[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const initialLoadProjectRef = useRef<string | null>(null);
  const isProjectCreator = useMemo(
    () => currentUserId !== undefined && `${currentUserId}` === `${project.createBy}`,
    [currentUserId, project.createBy]
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

  const handleAddMember = useCallback(
    async (user: UserItem) => {
      const exists = allMembers.some((member) => `${member.userId}` === `${user.userId}`);
      if (exists) {
        message.warning(`${user.userName} 已是项目成员`);
        return;
      }
      if (!project.projectId || addingMember) return;
      setAddingMember(true);
      try {
        await POST('/byaiService/project/member/add', {
          projectId: Number(project.projectId),
          userId: user.userId,
          userCode: user.userCode,
          userName: user.userName,
        });
        message.success(intl.formatMessage({ id: 'projectSpace.members.addSuccess' }, { count: 1 }));
        setAddMemberOpen(false);
        await loadMembers();
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'projectSpace.members.addFailed' }));
      } finally {
        setAddingMember(false);
      }
    },
    [allMembers, addingMember, intl, loadMembers, project.projectId]
  );

  // 大详情成员卡片复用小详情的两个操作：绑定数字员工和移除成员。
  const loadAgentOptions = useCallback(async (keyword = '') => {
    setAgentLoading(true);
    try {
      const response = await POST<any>('/byaiService/api/v2/digitEmploy/discover', {
        keyword: keyword.trim(),
        pageNum: 1,
        pageSize: 50,
      });
      const list = response?.data?.list || response?.list || response?.data || [];
      setAgentOptions(Array.isArray(list) ? list : []);
    } catch (error: any) {
      message.error(error?.message || '数字员工加载失败');
      setAgentOptions([]);
    } finally {
      setAgentLoading(false);
    }
  }, []);

  const handleBindAgent = useCallback(
    async (agent: any) => {
      if (!bindingMember?.memberId) return;
      try {
        await bindMemberAgent({
          memberId: Number(bindingMember.memberId),
          agentId: Number(agent.resourceId ?? agent.agentId ?? agent.id),
        });
        message.success('数字员工绑定成功');
        setBindingMember(null);
        await loadMembers();
      } catch (error: any) {
        message.error(error?.message || '数字员工绑定失败');
      }
    },
    [bindingMember, loadMembers]
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
      <div className={styles.headerActions}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAddMemberOpen(true)}>
          {intl.formatMessage({ id: 'projectSpace.members.addMember' })}
        </Button>
      </div>
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
  }, [intl, loadMembers, loading, onRefreshToolbarChange, onToolbarChange]);

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
                const canOperate = isProjectCreator || isCurrentUserMember(member);
                return (
                  <article key={`${member.memberId || member.userId}`} className={styles.dataCard} tabIndex={canOperate ? 0 : -1}>
                    <div className={styles.memberCardIdentity}>
                      <Avatar src={member.avatar} icon={<UserOutlined />} />
                      <div className={styles.memberCardName}>
                        <Typography.Text strong ellipsis>
                          {member.userName || member.userCode || `${member.userId}`}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis>
                          {member.userCode || `${member.userId}`}
                        </Typography.Text>
                      </div>
                    </div>
                    <Tag className={styles.memberRoleTag} color={isOwner ? 'gold' : 'default'}>
                      {isOwner
                        ? intl.formatMessage({ id: 'projectSpace.members.owner' })
                        : intl.formatMessage({ id: 'projectSpace.members.member' })}
                    </Tag>
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
                              setBindingMember(member);
                              setAgentKeyword('');
                              void loadAgentOptions();
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
      <Modal
        open={addMemberOpen}
        title={intl.formatMessage({ id: 'projectSpace.members.addMember' })}
        footer={null}
        width={760}
        destroyOnClose
        onCancel={() => setAddMemberOpen(false)}
      >
        <Spin spinning={addingMember}>
          <OrgUserSelector onSelect={(user) => void handleAddMember(user)} />
        </Spin>
      </Modal>
      <Modal
        open={!!bindingMember}
        title={`${bindingMember?.userName || ''} · 绑定数字员工`}
        onCancel={() => setBindingMember(null)}
        footer={null}
        destroyOnClose
      >
        <Input.Search
          allowClear
          placeholder="搜索数字员工"
          value={agentKeyword}
          onChange={(event) => {
            const value = event.target.value;
            setAgentKeyword(value);
            void loadAgentOptions(value);
          }}
          onSearch={(value) => void loadAgentOptions(value)}
        />
        <Spin spinning={agentLoading}>
          <div className={styles.memberAgentOptions}>
            {agentOptions.map((agent) => (
              <Button
                key={`${agent.resourceId ?? agent.agentId ?? agent.id}`}
                className={styles.memberAgentOption}
                onClick={() => void handleBindAgent(agent)}
              >
                {agent.agentName || agent.resourceName || agent.name || agent.resourceId}
              </Button>
            ))}
          </div>
        </Spin>
      </Modal>
    </>
  );
};

export default ProjectMembers;
