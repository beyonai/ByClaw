import { Button, Empty, List, Space, Tag, Typography } from 'antd';
import { MessageOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ProjectSession } from '../../types';
import styles from '../../index.module.less';

interface Props {
  sessions: ProjectSession[];
  loading?: boolean;
  onRefresh?: () => void;
  onOpenSession?: (session: ProjectSession) => void;
}

const ProjectSessionList: React.FC<Props> = ({ sessions, loading, onRefresh, onOpenSession }) => {
  if (!sessions.length) {
    return (
      <div className={styles.sessionEmpty}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>
          刷新会话
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.sessionListWrap}>
      <div className={styles.sessionToolbar}>
        <Typography.Text type="secondary">共 {sessions.length} 个会话</Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>
          刷新
        </Button>
      </div>
      <List
        dataSource={sessions}
        renderItem={(session) => (
          <List.Item
            className={styles.sessionItem}
            actions={[
              <Button
                key="open"
                type="link"
                size="small"
                icon={<MessageOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSession?.(session);
                }}
              >
                打开会话
              </Button>,
            ]}
            onClick={() => onOpenSession?.(session)}
          >
            <List.Item.Meta
              title={
                <Space size={8}>
                  <span>{session.sessionName}</span>
                  {session.taskId ? <Tag bordered={false}>任务会话</Tag> : null}
                </Space>
              }
              description={session.sessionContent || '暂无会话摘要'}
            />
            <Tag bordered={false}>{session.fileCount || 0} 文件</Tag>
          </List.Item>
        )}
      />
    </div>
  );
};

export default ProjectSessionList;
