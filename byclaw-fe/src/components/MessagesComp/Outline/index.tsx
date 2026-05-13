import {
  DeleteOutlined,
  HolderOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  BorderOuterOutlined,
} from '@ant-design/icons';
import { Button, Card, Dropdown, Input, Popconfirm, Space } from 'antd';
import classnames from 'classnames';
import { set } from 'lodash';
import { useEffect, useState } from 'react';
import type { IMessage } from '@/typescript/message';
import { getRandomNumber } from '@/utils/math';
import { getWriterMaterialUrl } from '@/utils/agent';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

const { TextArea } = Input;

// 定义大纲项接口 (支持递归嵌套)
interface OutlineItem {
  catalogue?: string;
  children?: OutlineItem[];
  createTime?: number;
  createUserId?: number;
  createUserName?: string;
  titleName?: string;
  docId?: number;
  id?: number;
  length?: number;
  level?: number;
  nodeContent?: string;
  nodeId: number;
  outlineLevel?: number;
  outlineName: string;
  paragraphRequire: string;
  parentId?: number;
  parentNodeId?: number;
  parentSortNo?: number;
  sortNo?: number;
  updateTime?: number;
}

// 定义文档接口
export interface IDocument {
  outlines?: OutlineItem[];
  outlineTree: OutlineItem[];
  id: number;
  nodeId?: number;
  title: string;
  pptDocTitle?: string;
  pointText: string;
  templateId: string;
  searchEnabled?: string;
  outlineType?: 'ppt' | 'writer';
}

export type IMessageListItemContent = {
  substance: IDocument;
};

