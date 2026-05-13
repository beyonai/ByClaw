/* eslint-disable max-len */
import React, { useEffect } from 'react';
import classnames from 'classnames';
import { Dropdown, Button } from 'antd';
import { isEmpty, pullAllBy, head, debounce, size } from 'lodash';
import { CloseCircleOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';

export type ITreeData = {
  label: string;
  key: string;
  keypath: string;
  icon?: React.ReactNode;
  children?: ITreeData[];
};

type IProps = {
  title: string;
  treeData: ITreeData[];
  selectedList?: ITreeData[];
  onOk: (selectList: ITreeData[]) => void;
  mode?: 'radio' | 'checkbox';
};

const emptyArr: ITreeData[] = [];

// 受控组件
function TreeFilter(props: IProps) {
  const intl = useIntl();
  const { title, treeData, selectedList, onOk, mode } = props;

  const [open, setOpen] = React.useState(false);
  const [controlList, setControlList] = React.useState<ITreeData[]>(selectedList || emptyArr);
  const [selectList, setSelectList] = React.useState<ITreeData[]>(selectedList || emptyArr);
  const [hoverItem, setHoverItem] = React.useState<ITreeData | undefined>(undefined);
  // console.log(treeData)

  const hasChildItem = React.useMemo(() => {
    return treeData.find((i) => !isEmpty(i.children));
  }, [treeData]);

  const onMulitSelect = (record: ITreeData) => {
    setSelectList((prevList) => {
      const hasSelected = prevList.find((i) => i.key === record.key);
      const isRoot = record.keypath === record.key; // 根节点

      if (hasSelected) {
        return prevList.filter((i) => i.key !== record.key);
      }
      if (isRoot) {
        return [record];
      }
      return [...prevList, record];
    });
  };

  const onSingleSelect = (record: ITreeData) => {
    setSelectList((prevList) => {
      const hasSelected = prevList.find((i) => i.key === record.key);

      if (hasSelected) {
        if (mode === 'radio') return prevList;
        onOk?.([]);
        setOpen(false);
        return [];
      }
      onOk?.([record]);
      setOpen(false);
      return [record];
    });
  };

  const onSelect = React.useCallback(
    (record?: ITreeData) => {
      if (!record) return;

      if (hasChildItem) {
        onMulitSelect(record);
      } else {
        onSingleSelect(record);
      }
    },
    [hasChildItem]
  );

  // const onDelete = React.useCallback((record: ITreeData) => {
  //   setSelectList((prevList) => {
  //     return prevList.filter((i) => i.key !== record.key);
  //   })
  // }, []);

  const onHover = React.useCallback(
    debounce((record?: ITreeData) => {
      setHoverItem(record);
    }, 300),
    []
  );

  useEffect(() => {
    return () => {
      if (typeof onHover.cancel === 'function') {
        onHover.cancel();
      }
    };
  }, [onHover]);

  useEffect(() => {
    setControlList(selectedList || emptyArr);
    setSelectList(selectedList || emptyArr);
  }, [selectedList]);

  return (
    <Dropdown
      menu={{ items: [] }}
      placement="bottomLeft"
      open={open}
      // trigger={['click']}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) {
          const pKey = head(`${head(controlList)?.keypath}`?.split(',') || []);
          const pItem = treeData.find((p) => `${p.key}` === `${pKey}`);
          if (pItem) {
            setHoverItem(pItem);
          }
        }
        if (!isOpen) {
          setSelectList(controlList);
        }
      }}
      dropdownRender={() => {
        return (
          <div
            className={styles.dropdownRender}
            onMouseLeave={() => {
              onHover(undefined);
            }}
          >
            <div style={{ display: 'flex' }}>
              <div
                className={classnames(styles.left, {
                  [styles.isMutil]: hasChildItem,
                  [styles.isSingle]: !hasChildItem,
                })}
              >
                {treeData.map((item) => {
                  return (
                    <div
                      key={item.key}
                      className={classnames(styles.selectItem, {
                        [styles.selectItemActive]: selectList.find((i) => {
                          const keypathArr = `${i.keypath}`.split(',');
                          return `${head(keypathArr)}` === `${item.key}`;
                        }),
                      })}
                      onClick={() => {
                        onSelect(item);
                      }}
                      onMouseEnter={() => {
                        onHover(item);
                      }}
                    >
                      <div className={styles.text}>{item.label}</div>
                    </div>
                  );
                })}
              </div>
              {hasChildItem && (
                <div className={styles.right}>
                  {hoverItem && (
                    <>
                      <div
                        className={classnames(styles.selectItem, {
                          [styles.selectItemActive]: selectList.find((i) => i.key === hoverItem?.key),
                        })}
                        onClick={() => {
                          onSelect(hoverItem);
                        }}
                      >
                        {intl.formatMessage({ id: 'common.all' })}
                      </div>
                      {hoverItem?.children?.map((child) => {
                        return (
                          <div
                            key={child.key}
                            className={classnames(styles.selectItem, {
                              [styles.selectItemActive]: selectList.find((i) => i.key === child.key),
                            })}
                            onClick={() => {
                              setSelectList((prevList) => {
                                const pKey = head(`${child.keypath}`.split(',')) as string;

                                const newList = prevList.filter((i) => {
                                  const keypathArr = `${i.keypath}`.split(',');
                                  return `${head(keypathArr)}` === `${pKey}`;
                                }); // 去除不是该父类的

                                const hasSelected = newList.find((i) => i.key === child.key);
                                if (hasSelected) {
                                  return newList.filter((i) => i.key !== child.key);
                                }

                                pullAllBy(newList, [{ key: pKey }], 'key'); // 去除父类的全部
                                return [...newList, child];
                              });
                            }}
                          >
                            <div className={styles.text}>{child.label}</div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
            {hasChildItem && (
              <div className={styles.footer}>
                <Button
                  size="small"
                  onClick={() => {
                    setSelectList([]);
                  }}
                >
                  {intl.formatMessage({ id: 'common.reset' })}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    onOk?.([...selectList]);
                    setOpen(false);
                  }}
                >
                  {intl.formatMessage({ id: 'common.confirm' })}
                </Button>
              </div>
            )}
          </div>
        );
      }}
    >
      <div className={styles.wrapper}>
        <div className={styles.title}>
          {title}
          {!open && <DownOutlined style={{ fontSize: '10px' }} />}
          {open && <UpOutlined style={{ fontSize: '10px' }} />}
        </div>
        <div className={styles.body}>
          {isEmpty(controlList) &&
            treeData.slice(0, 3).map((item) => {
              return (
                <span
                  key={item.label}
                  className={classnames(styles.item)}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    onSelect(item);
                    onOk?.([item]);
                  }}
                >
                  {item.label}
                </span>
              );
            })}
          {!isEmpty(controlList) && (
            <div className={styles.selectedWrapper}>
              <>
                {size(controlList) > 3 ? (
                  <span className={classnames(styles.item, styles.selectedItem)}>
                    {head(controlList)?.label} +{size(controlList) - 1}
                  </span>
                ) : (
                  controlList.map((item) => {
                    return (
                      <span key={item.key} className={classnames(styles.item, styles.selectedItem)}>
                        {item.label}
                      </span>
                    );
                  })
                )}
              </>
              {mode !== 'radio' && (
                <CloseCircleOutlined
                  style={{ cursor: 'pointer', color: '#165dff' }}
                  onClick={() => {
                    setSelectList([]);
                    onOk?.([]);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </Dropdown>
  );
}

export default TreeFilter;
