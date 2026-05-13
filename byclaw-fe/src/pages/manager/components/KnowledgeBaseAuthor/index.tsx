import React from 'react';
import { Drawer } from 'antd';

type Props = {
  drawerTitle?: React.ReactNode;
  visible?: boolean;
  initParams?: Record<string, unknown>;
  onCancel?: () => void;
};

/** 组织管理-关联知识库授权入口（由业务侧接入具体能力） */
export default function KnowledgeBaseAuthor({ drawerTitle, visible, onCancel }: Props) {
  return <Drawer title={drawerTitle} open={visible} onClose={onCancel} width={720} destroyOnHidden />;
}