export type IProps = {
  // eslint-disable-next-line react/no-unused-prop-types
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

const createOutlineItem = (parentNodeId?: number) => {
  return {
    outlineName: '',
    paragraphRequire: '',
    titleName: '',
    nodeId: getRandomNumber(0, 100000),
    parentNodeId,
    children: [],
  };
};

function Outline(props: IProps) {
  const { updateMessageListItemContent, messageListItemContent } = props;

  const intl = useIntl();

  const { EventEmitter } = useGlobal();

  const [activeSection, setActiveSection] = useState<string>();

  const isPPT = messageListItemContent?.substance?.outlineType === 'ppt';

  const titleKeyName = 'title';
  let outlinesKeyName = 'outlines';
  if (isPPT) {
    outlinesKeyName = 'outlineTree';
  }

  const [mySections, setMySections] = useState({
    ...(messageListItemContent?.substance || {}),
    [outlinesKeyName]: (messageListItemContent?.substance?.[outlinesKeyName] || []).map((item) => {
      return {
        ...createOutlineItem(item.nodeId || 0),
        ...item,
      };
    }),
  });

  const outlineList = mySections?.[outlinesKeyName] || [];
  const title = mySections?.[titleKeyName] || '';

  useEffect(() => {
    updateMessageListItemContent({
      substance: mySections,
    });
  }, [mySections]);

  if (!mySections.id) return null;

  return (
    <div className={classnames(styles.outline, 'mW600')}>
      <p style={{ color: '#1F2533', fontSize: '16px', marginBottom: '12px' }}>
        {intl.formatMessage({ id: 'outline.description' })}
      </p>
      <Card bordered={false} className={styles.titleCard}>
        <TextArea
          defaultValue={title}
          className={classnames(styles.textAreaBlock, 'ub-f1')}
          onChange={(e) => {
            setMySections((prev) => {
              set(prev, titleKeyName, e.target.value);
              return prev;
            });
          }}
        />
      </Card>
      {Array.isArray(outlineList) &&
        outlineList.map((section, idx) => {
          const { children = [] } = section;

          let valueKeyName = 'outlineName';
          if (isPPT) {
            valueKeyName = 'titleName';
          }

          let paragraphKeyName = 'paragraphRequire';
          if (isPPT) {
            paragraphKeyName = 'contentRequire';
          }

          return (
            <Card
              key={section.nodeId}
              title={
                <div className={styles.sectionCardTitle}>
                  <TextArea
                    placeholder={intl.formatMessage(
                      { id: 'form.inputPlaceholder' },
                      {
                        content: intl.formatMessage({
                          id: 'outline.sectionName',
                        }),
                      }
                    )}
                    defaultValue={section[valueKeyName]}
                    className={classnames(styles.textAreaBlock, 'ub-f1')}
                    onChange={(e) => {
                      setMySections((prev) => {
                        const p = prev?.[outlinesKeyName]?.[idx];
                        if (!p) return prev;

                        set(p, valueKeyName, e.target.value);
                        set(p, 'catalogue', e.target.value);
                        return prev;
                      });
                    }}
                  />
                  <div className={styles.cardActions}>
                    {!isPPT && section.id && (
                      <Button
                        type="text"
                        size="small"
                        icon={<BorderOuterOutlined />}
                        onClick={() => {
                          const { title } = mySections;

                          EventEmitter.emit('beyond-absolute-driver-open-type', {
                            drawerType: 'writerMateriaIframe',
                            canClose: true,
                          });

                          EventEmitter.emit('beyond-absolute-driver-message', {
                            url: getWriterMaterialUrl({
                              docId: mySections.id,
                              outlineId: section.id,
                              title,
                              templateId: mySections.templateId,
                              searchEnabled: `${mySections.searchEnabled}` === '1',
                            }),
                          });
                        }}
                      />
                    )}
                    <Popconfirm
                      title={intl.formatMessage(
                        {
                          id: 'common.deleteConfirm',
                        },
                        {
                          content: intl.formatMessage({
                            id: 'outline.section',
                          }),
                        }
                      )}
                      onConfirm={() => {
                        setMySections((prev) => {
                          prev?.[outlinesKeyName]?.splice(idx, 1);
                          return { ...prev };
                        });
                      }}
                    >
                      <Button type="text" icon={<DeleteOutlined />} size="small" />
                    </Popconfirm>
                    <Button
                      type="text"
                      icon={<PlusOutlined />}
                      size="small"
                      onClick={() => {
                        setMySections((prev) => {
                          const p = prev?.[outlinesKeyName]?.[idx];
                          if (!p) return prev;

                          p.children = p.children || [];
                          p.children.push(createOutlineItem(p.nodeId));

                          return { ...prev };
                        });
                      }}
                    />
                  </div>
                </div>
              }
              className={styles.sectionCard}
              bordered={false}
            >
              {children.map((child, index) => {
                const childKey = `${section.nodeId}_${child.nodeId}`;
                return (
                  <div key={childKey} className={classnames(styles.section, 'ub')}>
                    <HolderOutlined style={{ margin: '12px 4px 0 0' }} />
                    <div
                      className={classnames(styles.sectionContentBlock, 'ub ub-ver ub-f1', {
                        [styles.active]: activeSection === childKey,
                      })}
                      onClick={() => {
                        setActiveSection(childKey);
                      }}
                    >
                      <div className={styles.sectionHeader}>
                        <TextArea
                          placeholder={intl.formatMessage(
                            { id: 'form.inputPlaceholder' },
                            {
                              content: intl.formatMessage({ id: 'layout.title' }),
                            }
                          )}
                          defaultValue={child[valueKeyName]}
                          className={classnames(styles.textAreaBlock, 'ub-f1')}
                          onChange={(e) => {
                            setMySections((prev) => {
                              const p = prev?.[outlinesKeyName]?.[idx];
                              if (!p) return prev;

                              set(p, `children.${index}.${valueKeyName}`, e.target.value);
                              set(p, `children.${index}.catalogue`, e.target.value);

                              return prev;
                            });
                          }}
                        />
                        <Space style={{ marginRight: '12px' }}>
                          <Popconfirm
                            title={intl.formatMessage(
                              {
                                id: 'common.deleteConfirm',
                              },
                              {
                                content: intl.formatMessage({
                                  id: 'outline.section',
                                }),
                              }
                            )}
                            onConfirm={() => {
                              setMySections((prev) => {
                                const p = prev?.[outlinesKeyName]?.[idx];
                                p?.children?.splice(index, 1);
                                return { ...prev };
                              });
                            }}
                          >
                            <Button type="text" icon={<DeleteOutlined />} size="small" />
                          </Popconfirm>
                          <Dropdown
                            menu={{
                              items: [
                                {
                                  key: 'addBefore',
                                  label: intl.formatMessage({
                                    id: 'outline.insertBefore',
                                  }),
                                },
                                {
                                  key: 'addAfter',
                                  label: intl.formatMessage({
                                    id: 'outline.insertAfter',
                                  }),
                                },
                              ],
                              onClick: ({ key, domEvent }) => {
                                domEvent.preventDefault();
                                domEvent.stopPropagation();
                                if (key === 'addBefore') {
                                  setMySections((prev) => {
                                    const p = prev?.[outlinesKeyName]?.[idx];
                                    p?.children?.splice(index, 0, createOutlineItem(p.nodeId));
                                    return { ...prev };
                                  });
                                }
                                if (key === 'addAfter') {
                                  setMySections((prev) => {
                                    const p = prev?.[outlinesKeyName]?.[idx];
                                    p?.children?.splice(index + 1, 0, createOutlineItem(p.nodeId));
                                    return { ...prev };
                                  });
                                }
                              },
                            }}
                          >
                            <Button type="text" icon={<PlusOutlined />} size="small" />
                          </Dropdown>
                        </Space>
                      </div>
                      <div className={styles.sectionContent}>
                        <TextArea
                          placeholder={intl.formatMessage(
                            { id: 'form.inputPlaceholder' },
                            {
                              content: intl.formatMessage({
                                id: 'outline.content',
                              }),
                            }
                          )}
                          defaultValue={child[paragraphKeyName]}
                          className={classnames(styles.textAreaBlock, styles.paragraph, 'ub-f1')}
                          onChange={(e) => {
                            setMySections((prev) => {
                              const p = prev?.[outlinesKeyName]?.[idx];
                              if (!p) return prev;

                              set(p, `children.${index}.${paragraphKeyName}`, e.target.value);

                              return prev;
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>
          );
        })}

      <div
        className={classnames(styles.addSectionContainer, 'pointer')}
        onClick={() => {
          setMySections((prev) => {
            set(prev, outlinesKeyName, prev?.[outlinesKeyName] || []);
            prev?.[outlinesKeyName]?.push(createOutlineItem(mySections.nodeId || 0));
            return { ...prev };
          });
        }}
      >
        <PlusCircleOutlined style={{ marginRight: '12px' }} />
        {intl.formatMessage({ id: 'outline.addSection' })}
      </div>
    </div>
  );
}
export default Outline;
