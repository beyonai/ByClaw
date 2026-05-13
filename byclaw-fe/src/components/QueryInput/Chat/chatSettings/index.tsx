import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { ConfigProvider, List, Switch } from 'antd';
import { isEmpty, cloneDeep, unset, values, flatten } from 'lodash';
import datacloudImg from './assets/datacloud.png';
import functioncloudImg from './assets/functioncloud.png';
import memoryImg from './assets/memory.png';
import EmptyComp from '@/components/Empty';
import jingjiaImg from './assets/jingjia.png';
import chromeImg from './assets/chrome.png';
import AntdIcon from '@/components/AntdIcon';
import useAppStore from '@/models/common/useAppStore';

import { getIntl } from '@umijs/max';

import type {
  IChatSettingValue,
  ISettingConf,
  SettingItemKey,
  IChatSettingJSON,
  ISettingConfContent,
} from '@/typescript/cloud';

import styles from './index.module.less';

interface Props {
  beyondSmartMode?: boolean;
  value: IChatSettingValue;
  onChange: (chatSettings: IChatSettingValue, isInitial?: boolean) => void;
  hideBlock?: Array<keyof ISettingConf>;
}

function getChatSettingValue(configJson: ISettingConf) {
  return {
    dataCloud: configJson.dataCloud.reduce((prev, cur) => {
      prev[cur.key] = cur.choiceValue;
      return prev;
    }, {} as Record<SettingItemKey, any>),
    functionCloud: configJson.functionCloud.reduce((prev, cur) => {
      prev[cur.key] = cur.choiceValue;
      return prev;
    }, {} as Record<SettingItemKey, any>),
    memory: configJson.memory?.reduce((prev, cur) => {
      prev[cur.key] = cur.choiceValue;
      return prev;
    }, {} as Record<SettingItemKey, any>),
  };
}

function ListItemIcon({ data }: { data: ISettingConfContent }) {
  const { icon, key } = data;
  return useMemo(() => {
    switch (key) {
      case 'internetData':
        return <AntdIcon type="icon-a-Sphereyuanqiu" />;
      case 'internalKnowledgeBase':
        return <AntdIcon type="icon-a-Book-oneshuji11" />;
      case 'personalBasicInfo':
        return <AntdIcon type="icon-a-Peoplerenyuan" />;
      case 'jingjiaBusinessData':
        return <AntdIcon type="icon-a-Database-networkshujukuwangluo" />;
      case 'subscribedDigitalEmployees':
        return <AntdIcon type="icon-cebianlan-shuziyuangong" />;
      case 'browserPageData':
        return <AntdIcon type="icon-a-Browser-chromeliulanqi" />;
      case 'jingjiaSystem':
        return <img alt="" src={jingjiaImg} />;
      case 'googleChrome':
        return <img alt="" src={chromeImg} />;
      default: {
        if (icon) {
          return <AntdIcon type={icon} />;
        }
        return null;
      }
    }
  }, [key]);
}

const emptyArr: Array<keyof ISettingConf> = [];

