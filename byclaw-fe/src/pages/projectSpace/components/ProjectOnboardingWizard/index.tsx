import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Modal, Steps, message } from 'antd';
import { CheckCircleFilled, DeleteOutlined, InfoCircleFilled, PlusOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  createProjectRepo,
  deleteProjectRepo,
  listProjectRepos,
  type DevloopProjectRepo,
  type ProjectRepoType,
} from '@/service/devloop';
import ProjectBasicForm, {
  type ProjectBasicFormHandle,
  type ProjectFormValues,
} from '../ProjectFormModal/ProjectBasicForm';
import type { ProjectTypeOption } from '../../hooks/useProjectTypeConfig';
import styles from './index.module.less';

interface Props {
  open: boolean;
  projectTypeConfigOptions?: ProjectTypeOption[];
  projectTypeLoading?: boolean;
  onCancel: () => void;
  // 父级负责查重/建项目(按表单真实类型)/存共享成员与默认员工,返回 projectId 字符串;空串表示失败(父级已提示)。
  onCreateProject: (values: ProjectFormValues) => Promise<string>;
  // 完成:进入该项目详情(普通项目建完即调,研发、运营项目配完仓库后调)。
  onFinish: (projectId: string) => void;
}

const REPO_BRANCH_DEFAULT = 'main';
const PLACEHOLDER_REPLACE = '__PLACEHOLDER__';

// 建仓表单:工作区与代码仓库共用一份形状,新增/重置都走 emptyRepoForm,避免字面量漂移。
// description 可选,人工填仓库职责,让后来人看清这个仓库负责什么。
type RepoFormState = { repoFullName: string; repoUrl: string; defaultBranch: string; description: string };
const emptyRepoForm = (): RepoFormState => ({
  repoFullName: '',
  repoUrl: '',
  defaultBranch: REPO_BRANCH_DEFAULT,
  description: '',
});

