import { useIntl } from '@umijs/max';
import { Input, Modal, Select, message } from 'antd';
import { useEffect, useState } from 'react';

import MarkdownField from '@/layout/sider/components/ProjectSpaceList/components/MarkdownField';
import getDisplayAnswer from '@/components/QueryInput/getDisplayAnswer';
import { createManualRequirement, getProject } from '@/service/devloop';
import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';

type RepoOption = {
  repoId: number;
  repoFullName?: string;
  repoUrl?: string;
  defaultBranch?: string;
};

interface CaptureRequirementModalProps {
  open: boolean;
  projectId: number;
  projectName?: string;
  messages: IMessage[];
  onClose: () => void;
  onCreated?: () => void;
}

const CONTENT_MAX_LENGTH = 4000;
const TITLE_MAX_LENGTH = 60;

// 数字员工回答的正文在 messageList 里(需 getDisplayAnswer 提取),用户消息的正文在 text 里。
const getMessageText = (msg: IMessage) => {
  const answerText = msg.fromBeyond ? getDisplayAnswer(msg.messageList) : '';
  return (answerText || msg.text || '').trim();
};

// 把会话消息拼成 Markdown 草稿作为需求原始内容的预填,用户可再编辑定稿。
// 单条消息直接用原文;多条时按角色加前缀。不做自动萃取,把"消息→需求"的判断交给用户。
const buildDraftFromMessages = (messages: IMessage[], t: (id: string) => string) => {
  const items = messages.map((msg) => ({ msg, text: getMessageText(msg) })).filter((item) => item.text);
  if (items.length === 1) return items[0].text;
  return items
    .map(({ msg, text }) => {
      const roleLabel = msg.fromBeyond ? t('captureRequirement.roleAssistant') : t('captureRequirement.roleUser');
      return `**${roleLabel}:** ${text}`;
    })
    .join('\n\n');
};

const deriveTitle = (messages: IMessage[]) => {
  // 优先用用户提问作标题;若只抓了 AI 回答,退回用回答开头。
  const firstUser = messages.find((msg) => !msg.fromBeyond && getMessageText(msg));
  const source = firstUser || messages.find((msg) => getMessageText(msg));
  const raw = source ? getMessageText(source).replace(/\s+/g, ' ') : '';
  return raw.slice(0, TITLE_MAX_LENGTH);
};

export default function CaptureRequirementModal({
  open,
  projectId,
  messages,
  onClose,
  onCreated,
}: CaptureRequirementModalProps) {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => formatMessage({ id }, values);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [repoId, setRepoId] = useState<number | undefined>(undefined);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 弹窗打开时预填草稿并拉取项目仓库;关闭不清空以便误关后重开保留编辑。
  useEffect(() => {
    if (!open) return;
    setTitle(deriveTitle(messages));
    setContent(buildDraftFromMessages(messages, t));
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setReposLoading(true);
    getProject(projectId)
      .then((detail) => {
        if (cancelled) return;
        const list: RepoOption[] = detail?.repos || [];
        setRepos(list);
        // 仅一个仓库时直接默认选中,省去用户一次点击。
        if (list.length === 1) setRepoId(list[0].repoId);
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      })
      .finally(() => {
        if (!cancelled) setReposLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      message.warning(t('captureRequirement.validation.titleRequired'));
      return;
    }
    if (!content.trim()) {
      message.warning(t('captureRequirement.validation.contentRequired'));
      return;
    }
    if (!repoId) {
      message.warning(t('captureRequirement.validation.repoRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await createManualRequirement({
        projectId,
        sourceType: 'manual',
        repoId,
        title: title.trim(),
        originalContent: content.trim(),
      });
      message.success(t('captureRequirement.success'));
      onCreated?.();
      onClose();
    } catch (error: any) {
      message.error(error?.message || t('captureRequirement.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('captureRequirement.title')}
      open={open}
      onCancel={() => !submitting && onClose()}
      onOk={handleSubmit}
      confirmLoading={submitting}
      closable={!submitting}
      okText={t('captureRequirement.submit')}
      cancelText={t('captureRequirement.cancel')}
      width={720}
      centered
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label>{t('captureRequirement.field.title')}</label>
          <Input
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            placeholder={t('captureRequirement.placeholder.title')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label>{t('captureRequirement.field.repository')}</label>
          <Select
            className={styles.repoSelect}
            value={repoId}
            loading={reposLoading}
            placeholder={t('captureRequirement.placeholder.repository')}
            onChange={setRepoId}
            options={repos.map((repo) => ({
              value: repo.repoId,
              label: repo.repoFullName || repo.repoUrl || String(repo.repoId),
            }))}
            notFoundContent={repos.length ? undefined : t('captureRequirement.noRepositories')}
          />
        </div>
        <div className={styles.field}>
          <label>{t('captureRequirement.field.content')}</label>
          <span className={styles.hint}>{t('captureRequirement.contentHint')}</span>
          <MarkdownField
            value={content}
            maxLength={CONTENT_MAX_LENGTH}
            rows={8}
            placeholder={t('captureRequirement.placeholder.content')}
            onChange={setContent}
          />
        </div>
      </div>
    </Modal>
  );
}
