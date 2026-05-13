// @ts-nocheck
/* eslint-disable no-nested-ternary, @typescript-eslint/no-unused-vars */
import React, { useMemo, useRef, useState } from 'react';
import { Button, Space, Divider, Empty, Tag, Tooltip } from 'antd';
import { connect, useIntl } from '@umijs/max';
import { useHover } from 'ahooks';
import dayjs from 'dayjs';
import { InfoCircleOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import styles from './index.module.less';
import ParamsContent from '../ParamsContent';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import Ellipsis from '@/pages/manager/components/Ellipsis';

const ItemCard = ({
  item,
  appId,
  isPlugin,
  isDataset,
  reload,
  baseListOpt,
  handleSelect,
  skills,
  knowledgeBases,
  handleRemove,
}) => {
  const intl = useIntl();

  const [expland, setExpland] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [addLoading, setAddLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [delLoading, setDelLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingMap, setLoadingMap] = useState({});

  // 知识库、数据库的id区分
  const idKey = isDataset ? 'id' : 'baseId';

  const handleAdd = () => {
    handleSelect(item);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const OperBtn = ({ record, isAdd }) => {
    const ref = useRef(null);
    const isHovering = useHover(ref);

    if (
      (isPlugin && skills.some((it) => it.resourceId === item.resourceId)) ||
      (!isPlugin && knowledgeBases.some((it) => it.items?.some((i) => i.resourceId === item.resourceId)))
    ) {
      return (
        <Button
          className={classnames(styles.actionButton, {
            [styles.isAdd]: isAdd && !isHovering,
          })}
          danger={isHovering}
          ref={ref}
          onClick={() => {
            handleRemove(item);
          }}
          size="small"
        >
          {isHovering ? intl.formatMessage({ id: 'itemCard.remove' }) : intl.formatMessage({ id: 'itemCard.added' })}
        </Button>
      );
    }
    return (
      <Button
        className={classnames(styles.actionButton, styles.notAdd)}
        onClick={() => {
          handleAdd();
        }}
        loading={addLoading}
        size="small"
      >
        {intl.formatMessage({ id: 'common.add' })}
      </Button>
    );
  };

  const selectedIds = useMemo(
    () => baseListOpt.map((it) => (isPlugin ? it.pluginMachineId : String(it[idKey]))),
    [baseListOpt, isPlugin, idKey]
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const PluginMachineList = () => {
    const { pluginMachines = [] } = item;

    return (
      <div
        className={classnames(styles.pluginList, {
          [styles.isExpand]: expland,
        })}
      >
        {!pluginMachines.length && <Empty />}
        {!!pluginMachines.length && (
          <div>
            {pluginMachines.map((machine) => {
              const { fieldOutParam, pluginMachineId, machineName, machineDesc, fields } = machine;

              let fieldOut = [];
              if (fieldOutParam) {
                try {
                  fieldOut = JSON.parse(fieldOutParam);
                } catch (error) {
                  console.error(error);
                }
              }

              return (
                <div key={pluginMachineId}>
                  <div className="ub ub-ac" style={{ marginBottom: '6px' }}>
                    <div style={{ width: '36px', marginRight: '12px' }} />
                    <div className="ub-f1">
                      <div className={styles.title}>{machineName}</div>
                      <div className={styles.desc} style={{ marginBottom: '4px' }}>
                        {machineDesc}
                      </div>
                      {fields && (
                        <div style={{ marginBottom: '4px' }}>
                          {fields.map((it, i) => (
                            <Tag
                              key={i}
                              style={{
                                padding: '2px 6px',
                                marginLeft: i > 0 ? '12px' : 0,
                              }}
                            >
                              {it.fieldCode}
                            </Tag>
                          ))}
                          <Tooltip title={<ParamsContent fields={fields} />}>
                            <span
                              style={{
                                marginLeft: '12px',
                                fontSize: '12px',
                                color: '#165DFF',
                                cursor: 'pointer',
                              }}
                            >
                              {intl.formatMessage({
                                id: 'itemCard.inputParams',
                              })}{' '}
                              <InfoCircleOutlined />
                            </span>
                          </Tooltip>
                        </div>
                      )}
                      {fieldOut.length > 0 && (
                        <div style={{ marginBottom: '4px' }}>
                          {fieldOut.map((it, i) => (
                            <Tag
                              key={i}
                              style={{
                                padding: '2px 6px',
                                marginLeft: i > 0 ? '12px' : 0,
                              }}
                            >
                              {it.fieldCode}
                            </Tag>
                          ))}
                          <Tooltip title={<ParamsContent fields={fieldOut} />}>
                            <span
                              style={{
                                marginLeft: '12px',
                                fontSize: '12px',
                                color: '#165DFF',
                                cursor: 'pointer',
                              }}
                            >
                              {intl.formatMessage({
                                id: 'itemCard.outputParams',
                              })}{' '}
                              <InfoCircleOutlined />
                            </span>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                    <div style={{ marginRight: '16px' }}>
                      <OperBtn record={machine} isAdd={selectedIds.includes(pluginMachineId)} />
                    </div>
                  </div>
                  <Divider />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const avatarIconType = useMemo(
    () => (isDataset ? 'icon-chuangjianfangshi-wendangku' : isPlugin ? 'icon-chajiantubiao' : 'icon-zhishiku2'),
    [isDataset, isPlugin]
  );

  return (
    <div className={classnames(styles.cardItemWrap, {})}>
      <div className={styles.cardItem} onClick={() => setExpland(!expland)}>
        <AntdIcon type={avatarIconType} style={{ fontSize: '36px', marginRight: 12 }} />
        <div style={{ flex: 1 }}>
          <div className={styles.title}>
            {item.resourceName}
            {item.tags && JSON.parse(item.tags)?.map((it) => <Tag key={it}>{it}</Tag>)}
          </div>
          <div className={styles.desc}>
            <Ellipsis lines={1} tooltip>
              {item.description || intl.formatMessage({ id: 'itemCard.noDescription' })}
            </Ellipsis>
          </div>
          <Space>
            {/* {!isPlugin && ( */}
            <>
              <span>@{item.createUserName || '-'}</span>
              <Divider type="vertical" />
            </>
            {/* )} */}
            <span>
              {intl.formatMessage({ id: 'itemCard.createdAt' })}{' '}
              {item.createTime ? dayjs(item.createTime).format('YYYY-MM-DD HH:mm') : null}
            </span>
          </Space>
        </div>
        <div style={{ width: '100px', height: '28px' }}>
          <OperBtn isAdd={selectedIds.includes(item.id)} />
        </div>
      </div>
      <Divider style={{ marginTop: 0, marginBottom: 0 }} />
    </div>
  );
};

export default connect(({ employeeMgr }) => ({
  baseListOpt: employeeMgr.baseListOpt,
}))(ItemCard);
