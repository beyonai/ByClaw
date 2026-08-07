import { Avatar, Button, Empty, Spin, Tag, Typography, message } from 'antd';
import { ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';
import { listProjectMembers } from '@/service/devloop';
import type { ProjectMember, ProjectSpace } from '../../types';
import { getArrayData } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

const PAGE_SIZE = 20;

const ProjectMembers: React.FC<Props> = ({ project, keyword = '', onToolbarChange }) => {
  const intl = useIntl();
  const [allMembers, setAllMembers] = useState<ProjectMember[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const initialLoadProjectRef = useRef<string | null>(null);

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

  useEffect(() => {
    const projectKey = `${project.projectId}`;
    // React 严格模式下避免成员 Tab 首次挂载重复请求。
    if (initialLoadProjectRef.current === projectKey) return;
    initialLoadProjectRef.current = projectKey;
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    onToolbarChange?.(
      <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadMembers()}>
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => onToolbarChange?.(null);
  }, [intl, loadMembers, loading, onToolbarChange]);

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
    <div className={styles.dataPanel}>
      <Spin spinning={loading}>
        {visibleMembers.length ? (
          <div className={styles.dataCardGrid}>
            {visibleMembers.map((member) => {
              const isOwner = `${member.role || ''}`.toLowerCase() === 'owner';
              return (
                <article key={`${member.memberId || member.userId}`} className={styles.dataCard}>
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
  );
};

export default ProjectMembers;
