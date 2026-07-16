import { useNavigate } from '@umijs/max';
import React, { useEffect } from 'react';
import useGlobal from '@/hooks/useGlobal';

const ProjectSpacePage: React.FC = () => {
  const navigate = useNavigate();
  const { EventEmitter } = useGlobal();

  useEffect(() => {
    // 项目空间不再作为独立内容页展示，直接复用聊天页并打开左侧项目空间小列表。
    EventEmitter.emit('set-sider-active-key', 'projectSpace');
    navigate('/chat', {
      replace: true,
      state: {
        keepSiderActiveKey: 'projectSpace',
      },
    });
  }, [EventEmitter, navigate]);

  return null;
};

export default ProjectSpacePage;
