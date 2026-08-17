import React, { useState } from 'react';
import { DeleteOutlined, EditOutlined, EllipsisOutlined } from '@ant-design/icons';
import { Dropdown, Input, Modal } from 'antd';
// @ts-ignore
import { useDispatch, useIntl } from '@umijs/max';
import type { ProjectSession } from '@/pages/projectSpace/types';
import styles from './index.module.less';

interface WorkspaceSessionActionsProps {
  session: ProjectSession;
  onEdited: (sessionName: string) => void;
  onDeleted: () => void;
}

const WorkspaceSessionActions: React.FC<WorkspaceSessionActionsProps> = ({ session, onEdited, onDeleted }) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const handleEdit = async () => {
    const sessionName = editValue.trim();
    if (!sessionName || editLoading) return;

    setEditLoading(true);
    try {
      const editedSessionId = await Promise.resolve(
        dispatch({
          type: 'session/editSession',
          payload: { sessionId: `${session.sessionId}`, sessionName },
        })
      );
      if (!editedSessionId) return;
      onEdited(sessionName);
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = () => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'common.deleteTips' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        const deletedSessionId = await Promise.resolve(
          dispatch({
            type: 'session/deleteSession',
            payload: { sessionId: `${session.sessionId}` },
          })
        );
        if (deletedSessionId) onDeleted();
      },
    });
  };

  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            {
              key: 'edit',
              icon: <EditOutlined />,
              label: intl.formatMessage({ id: 'common.edit' }),
            },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: intl.formatMessage({ id: 'common.delete' }),
              danger: true,
            },
          ],
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === 'edit') {
              setEditValue(session.sessionName || '');
              setEditOpen(true);
            }
            if (key === 'delete') handleDelete();
          },
        }}
      >
        <button
          type="button"
          className={styles.sessionMoreButton}
          aria-label={intl.formatMessage({ id: 'common.more' })}
          title={intl.formatMessage({ id: 'common.more' })}
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisOutlined />
        </button>
      </Dropdown>

      <Modal
        open={editOpen}
        title={intl.formatMessage({ id: 'common.edit' })}
        confirmLoading={editLoading}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        okButtonProps={{ disabled: !editValue.trim() }}
        onCancel={() => setEditOpen(false)}
        onOk={() => void handleEdit()}
        destroyOnClose
      >
        <Input
          autoFocus
          maxLength={20}
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onPressEnter={() => void handleEdit()}
        />
      </Modal>
    </>
  );
};

export default WorkspaceSessionActions;
