import React, { useState } from 'react';
import { DeleteOutlined, EditOutlined, EllipsisOutlined, PlusCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { Dropdown, Input, Modal, message } from 'antd';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import { deleteProject, updateProject } from '@/service/devloop';
import styles from './index.module.less';

interface WorkspaceProjectActionsProps {
  project: ProjectSpace;
  onNewSession: (project: ProjectSpace) => void;
  onRefreshSessions: (project: ProjectSpace) => void;
  onProjectChanged: (project: ProjectSpace, action: 'rename' | 'delete') => void | Promise<void>;
  refreshing?: boolean;
}

const WorkspaceProjectActions: React.FC<WorkspaceProjectActionsProps> = ({
  project,
  onNewSession,
  onRefreshSessions,
  onProjectChanged,
  refreshing = false,
}) => {
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo) || {};
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const currentUserId = userInfo.userId ?? userInfo.id;
  const canManage =
    project.createBy !== undefined &&
    project.createBy !== null &&
    currentUserId !== undefined &&
    currentUserId !== null &&
    `${project.createBy}` === `${currentUserId}`;

  const handleRename = async () => {
    const projectName = renameValue.trim();
    if (!projectName) {
      message.warning(intl.formatMessage({ id: 'projectSpace.message.projectNameRequired' }));
      return;
    }

    setRenameLoading(true);
    try {
      await updateProject({ projectId: Number(project.projectId), projectName });
      message.success(intl.formatMessage({ id: 'projectSpace.message.updateSuccess' }));
      setRenameOpen(false);
      await onProjectChanged(project, 'rename');
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.message.updateFailed' }));
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = () => {
    if (project.projectType === 'default') {
      message.warning(intl.formatMessage({ id: 'projectSpace.message.defaultCannotDelete' }));
      return;
    }

    Modal.confirm({
      title: intl.formatMessage({ id: 'projectSpace.message.deleteConfirmTitle' }),
      content: intl.formatMessage({ id: 'projectSpace.message.deleteConfirmContent' }, { name: project.projectName }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProject(Number(project.projectId));
          message.success(intl.formatMessage({ id: 'projectSpace.message.deleteSuccess' }));
          await onProjectChanged(project, 'delete');
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'projectSpace.message.deleteFailed' }));
        }
      },
    });
  };

  const handleMenuClick = ({ key, domEvent }: any) => {
    domEvent.stopPropagation();
    if (!canManage) return;
    if (key === 'rename') {
      setRenameValue(project.projectName || '');
      setRenameOpen(true);
    }
    if (key === 'delete') handleDelete();
  };

  return (
    <div className={styles.projectActionGroup}>
      {canManage && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'rename',
                icon: <EditOutlined />,
                label: intl.formatMessage({ id: 'common.rename' }),
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: intl.formatMessage({ id: 'projectSpace.message.deleteConfirmTitle' }),
                danger: true,
              },
            ],
            onClick: handleMenuClick,
          }}
        >
          <button
            type="button"
            className={styles.projectActionButton}
            aria-label={intl.formatMessage({ id: 'common.more' })}
            title={intl.formatMessage({ id: 'common.more' })}
            onClick={(event) => event.stopPropagation()}
          >
            <EllipsisOutlined />
          </button>
        </Dropdown>
      )}
      <button
        type="button"
        className={`${styles.projectActionButton} ${styles.projectRefreshButton}`}
        aria-label={intl.formatMessage({ id: 'common.refresh' })}
        title={intl.formatMessage({ id: 'common.refresh' })}
        disabled={refreshing}
        onClick={(event) => {
          event.stopPropagation();
          onRefreshSessions(project);
        }}
      >
        <ReloadOutlined spin={refreshing} />
      </button>
      <button
        type="button"
        className={styles.projectActionButton}
        aria-label={intl.formatMessage({ id: 'workspaceSider.newSession' })}
        title={intl.formatMessage({ id: 'workspaceSider.newSession' })}
        onClick={(event) => {
          event.stopPropagation();
          onNewSession(project);
        }}
      >
        <PlusCircleOutlined />
      </button>

      <Modal
        open={renameOpen}
        title={intl.formatMessage({ id: 'common.rename' })}
        confirmLoading={renameLoading}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        onCancel={() => setRenameOpen(false)}
        onOk={() => void handleRename()}
        destroyOnClose
      >
        <Input
          autoFocus
          maxLength={15}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void handleRename()}
        />
      </Modal>
    </div>
  );
};

export default WorkspaceProjectActions;
