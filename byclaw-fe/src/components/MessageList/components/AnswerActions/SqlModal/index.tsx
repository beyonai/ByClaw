import AceEditor from '@/components/AceEditor';
import AntdIcon from '@/components/AntdIcon';
import { Button, Modal, Space, message } from 'antd';
import classnames from 'classnames';
import copy from 'copy-to-clipboard';
import { useMemo } from 'react';
// sql-formatter的体积稍微大一些，建议别的地方需要用的话，按需引入
import { format } from 'sql-formatter';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './inde.module.less';

type IProps = {
  className?: string;
  visible: boolean;
  onVisible: (isOpen: boolean) => void;
  sqlData: string;
};

function sqlFormat(str: string, cfg?: any) {
  let strFormat = str;
  try {
    strFormat = format(str, cfg);
  } catch (e) {
    strFormat = str;
    console.error(e);
  }

  return strFormat;
}

function SqlModal(props: IProps) {
  const { className, visible, onVisible, sqlData } = props;
  const intl = useIntl();

  const modalTitle = useMemo(() => {
    return (
      <div className="ub ub-pj">
        <span style={{ fontSize: '18px' }}>{intl.formatMessage({ id: 'messageList.sqlAnalysis' })}</span>
        <Space>
          <Button
            type="link"
            style={{ fontSize: '16px' }}
            onClick={() => {
              copy(sqlFormat(sqlData));
              message.success(intl.formatMessage({ id: 'common.copySuccess' }));
            }}
          >
            {intl.formatMessage({ id: 'common.copy' })}
          </Button>
          <AntdIcon type="icon-a-Closeguanbi" style={{ fontSize: '16px' }} onClick={() => onVisible(false)} />
        </Space>
      </div>
    );
  }, [sqlData, intl]);

  return (
    <Modal
      className={classnames(styles.sqlModal, className)}
      centered
      title={modalTitle}
      open={visible}
      onCancel={() => onVisible(false)}
      width="618px"
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
        <AceEditor formatValue={sqlFormat(sqlData)} />
      </div>
    </Modal>
  );
}

export default SqlModal;
