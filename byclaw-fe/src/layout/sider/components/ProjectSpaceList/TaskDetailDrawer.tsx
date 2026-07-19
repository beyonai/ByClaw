import React from 'react';
import { Drawer, Tag, Descriptions, Button } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useNavigate } from '@umijs/max';
import { useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  onRefresh: () => void;
}

// 任务状态色（与看板、卡片保持一致）
const STATUS_COLORS: Record<string, string> = {
  待开始: 'default',
  进行中: 'blue',
  暂停: 'orange',
  完成: 'green',
};

// 会话即任务后，状态存于 byai_session_ext 且看板只读，这里仅展示不提供修改入口。
const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({ task, onClose }) => {
  const navigate = useNavigate();
  const { setSessionId } = useGlobal();
  const userInfo = useSelector(({ user }: any) => user.userInfo);

  const isMyTask = task?.createBy && userInfo?.userId && String(task.createBy) === String(userInfo.userId);

  const handleGoToChat = () => {
    if (!task?.sessionId) return;
    setSessionId?.(String(task.sessionId));
    navigate('/chat');
    onClose();
  };

  return (
    <Drawer title={task?.title || '任务详情'} open={!!task} onClose={onClose} width={640}>
      {task && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="状态">
              {task.status ? <Tag color={STATUS_COLORS[task.status] || 'default'}>{task.status}</Tag> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{task.createTime || '-'}</Descriptions.Item>
            <Descriptions.Item label="负责人">{task.assignee || '我'}</Descriptions.Item>
          </Descriptions>

          {isMyTask && task.sessionId && (
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Button type="primary" icon={<MessageOutlined />} onClick={handleGoToChat}>
                进入会话
              </Button>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
};

export default TaskDetailDrawer;
