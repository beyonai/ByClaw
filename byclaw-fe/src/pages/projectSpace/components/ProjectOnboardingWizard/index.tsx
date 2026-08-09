import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Modal, Radio, Select, Steps, message } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DeleteOutlined,
  InfoCircleFilled,
  LoadingOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import {
  createProjectRepo,
  deleteProjectRepo,
  listProjectRepos,
  startProjectInit,
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
  // 完成:进入该项目详情(非研发项目建完即调,研发项目走完 step3 后调)。
  onFinish: (projectId: string) => void;
  // step3 进入架构数字员工聊天做初始化。
  onEnterArchitectChat: (projectId: string) => void;
}

const REPO_BRANCH_DEFAULT = 'main';
const PLACEHOLDER_REPLACE = '__PLACEHOLDER__';

// 建仓表单:工作区与代码仓库共用一份形状,新增/重置都走 emptyRepoForm,避免字面量漂移。
// description 可选,人工填仓库职责,需求 AI 预拆靠它判断该改哪些仓库。
type RepoFormState = { repoFullName: string; repoUrl: string; defaultBranch: string; description: string };
const emptyRepoForm = (): RepoFormState => ({
  repoFullName: '',
  repoUrl: '',
  defaultBranch: REPO_BRANCH_DEFAULT,
  description: '',
});

// 架构初始化可选技能包:枚举暂时前端硬编码,后续接后端 skill 目录。
const SKILL_PACKAGE_OPTIONS = [
  { value: 'trellis', label: 'trellis' },
  { value: 'superpowers', label: 'superpowers' },
];

