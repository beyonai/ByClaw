import AceEditor from '@/components/AceEditor';
import AntdIcon from '@/components/AntdIcon';
import { Button, Modal, Space, message } from 'antd';
import classnames from 'classnames';
import copy from 'copy-to-clipboard';
import { useMemo } from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './inde.module.less';

type IProps = {
  className?: string;
  visible: boolean;
  onVisible: (isOpen: boolean) => void;
  codeData: string;
};

function CodeModal(props: IProps) {
  const { className, visible, onVisible, codeData } = props;
  const intl = useIntl();

  const modalTitle = useMemo(() => {
    return (
      <div className="ub ub-pj">
        <span style={{ fontSize: '18px' }}>{intl.formatMessage({ id: 'thinkTaskPrepare.thinkTaskPrepare' })}</span>
        <Space>
          <Button
            type="link"
            style={{ fontSize: '16px' }}
            onClick={() => {
              copy(codeData);
              message.success(intl.formatMessage({ id: 'common.copySuccess' }));
            }}
          >
            {intl.formatMessage({ id: 'common.copy' })}
          </Button>
          <AntdIcon type="icon-a-Closeguanbi" style={{ fontSize: '16px' }} onClick={() => onVisible(false)} />
        </Space>
      </div>
    );
  }, [codeData, intl]);

  return (
    <Modal
      className={classnames(styles.sqlModal, className)}
      centered
      title={modalTitle}
      open={visible}
      onCancel={() => onVisible(false)}
      width="60%"
      styles={{
        body: {
          height: '524px',
        },
      }}
      footer={null}
      closeIcon={null}
      destroyOnHidden
    >
      <div style={{ width: '100%', height: '100%' }}>
        <AceEditor formatValue={codeData} mode="python" />
      </div>
    </Modal>
  );
}

export default CodeModal;
