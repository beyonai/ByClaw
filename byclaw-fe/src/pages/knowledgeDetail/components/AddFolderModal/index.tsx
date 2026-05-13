import ModalDrawer from '@/components/ModalDrawer';
import { useRequest } from '@/hooks/useRequest';
import { createFolder } from '@/service/knowledgeCenter';
import { Form, Input, message } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

interface RenameModalProps {
  baseInfo?: any;
  onCancel?: () => void;
  reload?: () => void;

  /** 当前所在父目录路径，根目录为 "/"，与列表项 directoryPath 语义一致 */
  parentDirectoryPath?: string;
}

const AddFolderModal = (props: RenameModalProps) => {
  const { baseInfo, onCancel, reload, parentDirectoryPath = '/' } = props;

  const intl = useIntl();
  const [form] = Form.useForm();

  const { mutate, isLoading } = useRequest({
    mutationFn: (params) => createFolder(params),
    onSuccess: (res) => {
      if (res) {
        message.success(intl.formatMessage({ id: 'common.add' }) + intl.formatMessage({ id: 'common.success' }));
        onCancel?.();
        reload?.();
      }
    },
  });

  const handleOk = async () => {
    const res = await form.validateFields();
    if (res) {
      const { folderName, directoryDescription } = res;
      const rid = baseInfo?.resourceId;
      mutate({
        resourceId: rid !== undefined && rid !== null && rid !== '' ? Number(rid) : rid,
        directoryName: folderName,
        directoryPath: parentDirectoryPath,
        directoryDescription: directoryDescription ?? '',
      });
    }
  };

  return (
    <ModalDrawer
      type="modal"
      title={intl.formatMessage({ id: 'knowledgeDetail.newFolder' })}
      open
      width={500}
      showFoot={false}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={isLoading}
    >
      <Form form={form} labelCol={{ span: 4 }} initialValues={{ directoryDescription: '' }}>
        <Form.Item
          name="folderName"
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                {
                  id: 'form.inputPlaceholder',
                },
                {
                  content: intl.formatMessage({
                    id: 'directoryManage.folderName',
                  }),
                }
              ),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage(
              {
                id: 'form.inputPlaceholder',
              },
              {
                content: intl.formatMessage({
                  id: 'directoryManage.folderName',
                }),
              }
            )}
          />
        </Form.Item>
        {/* <Form.Item name="directoryDescription" label={intl.formatMessage({ id: 'form.desc' })}>
          <Input.TextArea
            rows={3}
            placeholder={intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              { content: intl.formatMessage({ id: 'form.desc' }) }
            )}
          />
        </Form.Item> */}
      </Form>
    </ModalDrawer>
  );
};

export default AddFolderModal;
