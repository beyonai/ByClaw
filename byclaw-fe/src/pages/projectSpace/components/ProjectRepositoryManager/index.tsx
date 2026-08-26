import { Form, Input, Modal, Radio, Select, Space, message } from 'antd';
import { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
  createProjectRepo,
  updateProjectRepo,
  type DevloopProjectRepo,
  type ProjectRepoType,
  type RepoProvider,
} from '@/service/devloop';
import type { ProjectSpace } from '../../types';

interface Props {
  project: ProjectSpace;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  editingRepo?: DevloopProjectRepo;
}

type RepoFormValues = {
  repoType: ProjectRepoType;
  provider: RepoProvider;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  description?: string;
};

// 研发、运营资源 Tab 的仓库入口只负责新增/编辑，仓库列表直接展示在资源卡片中。
const ProjectRepositoryManager: React.FC<Props> = ({ project, open, onClose, onChanged, editingRepo }) => {
  const intl = useIntl();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<RepoFormValues>();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      editingRepo
        ? {
          repoType: editingRepo.repoType || 'code',
          provider: editingRepo.provider || 'github',
          repoFullName: editingRepo.repoFullName,
          repoUrl: editingRepo.repoUrl || undefined,
          defaultBranch: editingRepo.defaultBranch || 'main',
          description: editingRepo.description || undefined,
        }
        : { repoType: 'code', provider: 'github', defaultBranch: 'main' }
    );
  }, [editingRepo, form, open]);

  const handleCreate = async (values: RepoFormValues) => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = { projectId: Number(project.projectId), ...values };
      if (editingRepo?.repoId !== undefined && editingRepo?.repoId !== null) {
        await updateProjectRepo({ repoId: Number(editingRepo.repoId), ...payload });
        message.success(intl.formatMessage({ id: 'projectSpace.repository.saveSuccess' }));
      } else {
        await createProjectRepo(payload);
        message.success(intl.formatMessage({ id: 'projectSpace.repository.addSuccess' }));
      }
      form.resetFields();
      onChanged?.();
      onClose();
    } catch (error: any) {
      message.error(
        error?.message ||
          intl.formatMessage({
            id: editingRepo ? 'projectSpace.repository.saveFailed' : 'projectSpace.repository.addFailed',
          })
      );
    } finally {
      setSaving(false);
    }
  };

  // 新增和编辑共用弹窗底部操作区，保存按钮固定在右下角，不占用表单内容布局。
  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: editingRepo ? 'projectSpace.repository.edit' : 'projectSpace.repository.add' })}
      width={760}
      okText={intl.formatMessage({ id: 'common.save' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={saving}
      destroyOnClose
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ repoType: 'code', provider: 'github', defaultBranch: 'main' }}
        onFinish={(values) => void handleCreate(values)}
        style={{ marginTop: 18 }}
      >
        <Form.Item
          label={intl.formatMessage({ id: 'projectSpace.repository.type' })}
          name="repoType"
          rules={[{ required: true }]}
        >
          <Radio.Group
            options={[
              { value: 'workspace', label: intl.formatMessage({ id: 'projectSpace.repository.type.workspace' }) },
              { value: 'code', label: intl.formatMessage({ id: 'projectSpace.repository.type.code' }) },
            ]}
          />
        </Form.Item>
        <Space.Compact block>
          <Form.Item
            label={intl.formatMessage({ id: 'projectSpace.repository.provider' })}
            name="provider"
            rules={[{ required: true }]}
            style={{ width: '30%' }}
          >
            <Select
              options={[
                { value: 'github', label: 'GitHub' },
                { value: 'gitlab', label: 'GitLab' },
                { value: 'gitea', label: 'Gitea' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'projectSpace.repository.name' })}
            name="repoFullName"
            rules={[{ required: true }]}
            style={{ width: '70%' }}
          >
            <Input placeholder="owner/repository" />
          </Form.Item>
        </Space.Compact>
        <Form.Item label={intl.formatMessage({ id: 'projectSpace.repository.url' })} name="repoUrl">
          <Input />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'projectSpace.repository.defaultBranch' })} name="defaultBranch">
          <Input />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'projectSpace.repository.description' })} name="description">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ProjectRepositoryManager;
