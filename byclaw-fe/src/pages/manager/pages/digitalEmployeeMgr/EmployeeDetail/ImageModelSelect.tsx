import { DownOutlined, PictureOutlined, SoundOutlined } from '@ant-design/icons';
import { Alert, Button, Popover, Radio, Spin, Tabs } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';

import {
  getPersonalModelList,
  getPublicModelList,
  type ModelListByPageResponse,
} from '@/pages/manager/service/ModelMgr';
import {
  buildImageModelOptions,
  getImageModelRows,
  normalizeImageModelId,
  type ImageModelOption,
} from './imageModelUtils';
import styles from './ImageModelSelect.module.less';

interface ImageModelSelectProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  modelType?: string;
  label?: string;
  configurationLabel?: string;
}

type ModelScope = 'mine' | 'public';

const IMAGE_MODEL_QUERY = {
  status: 'ENABLED',
  pageNum: 1,
  pageSize: 1000,
};

const isSuccessfulResponse = (response?: ModelListByPageResponse) =>
  response?.code === undefined || response.code === 0;

const ImageModelSelect = ({ value, onChange, disabled = false, modelType = 'IMAGE_GENERATION', label, configurationLabel }: ImageModelSelectProps) => {
  const intl = useIntl();
  const globalDefaultLabel = intl.formatMessage({ id: 'employeeDetail.imageModelGlobalDefault' });
  const displayLabel = label || intl.formatMessage({ id: 'employeeDetail.imageModel' });
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeScope, setActiveScope] = useState<ModelScope>('public');
  const [modelGroups, setModelGroups] = useState<Record<ModelScope, ImageModelOption[]>>({ mine: [], public: [] });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadModels = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    const query = { ...IMAGE_MODEL_QUERY, modelType };
    Promise.all([getPersonalModelList(query), getPublicModelList(query)])
      .then(([personalResponse, publicResponse]) => {
        if (!isSuccessfulResponse(personalResponse) || !isSuccessfulResponse(publicResponse)) {
          throw new Error('image model request failed');
        }
        if (!mountedRef.current) return;
        setModelGroups({
          mine: buildImageModelOptions(getImageModelRows(personalResponse), globalDefaultLabel, false),
          public: buildImageModelOptions(getImageModelRows(publicResponse), globalDefaultLabel, false),
        });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setModelGroups({ mine: [], public: [] });
        setLoadFailed(true);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [globalDefaultLabel, modelType]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const selectedValue = useMemo(() => normalizeImageModelId(value) || '', [value]);
  const selectedOption = useMemo(
    () => [...modelGroups.mine, ...modelGroups.public].find((option) => option.value === selectedValue),
    [modelGroups, selectedValue]
  );
  const selectedLabel = selectedOption?.label || selectedValue || globalDefaultLabel;
  const currentModels = modelGroups[activeScope];

  const popoverContent = (
    <div className={styles.modelPopover}>
      <div className={styles.popoverTitle}>{configurationLabel || intl.formatMessage({ id: 'employeeDetail.imageModelConfiguration' })}</div>
      <Tabs
        activeKey={activeScope}
        className={styles.scopeTabs}
        size="small"
        onChange={(key) => setActiveScope(key as ModelScope)}
        items={[
          { key: 'mine', label: intl.formatMessage({ id: 'modelPopover.mine' }) },
          { key: 'public', label: intl.formatMessage({ id: 'modelPopover.public' }) },
        ]}
      />
      <Spin spinning={loading}>
        <Radio.Group
          className={styles.modelList}
          value={selectedValue}
          onChange={(event) => onChange(normalizeImageModelId(event.target.value))}
        >
          <div className={styles.modelItem}>
            <Radio value="">{globalDefaultLabel}</Radio>
          </div>
          {currentModels.map((model) => (
            <div key={model.value} className={styles.modelItem}>
              <Radio value={model.value}>
                <span className={styles.modelName}>{model.label}</span>
              </Radio>
            </div>
          ))}
          {currentModels.length === 0 && !loading && (
            <div className={styles.emptyTip}>{intl.formatMessage({ id: 'modelPopover.noModels' })}</div>
          )}
        </Radio.Group>
      </Spin>
      <div className={styles.popoverFooter}>
        <Button size="small" type="primary" onClick={() => setOpen(false)}>
          {intl.formatMessage({ id: 'modelPopover.confirm' })}
        </Button>
      </div>
    </div>
  );

  return (
    <div className={styles.imageModelConfig}>
      <span className={styles.configLabel}>{displayLabel}</span>
      <Popover
        arrow={false}
        content={popoverContent}
        open={open}
        placement="bottomRight"
        trigger={disabled || loading || loadFailed ? [] : ['click']}
        onOpenChange={setOpen}
      >
        <button
          aria-label={displayLabel}
          className={styles.modelTrigger}
          disabled={disabled || loading || loadFailed}
          title={selectedLabel}
          type="button"
        >
          {modelType === 'TTS' ? <SoundOutlined className={styles.modelIcon} /> : <PictureOutlined className={styles.modelIcon} />}
          <span className={styles.selectedModel}>{selectedLabel}</span>
          <DownOutlined className={styles.downIcon} />
        </button>
      </Popover>
      {loadFailed && (
        <Alert
          action={
            <Button size="small" onClick={loadModels}>
              {intl.formatMessage({ id: 'employeeDetail.imageModelRetry' })}
            </Button>
          }
          className={styles.loadError}
          message={intl.formatMessage({ id: 'employeeDetail.imageModelLoadError' })}
          showIcon
          type="error"
        />
      )}
    </div>
  );
};

export default ImageModelSelect;
