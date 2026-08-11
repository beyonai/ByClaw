import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Form, Input, message, Modal, Select, Tabs, Upload } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { useIntl } from '@umijs/max';
import {
  addSkillGroupMembers,
  createSkillGroup,
  getSkillGroupDetail,
  pageSkillGroupMemberCandidates,
  removeSkillGroupMembers,
  updateSkillGroup,
} from '@/pages/manager/service/resources';
import type {
  ResourceImportResult,
  SkillGroup,
  SkillGroupMember,
  SkillGroupMemberPageResult,
} from '@/pages/manager/service/resources';
import { callDomainServiceByMultipart } from '@/service/file';
import { getFileUrl } from '@/utils/file';
import ResourceImport from '../ResourceImport';
import styles from './index.module.less';
import { normalizeSkillGroupCover } from './coverProcessor';
import { getSkillGroupMemberDiff } from './editHelpers';
import { getSuccessfulImportedSkillIds, mergeSelectedSkillIds } from './importHelpers';
import {
  buildSkillGroupCandidateParams,
  getSkillOptionLabel,
  getSkillOptionsForTab,
  normalizeSkillOptions,
  partitionSkillOptions,
  SKILL_CANDIDATE_LIST_HEIGHT,
  SKILL_CANDIDATE_TABS_SIZE,
  type SkillCandidateTabKey,
  type SkillOption,
} from './skillOptions';

interface SkillGroupCreateModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  group?: SkillGroup | null;
}

const getResponseData = <T,>(response: T | { data?: T }) => (response as { data?: T })?.data ?? response;

const getUploadedAvatar = (response: any): string => {
  const data = getResponseData(response) || {};
  return `${data.fileUrl || data.url || data.path || ''}`;
};

export const getCoverPreviewUrl = (file?: File): string => (file ? URL.createObjectURL(file) : '');

export const prepareSkillGroupCover = async (file: File): Promise<{ file: File; previewUrl: string }> => {
  const normalizedFile = await normalizeSkillGroupCover(file);
  return { file: normalizedFile, previewUrl: getCoverPreviewUrl(normalizedFile) };
};