export default function ChatSettings(props: Props) {
  const { value, onChange, beyondSmartMode = false, hideBlock = emptyArr } = props;
  const [, startTransition] = useTransition();
  const [configJson, setConfigJson] = useState<ISettingConf>({ dataCloud: [], functionCloud: [], memory: [] });

  const { cloudSettings } = useAppStore();

  const isEmptyJson = React.useMemo(() => {
    const myJson = cloneDeep(configJson);

    if (hideBlock.includes('dataCloud')) {
      unset(myJson, 'dataCloud');
    }
    if (hideBlock.includes('functionCloud')) {
      unset(myJson, 'functionCloud');
    }
    if (hideBlock.includes('memory')) {
      unset(myJson, 'memory');
    }

    return isEmpty(flatten(values(myJson)));
  }, [configJson, hideBlock]);

  useEffect(() => {
    if (isEmpty(cloudSettings)) return;
    startTransition(() => {
      setConfigJson(cloudSettings as ISettingConf);
      onChange(getChatSettingValue(cloudSettings as ISettingConf), true);
    });
  }, [cloudSettings]);

  useEffect(() => {
    if (configJson.functionCloud?.length) {
      setConfigJson((prev) => ({
        ...prev,
        functionCloud: prev.functionCloud.map((i) => ({
          ...i,
          editable: beyondSmartMode,
        })),
      }));
    }
  }, [beyondSmartMode]);

  const renderList = (parentKey: keyof IChatSettingJSON) => {
    return (
      <ConfigProvider>
        <List
          split={false}
          className={styles.list}
          dataSource={configJson[parentKey]}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Switch
                  size="small"
                  key={`switch-${item.key}`}
                  disabled={!item.editable}
                  checked={value[parentKey]?.[item.key]}
                  onChange={(checked: boolean) => {
                    const newValues = {
                      [item.key]: checked,
                    };

                    onChange({
                      ...value,
                      [parentKey]: {
                        ...value[parentKey],
                        ...newValues,
                      },
                    });
                  }}
                />,
              ]}
            >
              <List.Item.Meta
                avatar={
                  <div className={styles.avatar}>
                    <ListItemIcon data={item} />
                  </div>
                }
                title={item.name}
                description={item.description}
              />
            </List.Item>
          )}
        />
      </ConfigProvider>
    );
  };

  if (isEmptyJson) return <EmptyComp />;

  return (
    <div>
      {!isEmpty(configJson?.dataCloud) && !hideBlock.includes('dataCloud') && (
        <>
          <div className={styles.header} style={{ background: 'linear-gradient(90deg, #E2F1FF 0%, #F7FBFF 100%)' }}>
            <img alt="" src={datacloudImg} />
            <span className={styles.groupTitle} style={{ color: '#031A79' }}>
              {getIntl().formatMessage({ id: 'chatSettings.dataCloudTitle' })}
            </span>
            <div className={styles.dot} style={{ background: '#031A79' }} />
            <span className={styles.groupDesc} style={{ color: '#031A79' }}>
              {getIntl().formatMessage({ id: 'chatSettings.dataSource' })}
            </span>
          </div>
          {renderList('dataCloud')}
        </>
      )}
      {!isEmpty(configJson?.functionCloud) && !hideBlock.includes('functionCloud') && (
        <>
          <div className={styles.header} style={{ background: 'linear-gradient(90deg, #E3E4FF 0%, #FAFAFF 100%)' }}>
            <img alt="" src={functioncloudImg} />
            <span className={styles.groupTitle} style={{ color: '#3C108F' }}>
              {getIntl().formatMessage({ id: 'chatSettings.functionCloudTitle' })}
            </span>
            <div className={styles.dot} style={{ background: '#3C108F' }} />
            <span className={styles.groupDesc} style={{ color: '#27066E' }}>
              {getIntl().formatMessage({ id: 'chatSettings.dataSource' })}
            </span>
          </div>
          {renderList('functionCloud')}
        </>
      )}
      {!isEmpty(configJson?.memory) && !hideBlock.includes('memory') && (
        <>
          <div className={styles.header} style={{ background: 'linear-gradient(90deg, #FBEBFF 0%, #FEFAFF 100%)' }}>
            <img alt="" src={memoryImg} />
            <span className={styles.groupTitle} style={{ color: '#3C108F' }}>
              {getIntl().formatMessage({ id: 'chatSettings.memoryTitle' })}
            </span>
            <div className={styles.dot} style={{ background: '#3C108F' }} />
            <span className={styles.groupDesc} style={{ color: '#27066E' }}>
              {getIntl().formatMessage({ id: 'chatSettings.memoryDesc' })}
            </span>
          </div>
          {renderList('memory')}
        </>
      )}
    </div>
  );
}
