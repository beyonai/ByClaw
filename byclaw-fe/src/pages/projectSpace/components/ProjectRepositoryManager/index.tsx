import { Button, Empty, Form, Input, List, Modal, Radio, Select, Space, Spin, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import {
  createProjectRepo,
  deleteProjectRepo,
  listProjectRepos,
  startProjectInit,
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
}

type RepoFormValues = {
  repoType: ProjectRepoType;
  provider: RepoProvider;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  description?: string;
};

const SKILL_PACKAGES = [
  { value: 'trellis', label: 'trellis' },
  { value: 'superpowers', label: 'superpowers' },
];

// 大详情沿用小详情的仓库管理能力：支持仓库增删，并在工作区仓库上提供初始化入口。
const ProjectRepositoryManager: React.FC<Props> = ({ project, open, onClose, onChanged }) => {
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<RepoFormValues>();
  const [initOpen, setInitOpen] = useState(false);
  const [initSaving, setInitSaving] = useState(false);
  const [buildIndex, setBuildIndex] = useState(false);
  const [skillPackages, setSkillPackages] = useState<string[]>([]);

  const loadRepos = useCallback(async () => {
    if (!project.projectId) return;
    setLoading(true);
    try {
      const result = await listProjectRepos(Number(project.projectId));
      setRepos(Array.isArray(result) ? result : []);
    } catch (error: any) {
      message.error(error?.message || '仓库加载失败');
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, [project.projectId]);

  useEffect(() => {
    if (open) void loadRepos();
  }, [loadRepos, open]);

  const handleCreate = async (values: RepoFormValues) => {
    if (saving) return;
    setSaving(true);
    try {
      await createProjectRepo({ projectId: Number(project.projectId), ...values });
      message.success('仓库已添加');
      form.resetFields();
      await loadRepos();
      onChanged?.();
    } catch (error: any) {
      message.error(error?.message || '仓库添加失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (repo: DevloopProjectRepo) => {
    Modal.confirm({
      title: '删除项目仓库',
      content: `确定删除“${repo.repoFullName || repo.repoUrl || repo.repoId}”吗？`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProjectRepo(Number(repo.repoId));
          message.success('仓库已删除');
          await loadRepos();
          onChanged?.();
        } catch (error: any) {
          message.error(error?.message || '仓库删除失败');
        }
      },
    });
  };

  const handleInit = async () => {
    if (initSaving) return;
    setInitSaving(true);
    try {
      await startProjectInit({
        projectId: Number(project.projectId),
        buildIndex,
        skillPackages: buildIndex ? skillPackages : [],
      });
      message.success('工作区初始化已启动');
      setInitOpen(false);
      onChanged?.();
    } catch (error: any) {
      message.error(error?.message || '工作区初始化失败');
    } finally {
      setInitSaving(false);
    }
  };

  return (
    <>
      <Modal open={open} title="项目仓库管理" width={760} footer={null} destroyOnClose onCancel={onClose}>
        <Spin spinning={loading}>
          {repos.length ? (
            <List
              size="small"
              dataSource={repos}
              renderItem={(repo) => (
                <List.Item
                  actions={[
                    ...(project.projectType === 'develop' && repo.repoType === 'workspace'
                      ? [
                        <Button
                          key="init"
                          type="link"
                          size="small"
                          icon={<ThunderboltOutlined />}
                          onClick={() => setInitOpen(true)}
                        >
                          初始化工作区
                        </Button>,
                      ]
                      : []),
                    <Button
                      key="delete"
                      type="link"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(repo)}
                    >
                      删除
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span>{repo.repoFullName || repo.repoUrl || repo.repoId}</span>
                        <Tag color={repo.repoType === 'workspace' ? 'blue' : 'default'}>
                          {repo.repoType === 'workspace' ? '工作区' : '代码仓库'}
                        </Tag>
                      </Space>
                    }
                    description={
                      [repo.repoUrl, repo.defaultBranch, repo.description].filter(Boolean).join(' · ') || '-'
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目仓库" />
          )}
        </Spin>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ repoType: 'code', provider: 'github', defaultBranch: 'main' }}
          onFinish={(values) => void handleCreate(values)}
          style={{ marginTop: 18 }}
        >
          <Form.Item label="仓库类型" name="repoType" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: 'workspace', label: '工作区' },
                { value: 'code', label: '代码仓库' },
              ]}
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item label="代码平台" name="provider" rules={[{ required: true }]} style={{ width: '30%' }}>
              <Select
                options={[
                  { value: 'github', label: 'GitHub' },
                  { value: 'gitlab', label: 'GitLab' },
                  { value: 'gitea', label: 'Gitea' },
                ]}
              />
            </Form.Item>
            <Form.Item label="仓库名称" name="repoFullName" rules={[{ required: true }]} style={{ width: '70%' }}>
              <Input placeholder="owner/repository" />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="仓库地址" name="repoUrl">
            <Input />
          </Form.Item>
          <Form.Item label="默认分支" name="defaultBranch">
            <Input />
          </Form.Item>
          <Form.Item label="仓库职责" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} icon={<PlusOutlined />}>
            新增仓库
          </Button>
        </Form>
      </Modal>
      <Modal
        open={initOpen}
        title="初始化研发工作区"
        onCancel={() => setInitOpen(false)}
        onOk={() => void handleInit()}
        confirmLoading={initSaving}
        okText="开始初始化"
      >
        <p>初始化会为项目工作区准备代码索引和技能包，完成后才能创建研发任务。</p>
        <Radio.Group
          value={buildIndex}
          onChange={(event) => {
            const value = event.target.value as boolean;
            setBuildIndex(value);
            setSkillPackages(value ? SKILL_PACKAGES.map((item) => item.value) : []);
          }}
        >
          <Radio value={false}>不建立索引</Radio>
          <Radio value>建立索引</Radio>
        </Radio.Group>
        {buildIndex && (
          <Select
            mode="multiple"
            style={{ width: '100%', marginTop: 14 }}
            value={skillPackages}
            options={SKILL_PACKAGES}
            onChange={setSkillPackages}
            placeholder="选择技能包"
          />
        )}
      </Modal>
    </>
  );
};

export default ProjectRepositoryManager;