const ProjectOnboardingWizard: React.FC<Props> = ({
  open,
  projectTypeConfigOptions,
  projectTypeLoading,
  onCancel,
  onCreateProject,
  onFinish,
}) => {
  const intl = useIntl();
  const t = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.onboarding.${id}` }), [intl]);

  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [projectId, setProjectId] = useState('');
  // step1 复用单表单弹窗的完整表单主体(类型选择器 + 共享 + 默认员工),命令式取值经 basicRef。
  const [form] = Form.useForm<ProjectFormValues>();
  const basicRef = useRef<ProjectBasicFormHandle>(null);
  // 项目创建统一在基本信息表单完成，不再拆分仓库配置步骤。
  const isRepositoryProject = false;

  // 已配置仓库:按后端 repoType 区分工作区与代码仓库(存量数据无类型时按 code 处理)。
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [repoSaving, setRepoSaving] = useState(false);
  const [wsForm, setWsForm] = useState<RepoFormState>(emptyRepoForm());
  const [codeForm, setCodeForm] = useState<RepoFormState>(emptyRepoForm());

  const workspaceRepo = repos.find((repo) => repo.repoType === 'workspace');
  const codeRepos = repos.filter((repo) => repo.repoType !== 'workspace');

  // 每次打开重置向导:回到第一步,清空已建项目引用与后续步骤状态(step1 表单由 ProjectBasicForm 自行重置)。
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setProjectId('');
    setCreating(false);
    setRepos([]);
    setWsForm(emptyRepoForm());
    setCodeForm(emptyRepoForm());
  }, [open]);

  const refreshRepos = useCallback(async (id: string) => {
    const list = await listProjectRepos(Number(id));
    setRepos(Array.isArray(list) ? list : []);
  }, []);

  // step1 提交:按表单真实值建项目拿 projectId。研发、运营项目进 step2 继续建仓;普通项目建完即完成关闭。
  const handleCreateBasic = async () => {
    const values = await basicRef.current?.collectValues();
    if (!values) return;
    setCreating(true);
    try {
      const createdId = await onCreateProject(values);
      if (!createdId) return;
      setProjectId(createdId);
      onFinish(createdId);
    } finally {
      setCreating(false);
    }
  };

  const addRepo = async (form: RepoFormState, isWorkspace: boolean) => {
    if (!projectId) return;
    if (!form.repoFullName.trim()) {
      message.error(t('repo.validation.nameRequired'));
      return;
    }
    setRepoSaving(true);
    try {
      const repoType: ProjectRepoType = isWorkspace ? 'workspace' : 'code';
      const res = await createProjectRepo({
        projectId: Number(projectId),
        repoFullName: form.repoFullName.trim(),
        repoUrl: form.repoUrl.trim() || undefined,
        defaultBranch: form.defaultBranch.trim() || undefined,
        description: form.description.trim() || undefined,
        repoType,
      });
      if (!res?.repoId) {
        message.error(t('repo.createFailed'));
        return;
      }
      message.success(t('repo.createSuccess'));
      if (isWorkspace) setWsForm(emptyRepoForm());
      else setCodeForm(emptyRepoForm());
      await refreshRepos(projectId);
    } catch {
      message.error(t('repo.createFailed'));
    } finally {
      setRepoSaving(false);
    }
  };

  const handleDeleteRepo = (repo: DevloopProjectRepo) => {
    Modal.confirm({
      title: t('repo.deleteConfirmTitle'),
      content: t('repo.deleteConfirm').replace(
        PLACEHOLDER_REPLACE,
        repo.repoFullName || repo.repoUrl || `${repo.repoId}`
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProjectRepo(repo.repoId);
          message.success(t('repo.deleteSuccess'));
          await refreshRepos(projectId);
        } catch {
          message.error(t('repo.deleteFailed'));
        }
      },
    });
  };

  const renderBasicStep = () => (
    <div className={styles.stepBody}>
      <ProjectBasicForm
        ref={basicRef}
        open={open}
        form={form}
        projectTypeConfigOptions={projectTypeConfigOptions}
        projectTypeLoading={projectTypeLoading}
        onEnterSubmit={handleCreateBasic}
      />
    </div>
  );

  const renderRepoForm = (
    formState: RepoFormState,
    setForm: React.Dispatch<React.SetStateAction<RepoFormState>>,
    isWorkspace: boolean
  ) => (
    <div className={styles.repoForm}>
      <div className={styles.repoFormField}>
        <span className={styles.repoFormLabel}>{t('repo.field.fullName')}</span>
        <Input
          value={formState.repoFullName}
          placeholder={t('repo.placeholder.fullName')}
          onChange={(e) => setForm((prev) => ({ ...prev, repoFullName: e.target.value }))}
        />
      </div>
      <div className={styles.repoFormField}>
        <span className={styles.repoFormLabel}>{t('repo.field.url')}</span>
        <Input
          value={formState.repoUrl}
          placeholder={t('repo.placeholder.url')}
          onChange={(e) => setForm((prev) => ({ ...prev, repoUrl: e.target.value }))}
        />
      </div>
      <div className={styles.repoFormField}>
        <span className={styles.repoFormLabel}>{t('repo.field.branch')}</span>
        <Input
          value={formState.defaultBranch}
          placeholder={REPO_BRANCH_DEFAULT}
          onChange={(e) => setForm((prev) => ({ ...prev, defaultBranch: e.target.value }))}
        />
      </div>
      <div className={styles.repoFormField}>
        <span className={styles.repoFormLabel}>{t('repo.field.description')}</span>
        <Input.TextArea
          value={formState.description}
          placeholder={t('repo.placeholder.description')}
          rows={2}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />
      </div>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        loading={repoSaving}
        onClick={() => addRepo(formState, isWorkspace)}
      >
        {isWorkspace ? t('workspace.save') : t('code.add')}
      </Button>
    </div>
  );

  const renderRepoStep = () => (
    <div className={styles.stepBody}>
      <div className={styles.hint}>
        <InfoCircleFilled className={styles.hintIcon} />
        <span>{t('step2.hint')}</span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{t('workspace.title')}</span>
          {workspaceRepo ? (
            <span className={styles.savedBadge}>
              <CheckCircleFilled /> {t('workspace.saved')}
            </span>
          ) : (
            <span className={styles.requiredBadge}>{t('badge.required')}</span>
          )}
        </div>
        <div className={styles.sectionDesc}>{t('workspace.desc')}</div>
        {workspaceRepo ? (
          <div className={styles.repoRow}>
            <span className={styles.repoRowDot} />
            <span className={styles.repoRowName}>{workspaceRepo.repoFullName}</span>
            <span className={styles.repoRowBranch}>{workspaceRepo.defaultBranch || REPO_BRANCH_DEFAULT}</span>
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteRepo(workspaceRepo)}
            />
          </div>
        ) : (
          renderRepoForm(wsForm, setWsForm, true)
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{t('code.title')}</span>
          <span className={styles.optionalBadge}>{t('badge.optional')}</span>
        </div>
        <div className={styles.sectionDesc}>{t('code.desc')}</div>
        {codeRepos.map((repo) => (
          <div className={styles.repoRow} key={repo.repoId}>
            <span className={styles.repoRowDot} />
            <span className={styles.repoRowName}>{repo.repoFullName}</span>
            <span className={styles.repoRowBranch}>{repo.defaultBranch || REPO_BRANCH_DEFAULT}</span>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteRepo(repo)} />
          </div>
        ))}
        {!codeRepos.length && <div className={styles.repoEmpty}>{t('code.empty')}</div>}
        {/* 代码仓库仅在工作区已配置后才允许添加,保证工作区先行的固定顺序。 */}
        {workspaceRepo && renderRepoForm(codeForm, setCodeForm, false)}
      </div>
    </div>
  );

  const stepPanels = [renderBasicStep, renderRepoStep];

  const renderFooter = () => {
    if (step === 0) {
      return [
        <Button key="cancel" onClick={onCancel}>
          {t('action.cancel')}
        </Button>,
        <Button key="next" type="primary" loading={creating} onClick={handleCreateBasic}>
          {/* 研发、运营项目继续 step2,主按钮为「下一步」;普通项目 step1 即建成,主按钮为「创建」。 */}
          {isRepositoryProject ? t('action.next') : t('action.create')}
        </Button>,
      ];
    }
    // 仓库是最后一步:工作区必填,配好即可完成并进入项目。
    return [
      <Button key="prev" onClick={() => setStep(0)}>
        {t('action.prev')}
      </Button>,
      <Button key="done" type="primary" disabled={!workspaceRepo} onClick={() => onFinish(projectId)}>
        {workspaceRepo ? t('action.done') : t('action.nextNeedWorkspace')}
      </Button>,
    ];
  };

  return (
    <Modal
      className={styles.wizard}
      // 禁止 Modal 外层 wrap 滚动，向导内容统一在弹窗主体内滚动。
      wrapClassName={styles.wizardWrap}
      title={t('titleCreate')}
      open={open}
      width={720}
      // 与编辑项目弹窗保持一致，始终在当前视口内上下居中展示。
      centered
      maskClosable={false}
      onCancel={onCancel}
      footer={renderFooter()}
      // 限制 body 高度并在弹窗内部滚动，避免页面和 Modal 外层抢滚动。
      styles={{
        body: {
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto',
          paddingTop: 8,
          paddingInlineEnd: 8,
        },
      }}
    >
      <div className={styles.wizardScroll}>
        {/* 研发、运营项目展开多步进度条;普通项目 step1 即为全部,不展示步进。 */}
        {isRepositoryProject && (
          <Steps
            className={styles.steps}
            current={step}
            size="small"
            items={[{ title: t('step1.title') }, { title: t('step2.title') }]}
          />
        )}
        {stepPanels[step]()}
      </div>
    </Modal>
  );
};

export default ProjectOnboardingWizard;
