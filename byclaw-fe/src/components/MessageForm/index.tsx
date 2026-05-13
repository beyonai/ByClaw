import { InfoCircleOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { Col, Form, Input, Row, Select, message, Button } from 'antd';
import { useIntl } from '@umijs/max';
import React, { forwardRef, useImperativeHandle, useState, useEffect, useMemo } from 'react';
import { isEmpty, pullAllBy } from 'lodash';
import UploadFile from '../QueryInput/components/UploadFile';
import CarouselFile from '@/components/MessageList/components/CarouselFile';
import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';
import { IFile } from '@/typescript/file';

export type IFormItem = {
  formType: 'input' | 'select' | 'textarea' | 'file';
  fieldName: string;
  fieldCode: string;
  defaultValue?: string;
  description?: string;
  optional?: string | any;
  fieldValue?: string;
  disabled?: boolean;
  required?: boolean;
  defaultFiles?: string[];
};

export type MessageFormProps = {
  substance: IFormItem[];
  initialValues?: Record<string, any>;
  disabled?: boolean;
  onFieldsChange?: (changedValues: any, allValues: any) => void;
  form?: any; // antd form instance, 可选
};

const { TextArea } = Input;

const MessageForm = forwardRef<any, MessageFormProps>((props, ref) => {
  const { substance = [], initialValues = {}, disabled = false, onFieldsChange, form: externalForm } = props;
  const intl = useIntl();
  const { currentSession } = React.useContext(ChatLayoutCompContext);
  const [form] = Form.useForm();
  // 优先使用外部传入的 form
  const formInstance = externalForm || form;
  const randomRef = React.useRef(Math.floor(Math.random() * 1000));
  useImperativeHandle(ref, () => formInstance, [formInstance]);
  const initialFileList = useMemo(() => {
    const fileField = substance.find((item) => item.formType === 'file');
    return fileField?.fieldValue || [];
  }, [substance]);
  const [fileList, setFileList] = useState<IFile[]>(
    typeof initialFileList === 'string' ? JSON.parse(initialFileList) || [] : initialFileList || []
  );

  // 将文件列表同步到表单字段
  useEffect(() => {
    formInstance.setFieldsValue({ files: fileList });
  }, [fileList, formInstance]);

  const onCreateFile = (fileItem: IFile) => {
    const hasSame = fileList?.find(
      (item) => item.file.name === fileItem.file.name && item.file.size === fileItem.file.size
    );
    if (hasSame) {
      message.error(intl.formatMessage({ id: 'messageForm.uploadDuplicate' }));
      return false;
    }
    if (fileList.length >= 10) {
      message.error(intl.formatMessage({ id: 'messageForm.maxFilesLimit' }, { count: 10 }));
      return false;
    }
    setFileList((prev) => [...prev, fileItem]);
    return true;
  };

  // 更新文件回调
  const onUpdateFile = (fileItem: IFile) => {
    setFileList((prev) => prev.map((item) => (item.uid === fileItem.uid ? { ...item, ...fileItem } : item)));
  };

  // 移除文件回调
  const onRemoveFile = (fileItem: IFile) => {
    setFileList((prev) => prev.filter((item) => item.uid !== fileItem.uid));
  };

  // 设置sessionId回调
  const handleSetSessionId = () => {
  };

  return (
    <Form
      form={formInstance}
      name={`${randomRef.current}_message_form`}
      layout="vertical"
      initialValues={initialValues}
      disabled={!!disabled}
      onFieldsChange={onFieldsChange}
    >
      <Row gutter={24}>
        {substance?.map?.((item, idx) => {
          const {
            formType,
            fieldCode,
            fieldName,
            defaultValue,
            optional,
            description,
            fieldValue,
            disabled,
            required,
            defaultFiles,
          } = item;

          let comp = <Input />;

          if (formType === 'select') {
            let options = [];
            try {
              if (typeof optional === 'string') {
                const changed = optional?.replace(/'/g, '"');
                const optionalArr = changed ? JSON.parse(changed) : [];
                options = optionalArr.map((o: string) => ({
                  label: o,
                  value: o,
                }));
              } else if (Array.isArray(optional)) {
                if (optional.length > 0) {
                  if (typeof optional[0] === 'string') {
                    // 防止有这种情况字符串数组 ['选项1', '选项2']
                    options = optional.map((o: string) => ({
                      label: o,
                      value: o,
                    }));
                  } else if (optional[0].hasOwnProperty('label') && optional[0].hasOwnProperty('value')) {
                    // 现在是和后端约定对象数组 [{label: '选项1', value: 'option1'}, ...]
                    options = optional;
                  }
                }
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              // console.error(e);
            }
            comp = <Select options={options} disabled={disabled} />;
          }
          if (formType === 'textarea') {
            comp = <TextArea style={{ resize: 'none', overflow: 'auto' }} rows={3} />;
          }
          if (formType === 'file') {
            comp = (
              <div>
                <UploadFile
                  accept=".doc,.docx,.xls,.xlsx,.ppt,.pdf,.txt"
                  extendsPayload={{
                    sessionType: 'AGENT',
                    sessionId: currentSession?.sessionId || '',
                  }}
                  onCreate={onCreateFile}
                  onUpdate={onUpdateFile}
                  onRemove={onRemoveFile}
                  setSessionId={handleSetSessionId}
                  disabled={disabled}
                >
                  <Button icon={<CloudUploadOutlined />}>
                    {intl.formatMessage({ id: 'messageForm.clickToUpload' })}
                  </Button>
                </UploadFile>
                {!isEmpty(fileList) && (
                  <div>
                    <CarouselFile
                      items={fileList.map((file) => ({
                        fileItem: file,
                        renderFileType: 'file',
                      }))}
                      onClose={(fileItem) => {
                        setFileList((prevState) => {
                          const newState = [...(prevState || [])];
                          pullAllBy(newState, [fileItem?.fileItem], 'uid');
                          return newState;
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            );
          }

          return (
            <Col span={['textarea', 'file'].includes(formType) ? 24 : 12} key={idx}>
              <Form.Item
                name={fieldCode}
                label={fieldName}
                rules={[{ required }]}
                tooltip={description ? { title: description, icon: <InfoCircleOutlined /> } : undefined}
                initialValue={fieldValue || defaultValue}
                extra={
                  formType === 'file' && defaultFiles
                    ? intl.formatMessage({ id: 'messageForm.pleaseUpload' }, { files: defaultFiles.join('、') })
                    : undefined
                }
              >
                {comp}
              </Form.Item>
            </Col>
          );
        })}
      </Row>
    </Form>
  );
});

export default MessageForm;
