import { AutoComplete, Form, Select, Switch } from 'antd';
import { useIntl } from '@umijs/max';
import { getSeedreamSizeSuggestions } from './volcengineImageConfig';
import styles from './ModelFormModal.module.less';

const VolcengineImageFields = ({ modelCode }: { modelCode?: string }) => {
  const intl = useIntl();
  return (
    <>
      <div className={`${styles.hintBlock} ${styles.gridColSpan3}`}>
        {intl.formatMessage({ id: 'modelMgr.modal.seedreamSingleImageHint' })}
      </div>
      <Form.Item
        label={intl.formatMessage({ id: 'modelMgr.modal.imageSize' })}
        name={['imageGenerationConfig', 'size']}
        rules={[
          {
            pattern: /^(?:[1-9]\d*K|[1-9]\d*x[1-9]\d*)$/,
            message: intl.formatMessage({ id: 'modelMgr.modal.imageSizeInvalid' }),
          },
        ]}
      >
        <AutoComplete placeholder="2K" options={getSeedreamSizeSuggestions(modelCode).map((value) => ({ value }))} />
      </Form.Item>
      <Form.Item
        label={intl.formatMessage({ id: 'modelMgr.modal.responseFormat' })}
        name={['imageGenerationConfig', 'responseFormat']}
      >
        <Select
          placeholder="URL"
          options={[
            { label: 'URL', value: 'url' },
            { label: 'Base64', value: 'b64_json' },
          ]}
        />
      </Form.Item>
      <Form.Item
        label={intl.formatMessage({ id: 'modelMgr.modal.imageWatermark' })}
        name={['imageGenerationConfig', 'watermark']}
        valuePropName="checked"
        getValueProps={(value) => ({ checked: value ?? true })}
      >
        <Switch />
      </Form.Item>
    </>
  );
};

export default VolcengineImageFields;