const SkillGroupCreateModal: React.FC<SkillGroupCreateModalProps> = ({ visible, onCancel, onSuccess, group }) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);
  const [activeSkillTab, setActiveSkillTab] = useState<SkillCandidateTabKey>('builtIn');
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [coverFile, setCoverFile] = useState<File>();
  const [processingCover, setProcessingCover] = useState(false);
  const [avatar, setAvatar] = useState('');
  const [coverPreviewUrl, setCoverPreviewUrl] = useState('');
  const [originalSkillIds, setOriginalSkillIds] = useState<string[]>([]);
  const coverProcessGenerationRef = useRef(0);
  const modalGenerationRef = useRef(0);
  const isEditMode = Boolean(group?.resourceId);

  const loadSkillOptions = useCallback(async (): Promise<SkillOption[]> => {
    const response = await pageSkillGroupMemberCandidates(
      buildSkillGroupCandidateParams(group?.resourceId ? `${group.resourceId}` : undefined)
    );
    const data = (getResponseData(response) || {}) as Partial<SkillGroupMemberPageResult> & {
      rows?: SkillGroupMember[];
    };
    return normalizeSkillOptions(data.list || data.rows || []);
  }, [group?.resourceId]);

  useEffect(
    () => () => {
      if (coverPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
    },
    [coverPreviewUrl]
  );

  useEffect(() => {
    modalGenerationRef.current += 1;
    if (!visible) {
      coverProcessGenerationRef.current += 1;
      form.resetFields();
      setAvatar('');
      setFileList([]);
      setCoverFile(undefined);
      setProcessingCover(false);
      setCoverPreviewUrl('');
      setOriginalSkillIds([]);
      setActiveSkillTab('builtIn');
      setSkillImportOpen(false);
      setSkillsLoading(false);
      return;
    }

    const initialSkillIds = (group?.members || []).map((member) => `${member.resourceId}`);
    form.setFieldsValue({
      resourceName: group?.resourceName || undefined,
      resourceDesc: group?.resourceDesc || undefined,
      skillIds: isEditMode ? initialSkillIds : undefined,
    });
    setAvatar(group?.avatar || '');
    setCoverPreviewUrl(group?.avatar ? getFileUrl(group.avatar) : '');
    setOriginalSkillIds(initialSkillIds);

    let active = true;
    if (isEditMode && group?.resourceId) {
      getSkillGroupDetail({ groupId: `${group.resourceId}` })
        .then((response: any) => {
          if (!active) return;
          const detail = getResponseData(response) || {};
          const detailSkillIds = (detail.members || []).map((member: any) => `${member.resourceId}`);
          const currentSkillIds = form.getFieldValue('skillIds') || [];
          const { addedSkillIds, removedSkillIds } = getSkillGroupMemberDiff(initialSkillIds, currentSkillIds);
          const removedSkillIdSet = new Set(removedSkillIds);
          const reconciledSkillIds = mergeSelectedSkillIds(
            detailSkillIds.filter((skillId: string) => !removedSkillIdSet.has(skillId)),
            addedSkillIds
          );
          setOriginalSkillIds(detailSkillIds);
          form.setFieldValue('skillIds', reconciledSkillIds);
        })
        .catch(() => undefined);
    }

    setSkillsLoading(true);
    loadSkillOptions()
      .then((options) => {
        if (active) setSkillOptions(options);
      })
      .catch(() => {
        if (!active) return;
        setSkillOptions([]);
        message.error(intl.formatMessage({ id: 'resource.skillGroup.loadSkillsFailed' }));
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, group, intl, isEditMode, loadSkillOptions, visible]);

  const { builtInSkills, personalSkills } = useMemo(() => partitionSkillOptions(skillOptions), [skillOptions]);
  const activeSkillOptions = getSkillOptionsForTab(skillOptions, activeSkillTab);

  const handleSkillImportSuccess = async (result?: ResourceImportResult) => {
    setSkillImportOpen(false);
    const importedSkillIds = getSuccessfulImportedSkillIds(result);
    if (!importedSkillIds.length) return;

    const generation = modalGenerationRef.current;
    setSkillsLoading(true);
    try {
      const nextSkillOptions = await loadSkillOptions();
      if (generation !== modalGenerationRef.current) return;
      const currentSkillIds = form.getFieldValue('skillIds') || [];
      setSkillOptions(nextSkillOptions);
      form.setFieldValue('skillIds', mergeSelectedSkillIds(currentSkillIds, importedSkillIds));
      setActiveSkillTab('personal');
    } catch {
      if (generation !== modalGenerationRef.current) return;
      message.error(intl.formatMessage({ id: 'resource.skillGroup.uploadRefreshFailed' }));
    } finally {
      if (generation === modalGenerationRef.current) setSkillsLoading(false);
    }
  };

  const uploadProps: UploadProps = {
    accept: 'image/*',
    maxCount: 1,
    fileList,
    beforeUpload: () => false,
    onChange: ({ fileList: nextFileList }) => {
      const nextFile = nextFileList.slice(-1);
      const sourceFile = nextFile[0]?.originFileObj;
      const generation = coverProcessGenerationRef.current + 1;
      coverProcessGenerationRef.current = generation;
      setFileList(nextFile);
      setCoverFile(undefined);
      setAvatar('');
      setCoverPreviewUrl('');
      if (!sourceFile) {
        setProcessingCover(false);
        return;
      }

      setProcessingCover(true);
      void prepareSkillGroupCover(sourceFile)
        .then(({ file, previewUrl }) => {
          if (generation !== coverProcessGenerationRef.current) {
            URL.revokeObjectURL(previewUrl);
            return;
          }
          setCoverFile(file);
          setCoverPreviewUrl(previewUrl);
        })
        .catch(() => {
          if (generation !== coverProcessGenerationRef.current) return;
          setFileList([]);
          message.error(intl.formatMessage({ id: 'resource.skillGroup.coverProcessFailed' }));
        })
        .finally(() => {
          if (generation === coverProcessGenerationRef.current) setProcessingCover(false);
        });
    },
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      let nextAvatar = avatar;
      if (coverFile && !nextAvatar) {
        const formData = new FormData();
        formData.append('file', coverFile);
        const uploadResponse = await callDomainServiceByMultipart(formData);
        nextAvatar = getUploadedAvatar(uploadResponse);
        if (!nextAvatar) {
          throw new Error(intl.formatMessage({ id: 'resource.skillGroup.coverUploadFailed' }));
        }
        setAvatar(nextAvatar);
      }

      const resourceName = values.resourceName.trim();
      const resourceDesc = values.resourceDesc?.trim();
      if (isEditMode && group?.resourceId) {
        const groupId = `${group.resourceId}`;
        await updateSkillGroup({
          groupId,
          resourceName,
          resourceDesc,
          avatar: nextAvatar || undefined,
        });
        const { addedSkillIds, removedSkillIds } = getSkillGroupMemberDiff(originalSkillIds, values.skillIds);
        if (addedSkillIds.length) {
          await addSkillGroupMembers({ groupId, skillIds: addedSkillIds });
        }
        if (removedSkillIds.length) {
          await removeSkillGroupMembers({ groupId, skillIds: removedSkillIds });
        }
        message.success(intl.formatMessage({ id: 'resource.skillGroup.updateSuccess' }));
      } else {
        const createResponse = await createSkillGroup({
          resourceName,
          resourceDesc,
          avatar: nextAvatar || undefined,
          ownerType: 'enterprise',
        });
        const createdGroup = getResponseData(createResponse) || {};
        const groupId = `${createdGroup.resourceId || createdGroup.groupId || ''}`;
        if (!groupId) {
          throw new Error(intl.formatMessage({ id: 'resource.skillGroup.createFailed' }));
        }
        await addSkillGroupMembers({ groupId, skillIds: values.skillIds });
        message.success(intl.formatMessage({ id: 'resource.skillGroup.createSuccess' }));
      }
      onSuccess();
    } catch (error: any) {
      message.error(error?.message || error || intl.formatMessage({ id: 'resource.skillGroup.createFailed' }));
    } finally {
      setSaving(false);
    }
  };

  return React.createElement(
    React.Fragment,
    null,
    <Modal
      destroyOnClose
      open={visible}
      width={980}
      className={styles.modal}
      title={intl.formatMessage({
        id: isEditMode ? 'resource.skillGroup.editTitle' : 'resource.skillGroup.createTitle',
      })}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={saving || processingCover}
      onCancel={onCancel}
      onOk={() => void handleSubmit()}
    >
      <Form form={form} layout="vertical" className={styles.form}>
        <div className={styles.content}>
          <div className={styles.infoColumn}>
            <Form.Item
              label={intl.formatMessage({ id: 'resource.skillGroup.name' })}
              name="resourceName"
              rules={[{ required: true, whitespace: true, message: intl.formatMessage({ id: 'common.inputKeyword' }) }]}
            >
              <Input maxLength={50} placeholder={intl.formatMessage({ id: 'resource.skillGroup.namePlaceholder' })} />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'resource.description' })} name="resourceDesc">
              <Input.TextArea
                rows={8}
                maxLength={500}
                placeholder={intl.formatMessage({ id: 'resource.skillGroup.descPlaceholder' })}
              />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'resource.memberSkills' })}
              name="skillIds"
              rules={[
                {
                  required: true,
                  type: 'array',
                  min: 1,
                  message: intl.formatMessage({ id: 'resource.skillGroup.selectSkills' }),
                },
              ]}
            >
              <Select
                mode="multiple"
                loading={skillsLoading}
                listHeight={SKILL_CANDIDATE_LIST_HEIGHT}
                optionFilterProp="label"
                placeholder={intl.formatMessage({ id: 'resource.skillGroup.selectSkills' })}
                options={activeSkillOptions.map((skill) => ({
                  value: skill.resourceId,
                  label: skill.resourceName,
                  title: skill.resourceDesc,
                }))}
                labelRender={({ value, label }) => getSkillOptionLabel(skillOptions, value, label)}
                popupRender={(menu) => (
                  <div>
                    <div className={styles.skillTabsHeader} onMouseDown={(event) => event.preventDefault()}>
                      <Tabs
                        animated={false}
                        activeKey={activeSkillTab}
                        size={SKILL_CANDIDATE_TABS_SIZE}
                        items={[
                          {
                            key: 'builtIn',
                            label: (
                              <span>
                                {intl.formatMessage({ id: 'resource.skillGroup.builtInSkills' })}
                                <span className={styles.skillTabCount}>{builtInSkills.length}</span>
                              </span>
                            ),
                          },
                          {
                            key: 'personal',
                            label: (
                              <span>
                                {intl.formatMessage({ id: 'resource.skillGroup.personalSkills' })}
                                <span className={styles.skillTabCount}>{personalSkills.length}</span>
                              </span>
                            ),
                          },
                        ]}
                        onChange={(key) => setActiveSkillTab(key as SkillCandidateTabKey)}
                      />
                    </div>
                    {activeSkillTab === 'personal' ? (
                      <div className={styles.personalSkillToolbar}>
                        <Button
                          type="link"
                          size="small"
                          icon={<UploadOutlined />}
                          disabled={skillsLoading}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setSkillImportOpen(true)}
                        >
                          {intl.formatMessage({ id: 'resource.skillGroup.uploadPersonalSkill' })}
                        </Button>
                      </div>
                    ) : null}
                    <div className={styles.skillMenu} style={{ height: SKILL_CANDIDATE_LIST_HEIGHT }}>
                      {menu}
                    </div>
                  </div>
                )}
              />
            </Form.Item>
          </div>
          <div className={styles.coverColumn}>
            <Form.Item label={intl.formatMessage({ id: 'resource.skillGroup.cover' })}>
              <Upload.Dragger {...uploadProps} showUploadList={false} className={styles.coverUploader}>
                {coverPreviewUrl ? (
                  <div className={styles.coverPreview}>
                    <img src={coverPreviewUrl} alt={intl.formatMessage({ id: 'resource.skillGroup.cover' })} />
                    <span>{intl.formatMessage({ id: 'resource.skillGroup.coverHint' })}</span>
                  </div>
                ) : (
                  <div className={styles.coverPlaceholder}>
                    <InboxOutlined />
                    <span>
                      {intl.formatMessage({
                        id: processingCover ? 'resource.skillGroup.coverProcessing' : 'resource.skillGroup.coverHint',
                      })}
                    </span>
                  </div>
                )}
              </Upload.Dragger>
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>,
    <ResourceImport
      visible={skillImportOpen}
      resourceName={intl.formatMessage({ id: 'common.skill' })}
      resourceType="SKILL"
      catalogId=""
      catalogList={[]}
      activeTab="personal"
      saveTool={async () => undefined}
      onCancel={() => setSkillImportOpen(false)}
      onSuccess={(result) => void handleSkillImportSuccess(result)}
    />
  );
};

export default SkillGroupCreateModal;
