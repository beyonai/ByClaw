import { useNavigate } from '@umijs/max';
import React, { useEffect } from 'react';
import useGlobal from '@/hooks/useGlobal';

const ProjectSpacePage: React.FC = () => {
  const navigate = useNavigate();
  const { EventEmitter } = useGlobal();

  useEffect(() => {
    // 项目空间不再作为独立内容页展示，直接复用聊天页并打开左侧项目空间小列表。
    // 兼容旧项目空间路由，跳转后激活已合入项目会话列表的会话入口。
    EventEmitter.emit('set-sider-active-key', 'sessions');
    navigate('/chat', {
      replace: true,
      state: {
        // 项目空间已合入会话侧栏，保留旧路由时也回到会话入口。
        keepSiderActiveKey: 'sessions',
      },
    });
  }, [EventEmitter, navigate]);

  return null;
};

export default ProjectSpacePage;
