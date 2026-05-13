import { DownOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import React, { useState } from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import AgentTabs from '@/components/QueryInput/RichInput/mentionPopover/agentTabs';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';

interface ToolSelectProps {
  onChange: (val: { toolName: string; toolType: string; toolId: string }) => void;
  value: any;
}

const ToolSelect: React.FC<ToolSelectProps> = ({ onChange, value }) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);

  // 处理选择
  const onSelect = React.useCallback(
    (item: any, type: any) => {
      console.log('item', item, type);
      // 这里可以根据需要处理选中项
      let toolType = type;
      let toolName = '';
      let toolId = '';
      if (type === ResourceType.tool) {
        toolType = 'TOOL';
        toolName = item.resourceName;
        toolId = item.resourceId;
      } else if (type === ResourceType.user) {
        // ResourceType.user暂时只支持企业员工，后期支持数字分身的话，这边逻辑要改
        toolType = 'HUMAN';
        toolName = item.userName;
        toolId = item.userId;
      } else if (type === ResourceType.digitalEmployee) {
        toolType = 'DIG_EMPLOYEE';
        toolName = item.name;
        toolId = item.agentId;
      }
      const toolData = {
        toolName,
        toolType,
        toolId,
      };
      onChange(toolData);
      setOpen(false);
    },
    [onChange]
  );

  // 自定义下拉内容-使用公共
  const dropdownRender = React.useCallback(
    () => (
      <div style={{ padding: '8px', height: '300px', width: '500px' }}>
        <AgentTabs onSelect={onSelect} showCompany={false} showDefaultAgent showToolList showDefaultTools />
      </div>
    ),
    [onSelect]
  );

  return (
    <Select
      placeholder={intl.formatMessage({ id: 'form.select' })}
      value={value || undefined}
      open={open}
      onOpenChange={setOpen}
      popupRender={dropdownRender}
      popupMatchSelectWidth={false}
      suffixIcon={<DownOutlined />}
      style={{ width: '100%' }}
    />
  );
};

export default ToolSelect;