const ProjectOnboardingWizard: React.FC<Props> = ({
  open,
  projectTypeConfigOptions,
  projectTypeLoading,
  onCancel,
  onCreateProject,
  onFinish,
  onEnterArchitectChat,
}) => {
  const intl = useIntl();
  const t = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.onboarding.${id}` }), [intl]);

  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [projectId, setProjectId] = useState('');
  // step1 复用单表单弹窗的完整表单主体(类型选择器 + 共享 + 默认员工),命令式取值经 basicRef。
  const [form] = Form.useForm<ProjectFormValues>();
  const basicRef = useRef<ProjectBasicFormHandle>(null);
  const projectType = Form.useWatch('projectType', form);
  const isDevelopProjectEnabled = (projectTypeConfigOptions ?? []).some((option) => option.value === 'develop');
  // 仅研发项目展开后续「仓库 → 架构初始化」两步及研发提示;其余类型 step1 填完直接建。
  const isDevelopProject = isDevelopProjectEnabled && projectType === 'develop';

  // 已配置仓库:按后端 repoType 区分工作区与代码仓库(存量数据无类型时按 code 处理)。
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [repoSaving, setRepoSaving] = useState(false);
  const [wsForm, setWsForm] = useState<RepoFormState>(emptyRepoForm());
  const [codeForm, setCodeForm] = useState<RepoFormState>(emptyRepoForm());

  // step3 架构初始化选项:是否建索引默认否;建索引时才联动技能包多选。
  const [buildIndex, setBuildIndex] = useState(false);
  const [skillPackages, setSkillPackages] = useState<string[]>([]);
  // 初始化需用户显式点击触发:未触发前展示配置,触发后才 loading 且允许关闭。
  const [initStarted, setInitStarted] = useState(false);
  const [initStarting, setInitStarting] = useState(false);

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
    setBuildIndex(false);
    setSkillPackages([]);
    setInitStarted(false);
    setInitStarting(false);
  }, [open]);

  const refreshRepos = useCallback(async (id: string) => {
    const list = await listProjectRepos(Number(id));
    setRepos(Array.isArray(list) ? list : []);
  }, []);

  // step1 提交:按表单真实值建项目拿 projectId。研发项目进 step2 继续建仓;非研发建完即完成关闭。
  const handleCreateBasic = async () => {
    const values = await basicRef.current?.collectValues();
    if (!values) return;
    setCreating(true);
    try {
      const createdId = await onCreateProject(values);
      if (!createdId) return;
      setProjectId(createdId);
      if (isDevelopProjectEnabled && values.projectType === 'develop') {
        await refreshRepos(createdId).catch(() => setRepos([]));
        setStep(1);
      } else {
        onFinish(createdId);
      }
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
  // step3 显式触发初始化:调用后端标记 initializing 并下发建索引/技能包配置,成功后进入 loading 态。
  const handleStartInit = async () => {
    if (!projectId) return;
    setInitStarting(true);
    try {
      await startProjectInit({
        projectId: Number(projectId),
        buildIndex,
        skillPackages: buildIndex ? skillPackages : [],
      });
      setInitStarted(true);
    } catch {
      message.error(t('step3.startFailed'));
    } finally {
      setInitStarting(false);
    }
  };

  const renderBasicStep = () => (
    <div className={styles.stepBody}>
      {/* 研发项目才提示后续步骤(仓库/架构初始化);其余类型 step1 即为全部,不展示研发向导提示。 */}
      {isDevelopProject && (
        <div className={styles.hint}>
          <InfoCircleFilled className={styles.hintIcon} />
          <span>{t('step1.hint')}</span>
        </div>
      )}
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

  const renderInitStep = () => (
    <div className={styles.stepBody}>
      <div className={styles.hint}>
        <InfoCircleFilled className={styles.hintIcon} />
        <span>{t('step3.hint')}</span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{t('index.title')}</span>
        </div>
        <div className={styles.sectionDesc}>{t('index.desc')}</div>
        <Radio.Group
          value={buildIndex}
          onChange={(e) => {
            const next = e.target.value as boolean;
            setBuildIndex(next);
            // 开启建索引默认全选技能包;关闭时清空,避免残留未展示的选择项。
            setSkillPackages(next ? SKILL_PACKAGE_OPTIONS.map((option) => option.value) : []);
          }}
        >
          <Radio value={false}>{t('index.no')}</Radio>
          <Radio value={true}>{t('index.yes')}</Radio>
        </Radio.Group>
        {buildIndex && (
          <div className={styles.skillField}>
            <span className={styles.repoFormLabel}>{t('index.skillLabel')}</span>
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              value={skillPackages}
              options={SKILL_PACKAGE_OPTIONS}
              placeholder={t('index.skillPlaceholder')}
              onChange={(vals) => setSkillPackages(vals as string[])}
            />
          </div>
        )}
      </div>

      {initStarted ? (
        // 已触发初始化:展示 loading 与进度,允许关闭(耗时任务在后台继续)。
        <div className={styles.initPanel}>
          <LoadingOutlined className={styles.initSpinner} spin />
          <div className={styles.initTitle}>{t('step3.title')}</div>
          <div className={styles.initDesc}>{t('step3.desc')}</div>
          <div className={styles.checklist}>
            <div className={`${styles.checkItem} ${styles.checkItemDone}`}>
              <CheckCircleFilled className={styles.checkIconDone} />
              {t('step3.check.repo')}
            </div>
            <div className={styles.checkItem}>
              <LoadingOutlined className={styles.checkIconActive} spin />
              {t('step3.check.model')}
            </div>
            <div className={styles.checkItem}>
              <ClockCircleOutlined className={styles.checkIconPending} />
              {t('step3.check.push')}
            </div>
          </div>
          <Button type="primary" ghost onClick={() => onEnterArchitectChat(projectId)}>
            {t('step3.enterChat')}
          </Button>
        </div>
      ) : (
        // 未触发:仅展示配置,需用户显式点击「开始初始化」才启动耗时任务。
        <div className={styles.initReady}>
          <div className={styles.initReadyDesc}>{t('step3.readyDesc')}</div>
          <Button type="primary" loading={initStarting} onClick={handleStartInit}>
            {t('step3.start')}
          </Button>
        </div>
      )}
    </div>
  );

  const stepPanels = [renderBasicStep, renderRepoStep, renderInitStep];

  const renderFooter = () => {
    if (step === 0) {
      return [
        <Button key="cancel" onClick={onCancel}>
          {t('action.cancel')}
        </Button>,
        <Button key="next" type="primary" loading={creating} onClick={handleCreateBasic}>
          {/* 研发项目继续 step2,主按钮为「下一步」;其余类型 step1 即建成,主按钮为「创建」。 */}
          {isDevelopProject ? t('action.next') : t('action.create')}
        </Button>,
      ];
    }
    if (step === 1) {
      return [
        <Button key="prev" onClick={() => setStep(0)}>
          {t('action.prev')}
        </Button>,
        <Button key="next" type="primary" disabled={!workspaceRepo} onClick={() => setStep(2)}>
          {workspaceRepo ? t('action.next') : t('action.nextNeedWorkspace')}
        </Button>,
      ];
    }
    // 未触发初始化前只能回上一步;触发后初始化在后台继续,才允许关闭。
    if (!initStarted) {
      return [
        <Button key="prev" onClick={() => setStep(1)}>
          {t('action.prev')}
        </Button>,
      ];
    }
    return [
      <Button key="later" onClick={() => onFinish(projectId)}>
        {t('action.later')}
      </Button>,
      <Button key="done" type="primary" onClick={() => onFinish(projectId)}>
        {t('action.done')}
      </Button>,
    ];
  };

  // step3 未触发初始化前禁止关闭:必须显式点击「开始初始化」或返回上一步。
  const closeBlocked = step === 2 && !initStarted;

  return (
    <Modal
      className={styles.wizard}
      title={t('titleCreate')}
      open={open}
      width={720}
      maskClosable={false}
      closable={!closeBlocked}
      onCancel={closeBlocked ? undefined : onCancel}
      footer={renderFooter()}
    >
      {/* 仅研发项目展开多步进度条;非研发 step1 即为全部,不展示步进。 */}
      {isDevelopProject && (
        <Steps
          className={styles.steps}
          current={step}
          size="small"
          items={[{ title: t('step1.title') }, { title: t('step2.title') }, { title: t('step3.titleShort') }]}
        />
      )}
      {stepPanels[step]()}
    </Modal>
  );
};

export default ProjectOnboardingWizard;
