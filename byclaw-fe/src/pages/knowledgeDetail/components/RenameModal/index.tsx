import ModalDrawer from '@/components/ModalDrawer';
import { useRequest } from '@/hooks/useRequest';
import useKnowledgeStore from '@/models/useKnowledgeStore';
import { renameFolder, updateFileInfo, type RenameFolderPayload } from '@/service/knowledgeCenter';
import { Form, Input, message } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { useCallback, useEffect } from 'react';

interface RenameModalProps {
  open: boolean;
  type?: string;
  data?: any;
  onCancel?: () => void;
  onSuccess?: (params: { id: string; newName: string }) => any;
  resourceId?: string | number;
  onRenameSuccess?: () => void;
}

const RenameModal = (props: RenameModalProps) => {
  const { open, type, data, onSuccess, onCancel, resourceId, onRenameSuccess } = props;
  const isFolder = data?.type === 'directory';

  const intl = useIntl();
  const [form] = Form.useForm();

  const { directoryList, setState } = useKnowledgeStore();

  useEffect(() => {
    if (type === 'edit' && data) {
      if (isFolder) {
        form.setFieldsValue({
          name: data?.collectionName,
        });
      } else {
        form.setFieldsValue({
          name: data?.collectionName,
        });
      }
    }
  }, [data, isFolder, type, form]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    onCancel?.();
  }, []);

  const { mutate, isLoading } = useRequest({
    mutationFn: (params: any) => (isFolder ? renameFolder(params as RenameFolderPayload) : updateFileInfo(params)),
    onSuccess: (res, params: any) => {
      if (typeof onSuccess === 'function') {
        const folderKey = isFolder ? params?.directoryPath : params?.id;
        onSuccess({ id: folderKey, newName: isFolder ? params?.directoryName : params.name || params.fileName });
      } else {
        setState({
          directoryList: directoryList.map((it) => {
            if (isFolder && String(it?.directoryPath ?? '') === String(params?.directoryPath ?? '')) {
              const oldPath = String(params.directoryPath ?? '').replace(/\/$/, '');
              const segs = oldPath.split('/').filter(Boolean);
              if (segs.length > 0) {
                segs[segs.length - 1] = params.directoryName;
              } else {
                segs.push(params.directoryName);
              }
              const nextPath = `/${segs.join('/')}`;
              it.collectionName = params?.directoryName;
              it.name = params?.directoryName;
              it.directoryPath = nextPath;
              return it;
            }
            if (!isFolder && it?.id === params?.fileId) {
              it.collectionName = params?.fileName;
              return it;
            }
            return it;
          }),
        });
      }
      // 重命名成功后调用onRenameSuccess回调，通知父组件刷新列表
      if (typeof onRenameSuccess === 'function') {
        onRenameSuccess();
      }
      handleCancel();
    },
  });

  const resolveFolderDirectoryPath = () => {
    const fromRow = String(data?.directoryPath ?? '').trim();
    if (fromRow) {
      return fromRow.startsWith('/') ? fromRow : `/${fromRow}`;
    }
    const dirName = String(data?.collectionName ?? data?.name ?? '').trim();
    if (!dirName) return '';
    return `/${dirName}`;
  };

  const handleOk = async () => {
    const res = await form.validateFields();
    if (res) {
      const { name } = res;
      let params;
      if (isFolder) {
        const directoryPath = resolveFolderDirectoryPath();
        const rid = resourceId;
        if (!directoryPath) {
          message.error('无法解析目录路径');
          return;
        }
        if (rid === null || rid === undefined || rid === '') {
          message.error('缺少文档库 resourceId');
          return;
        }
        params = {
          resourceId: Number(rid),
          directoryName: name,
          directoryPath,
        } satisfies RenameFolderPayload;
      } else {
        params = { fileId: data?.id, fileName: name };
      }
      mutate(params);
    }
  };

  return (
    <ModalDrawer
      type="modal"
      title={intl.formatMessage({ id: 'directoryManage.rename' })}
      open={open}
      width={500}
      showFoot={false}
      onCancel={handleCancel}
      onOk={handleOk}
      confirmLoading={isLoading}
    >
      <Form form={form} labelCol={{ span: 3 }}>
        <Form.Item
          name="name"
          label={intl.formatMessage({ id: 'form.name' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                { id: 'form.inputPlaceholder' },
                { content: intl.formatMessage({ id: 'form.name' }) }
              ),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              { content: intl.formatMessage({ id: 'form.name' }) }
            )}
          />
        </Form.Item>
      </Form>
    </ModalDrawer>
  );
};

export default RenameModal;
