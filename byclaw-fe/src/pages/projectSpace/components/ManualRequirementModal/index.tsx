import { Button, Input, Modal, Radio, Select, Space, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import { createManualRequirement, listProjectRepos, type DevloopProjectRepo } from '@/service/devloop';
import type { ProjectSpace } from '../../types';
import styles from './index.module.less';

type SourceType = 'manual' | 'customer_feedback' | 'internal_proposal';

interface Props {
  project: ProjectSpace;
  open: boolean;
  onCancel: () => void;
  onCreated: () => void;
}

const ManualRequirementModal: React.FC<Props> = ({ project, open, onCancel, onCreated }) => {
  const intl = useIntl();
  const [sourceType, setSourceType] = useState<SourceType>('manual');
  const [branch, setBranch] = useState('develop');
  const [repoId, setRepoId] = useState<number>();
  const [title, setTitle] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [productContent, setProductContent] = useState('');
  const [repos, setRepos] = useState<DevloopProjectRepo[]>(project.repos || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSourceType('manual');
    setBranch('develop');
    setRepoId(project.repos?.[0]?.repoId ? Number(project.repos[0].repoId) : undefined);
    setTitle('');
    setOriginalContent('');
    setProductContent('');
    setRepos(project.repos || []);
    void listProjectRepos(Number(project.projectId)).then((response) => setRepos(response || project.repos || []));
  }, [open, project.projectId, project.repos]);

  const handleSubmit = async () => {
    if (!title.trim() || !originalContent.trim() || !repoId) {
      message.warning(intl.formatMessage({ id: 'projectSpace.manualRequirement.validationRequired' }));
      return;
    }
    setLoading(true);
    try {
      await createManualRequirement({
        projectId: Number(project.projectId),
        sourceType,
        branch: branch.trim() || undefined,
        repoId,
        title: title.trim(),
        originalContent: originalContent.trim(),
        productContent: productContent.trim() || undefined,
      });
      message.success(intl.formatMessage({ id: 'projectSpace.manualRequirement.createSuccess' }));
      onCreated();
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.manualRequirement.createFailed' }));
    } finally {
      setLoading(false);
    }
  };

  const t = (id: string) => intl.formatMessage({ id: `projectSpace.manualRequirement.${id}` });

  return (
    <Modal
      open={open}
      title={t('title')}
      width={720}
      centered
      onCancel={onCancel}
      onOk={() => void handleSubmit()}
      confirmLoading={loading}
    >
      <div className={styles.form}>
        <label>{t('sourceType')}</label>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value)}
          options={[
            { value: 'manual', label: t('source.manual') },
            { value: 'customer_feedback', label: t('source.customerFeedback') },
            { value: 'internal_proposal', label: t('source.internalProposal') },
          ]}
        />
        <label>{t('repository')}</label>
        <Space.Compact className={styles.fullWidth}>
          <Select
            className={styles.fullWidth}
            value={repoId}
            allowClear
            placeholder={t('repositoryPlaceholder')}
            onChange={setRepoId}
            options={repos.map((repo) => ({ value: Number(repo.repoId), label: repo.repoFullName || repo.repoUrl }))}
          />
          <Button icon={<PlusOutlined />} disabled>
            {intl.formatMessage({ id: 'common.add' })}
          </Button>
        </Space.Compact>
        <label>{t('branch')}</label>
        <Input value={branch} onChange={(event) => setBranch(event.target.value)} />
        <label>{t('name')}</label>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        <label>{t('originalContent')}</label>
        <Input.TextArea rows={5} value={originalContent} onChange={(event) => setOriginalContent(event.target.value)} />
        <label>{t('productContent')}</label>
        <Input.TextArea rows={4} value={productContent} onChange={(event) => setProductContent(event.target.value)} />
      </div>
    </Modal>
  );
};

export default ManualRequirementModal;
