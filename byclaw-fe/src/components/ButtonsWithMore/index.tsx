import { MoreOutlined } from '@ant-design/icons';
import { Dropdown, Popconfirm, PopconfirmProps, Space } from 'antd';
import { chunk } from 'lodash';
import React, { useMemo } from 'react';

const ButtonsWithMore = ({
  actions,
  maximun,
  handleAction,
}: {
  actions: {
    label: string;
    key: string;
    icon: React.ReactNode;
    comfirmProps?: PopconfirmProps;
    node?: React.ReactNode;
    disabled?: boolean;
  }[];
  maximun: number;
  handleAction: (key: string) => void;
}) => {
  const showMore = actions.length > maximun;
  const newAction = useMemo(
    () =>
      actions.map((ele, index) => {
        const isMore = showMore && index > maximun - 2;
        const { icon, label, comfirmProps, key, node } = ele;
        const content = !isMore ? (
          icon
        ) : (
          <span>
            {icon} {label}
          </span>
        );
        const defNode = comfirmProps ? (
          <Popconfirm onConfirm={() => handleAction(key)} {...comfirmProps}>
            {content}
          </Popconfirm>
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              handleAction(key);
            }}
          >
            {content}
          </span>
        );
        return {
          ...ele,
          label: node || defNode,
          icon: undefined,
        };
      }),
    [actions]
  );
  const chunks = chunk(newAction, maximun - 1); // 先不分结构造全部分块
  const pre = chunks[0]; // 前 maximun - 1 个按钮展示
  const moreList = ([] as (typeof newAction)[]).concat(...chunks.slice(1)); // 后面所有的合并成一个数组
  const btns = !showMore ? newAction : pre;
  return (
    <Space>
      {btns.map((action) => (
        <span
          className={`${action?.disabled ? 'disabled ' : ''}pointer mr-8`}
          key={action.key}
          onClick={action.comfirmProps ? undefined : () => handleAction(action.key)}
        >
          {action.label}
        </span>
      ))}
      {showMore && (
        <Dropdown menu={{ items: moreList }} placement="bottom">
          <span className="pointer mr-8">
            <MoreOutlined />
          </span>
        </Dropdown>
      )}
    </Space>
  );
};

export default ButtonsWithMore;
