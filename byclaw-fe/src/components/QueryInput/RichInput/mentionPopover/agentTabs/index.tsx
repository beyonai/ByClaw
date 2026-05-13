import OrgUserSelector from '@/components/OrgUserSelector';
// import ToolList from '@/layout/sider/components/ToolList';
import { Tabs } from 'antd';
import React, { useState } from 'react';
import EmployeeList from '@/layout/sider/components/EmployeeList';
import { ResourceType } from '../../utils/constants';
import { IResourceType } from '../../types';
import { chatModeMap } from '@/constants/query';
import { getIntl } from '@umijs/max';

interface Props {
  onSelect: (item: any, type: IResourceType) => void;
  showDefaultAgent?: boolean;
  showToolList?: boolean;
  showDefaultTools?: boolean;
  showCompany?: boolean;
}

const AgentTabs: React.FC<Props> = ({ onSelect, showCompany, showToolList, showDefaultTools }) => {
  const [activeTab, setActiveTab] = useState('digital');
  const intl = getIntl();
  const items = React.useMemo(() => {
    const list = [
      {
        key: 'digital',
        label: intl.formatMessage({ id: 'common.digitalEmployee' }),
        children: (
          <EmployeeList
            style={{ height: 500 }}
            chatMode={chatModeMap.beyondSmart}
            onSelect={(item) => onSelect(item, ResourceType.digitalEmployee)}
          />
        ),
      },
    ];

    if (showCompany) {
      list.push({
        key: 'company',
        label: intl.formatMessage({ id: 'common.companyEmployee' }),
        children: (
          <OrgUserSelector
            disableChat
            onSelect={(item) => onSelect(item, ResourceType.user)}
            mentionRealEmployee={(item) => onSelect(item, ResourceType.user)}
          />
        ),
      });
    }

    // 根据 showToolList 决定是否添加工具tab
    // if (showToolList) {
    //   list.push({
    //     key: 'tool',
    //     label: intl.formatMessage({ id: 'common.tool' }),
    //     children: (
    //       <ToolList
    //         style={{ height: 500 }}
    //         onSelect={(item) => onSelect(item, ResourceType.tool)}
    //         showDefaultTools={showDefaultTools}
    //       />
    //     ),
    //   });
    // }

    return list;
  }, [onSelect, showCompany, showToolList, showDefaultTools]);

  return <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} />;
};

export default AgentTabs;
