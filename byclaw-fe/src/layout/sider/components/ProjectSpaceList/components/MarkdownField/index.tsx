import { FileAddOutlined, LoadingOutlined, PictureOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Input, Segmented, Tooltip, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useRef, useState } from 'react';

import MdPreview from '@/components/Preview/Md';
import { uploadFiles, uploadImage } from '@/service/file';

import styles from './index.module.less';

interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
}

const IMAGE_ACCEPT = '.jpeg,.jpg,.png,.gif,.bmp,.webp';

// 手工需求内容改用 Markdown:贴图走 uploadImage 拿 fullPathName,附件走 uploadFiles 拿 fileUrl,
// 都以 Markdown 语法插入光标处;项目未引入编辑器库,故用 textarea + MdPreview 组合,不新增依赖。
export default function MarkdownField({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 6,
  disabled,
}: MarkdownFieldProps) {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id });
  const textareaRef = useRef<TextAreaRef>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [uploading, setUploading] = useState(false);

  // 在光标处插入片段,保持已输入内容不被覆盖;拿不到光标时退化为追加。
  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current?.resizableTextArea?.textArea;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    onChange(maxLength ? next.slice(0, maxLength) : next);
    requestAnimationFrame(() => {
      const caret = start + snippet.length;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const handleImagePicked = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new window.FormData();
      formData.append('file', file);
      formData.append('module', 'TEMP');
      const res = await uploadImage(formData);
      const url = res?.fullPathName;
      if (!url) {
        message.error(t('markdownField.uploadFailed'));
        return;
      }
      insertAtCursor(`\n![${file.name}](${url})\n`);
    } catch {
      message.error(t('markdownField.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new window.FormData();
      formData.append('file', file);
      const res = await uploadFiles(formData);
      const uploaded = res?.rebuildFileList?.[0];
      const url = uploaded?.fileUrl || uploaded?.filePath;
      if (!url) {
        message.error(t('markdownField.uploadFailed'));
        return;
      }
      insertAtCursor(`\n[${uploaded?.fileName || file.name}](${url})\n`);
    } catch {
      message.error(t('markdownField.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <Tooltip title={t('markdownField.insertImage')}>
          <Button
            type="text"
            size="small"
            icon={uploading ? <LoadingOutlined /> : <PictureOutlined />}
            disabled={disabled || uploading}
            onClick={() => imageInputRef.current?.click()}
          />
        </Tooltip>
        <Tooltip title={t('markdownField.insertFile')}>
          <Button
            type="text"
            size="small"
            icon={<FileAddOutlined />}
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
          />
        </Tooltip>
        <span className={styles.toolbarSpacer} />
        <span className={styles.toolbarHint}>{t('markdownField.hint')}</span>
        <Segmented
          size="small"
          value={mode}
          onChange={(next) => setMode(next as 'edit' | 'preview')}
          options={[
            { label: t('markdownField.edit'), value: 'edit' },
            { label: t('markdownField.preview'), value: 'preview' },
          ]}
        />
      </div>
      <div className={styles.body}>
        {mode === 'edit' ? (
          <>
            <Input.TextArea
              ref={textareaRef}
              className={styles.textarea}
              value={value}
              placeholder={placeholder}
              maxLength={maxLength}
              rows={rows}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
            />
            {maxLength ? (
              <span className={styles.count}>
                {value.length}/{maxLength}
              </span>
            ) : null}
          </>
        ) : (
          <div className={styles.preview}>
            {value.trim() ? (
              <MdPreview content={value} />
            ) : (
              <span className={styles.previewEmpty}>{t('markdownField.previewEmpty')}</span>
            )}
          </div>
        )}
      </div>
      {/* 隐藏的原生文件选择器,避免额外拉起 antd Upload 的一整套交互。 */}
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        style={{ display: 'none' }}
        onChange={(event) => {
          void handleImagePicked(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(event) => {
          void handleFilePicked(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
