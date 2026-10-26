import { Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';

import { listServiceSpec } from '@/pages/manager/service/SandboxMgr';
import { buildToolSandboxOptions, type ToolSandboxOption } from './toolSandboxUtils';

interface ToolSandboxSelectProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

/**
 * Which tool sandbox spec the employee's commands run in. The list is the
 * sandbox specs that are not open for login (the ones a DSH host starts on
 * demand); empty means the default tool sandbox.
 */
const ToolSandboxSelect = ({ value, onChange, disabled = false }: ToolSandboxSelectProps) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<ToolSandboxOption[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    listServiceSpec()
      .then((response: any) => {
        if (!mountedRef.current) return;
        const ok = response?.code === undefined || response.code === 0;
        setOptions(ok ? buildToolSandboxOptions(response?.data) : []);
      })
      .catch(() => {
        if (mountedRef.current) setOptions([]);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A selection the list no longer offers stays visible instead of silently vanishing.
  const shown =
    value && !options.some((option) => option.value === value) ? [...options, { value, label: value }] : options;

  return (
    <Select
      value={value}
      options={shown}
      loading={loading}
      disabled={disabled}
      allowClear
      placeholder={intl.formatMessage({ id: 'employeeDetail.toolSandboxDefault' })}
      style={{ minWidth: 200 }}
      onChange={(next) => onChange(next || undefined)}
    />
  );
};

export default ToolSandboxSelect;
