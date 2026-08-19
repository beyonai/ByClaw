import { Alert, Button, Select, Spin } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';

import { getModelListByPage } from '@/pages/manager/service/ModelMgr';
import {
  buildImageModelOptions,
  getImageModelRows,
  normalizeImageModelId,
  type ImageModelOption,
} from './imageModelUtils';

interface ImageModelSelectProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

const IMAGE_MODEL_QUERY = {
  modelType: 'IMAGE_GENERATION',
  status: 'ENABLED',
  pageNum: 1,
  pageSize: 1000,
};

const ImageModelSelect = ({ value, onChange, disabled = false }: ImageModelSelectProps) => {
  const intl = useIntl();
  const globalDefaultLabel = intl.formatMessage({ id: 'employeeDetail.imageModelGlobalDefault' });
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [models, setModels] = useState<ImageModelOption[]>([{ label: globalDefaultLabel, value: '' }]);
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
    getModelListByPage(IMAGE_MODEL_QUERY)
      .then((response) => {
        if (response?.code !== 0) throw new Error(response?.msg || 'image model request failed');
        if (!mountedRef.current) return;
        setModels(buildImageModelOptions(getImageModelRows(response), globalDefaultLabel));
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setModels([{ label: globalDefaultLabel, value: '' }]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [globalDefaultLabel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const selectedValue = useMemo(() => normalizeImageModelId(value) || '', [value]);
  const options = useMemo(() => {
    if (!selectedValue || models.some((option) => option.value === selectedValue)) return models;
    return [...models, { label: selectedValue, value: selectedValue }];
  }, [models, selectedValue]);

  return (
    <div style={{ padding: '0 16px' }}>
      <label style={{ display: 'block', marginBottom: 8 }}>
        {intl.formatMessage({ id: 'employeeDetail.imageModel' })}
      </label>
      <Select
        aria-label={intl.formatMessage({ id: 'employeeDetail.imageModel' })}
        disabled={disabled || loading || loadFailed}
        loading={loading}
        notFoundContent={loading ? <Spin size="small" /> : undefined}
        options={options}
        placeholder={intl.formatMessage({ id: 'employeeDetail.imageModelPlaceholder' })}
        style={{ width: '100%' }}
        value={selectedValue}
        onChange={(nextValue) => onChange(normalizeImageModelId(nextValue))}
      />
      {loadFailed && (
        <Alert
          action={
            <Button size="small" onClick={loadModels}>
              {intl.formatMessage({ id: 'employeeDetail.imageModelRetry' })}
            </Button>
          }
          message={intl.formatMessage({ id: 'employeeDetail.imageModelLoadError' })}
          showIcon
          style={{ marginTop: 8 }}
          type="error"
        />
      )}
    </div>
  );
};

export default ImageModelSelect;
