// @ts-nocheck
import React, { useRef, useState } from 'react';
import { Input, Form, Card, Select, Collapse, Button, Popover } from 'antd';
import { customAlphabet } from 'nanoid';
import { compact, last, set } from 'lodash';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import AbilityBoundaryModal from '../../../EmployeeDetail/ConfigForm/AbilityBoundaryModal';
import AbilityExampleModal from '../../../EmployeeDetail/ConfigForm/AbilityExampleModal';

import styles from './index.module.less';

const { TextArea } = Input;
const { Panel } = Collapse;

// 能力图标选项
const abilityIcons = [
  { type: 'icon-a-List-topliebiao3', label: '列表' },
  { type: 'icon-a-Application-oneyingyong3', label: '立方体' },
  { type: 'icon-a-Asteriskxinghao3', label: '星星' },
  { type: 'icon-a-Circles-sevenyuanquan', label: '圆点' },
  { type: 'icon-a-Circle-threeyuanquan', label: '人物' },
  { type: 'icon-a-Circle-fouryuanquan', label: '工具' },
];

// 能力颜色选项
const abilityColors = [
  { value: '#EF7BE3', label: '粉色' },
  { value: '#725CFA', label: '紫色' },
  { value: '#165DFF', label: '蓝色' },
  { value: '#58D764', label: '绿色' },
  { value: '#FF903E', label: '橙色' },
  { value: '#FF5A5A', label: '红色' },
];

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6);

const MyForm = (props) => {
  const {
    form,
    questionList,
    setQuestionList,
    tagsOptions,
    setTagsOptions,
    coreAbilities = [],
    setCoreAbilities,
  } = props;
  const intl = useIntl();
  const customAlphabetRef = useRef(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6));

  const compositionRef = useRef(false);

  const [inputTag, setInputTag] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [iconPopoverOpen, _setIconPopoverOpen] = useState({});
  const [boundaryModalOpen, setBoundaryModalOpen] = useState(false);
  const [editingBoundaryAbilityId, setEditingBoundaryAbilityId] = useState(null);
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [editingExampleAbilityId, setEditingExampleAbilityId] = useState(null);

  const handleTagSelect = (value) => {
    if (value && !selectedTags.includes(value)) {
      setSelectedTags([...selectedTags, value]);
    }
    setInputTag('');
  };

  const handleTagPressEnter = () => {
    if (inputTag.trim()) {
      // 检查是否已存在该选项
      const existingOption = tagsOptions.find((option) => {
        return option.value.toLowerCase() === inputTag.trim().toLowerCase();
      });
      if (!existingOption) {
        // 如果不存在，新增选项
        const newOption = {
          value: inputTag.trim(),
          label: inputTag.trim(),
        };
        // 这里可以更新tagOptions，但由于它是常量，我们直接添加到selectedTags
        setTagsOptions([...tagsOptions, newOption]);
      } else {
        // 如果存在，直接选中
        handleTagSelect(existingOption.value);
      }
    }
  };

  const handleTagDeselect = (value) => {
    setSelectedTags(
      selectedTags.filter((tag) => {
        return tag !== value;
      })
    );
  };
  const handleCompositionEnd = () => {
    compositionRef.current = false;
  };

  return (
    <Form form={form} layout="vertical" className={styles.formSection}>
      <Form.Item
        label={intl.formatMessage({ id: 'form.name' })}
        name="resourceName"
        rules={[
          {
            required: true,
            message: intl.formatMessage({
              id: 'refineModal.namePlaceholder',
            }),
          },
        ]}
      >
        <Input
          disabled
          placeholder={intl.formatMessage({
            id: 'refineModal.namePlaceholder',
          })}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={(e) => handleCompositionEnd(e, 'name')}
        />
      </Form.Item>

      <Form.Item
        label={intl.formatMessage({ id: 'employeeDetail.digitalEmployeeDescription' })}
        name="resourceDesc"
        rules={[
          {
            required: true,
            message: intl.formatMessage({
              id: 'employeeDetail.characterPlaceholder',
            }),
          },
        ]}
      >
        <TextArea
          rows={4}
          placeholder={intl.formatMessage({
            id: 'employeeDetail.digitalEmployeeDescriptionPlaceholder',
          })}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={(e) => handleCompositionEnd(e, 'intro')}
        />
      </Form.Item>

      {/* 核心能力 */}
      <div className={styles.coreAbilitySection}>
        <div className={styles.sectionLabel}>
          <div className="ub ub-ac">
            <div
              style={{
                margin: '5px 4px 0 0',
                fontSize: '16px',
                color: '#ff4d4f',
              }}
            >
              *
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#14161a' }}>
              {intl.formatMessage({ id: 'refineModal.coreAbility' })}
            </div>
          </div>
          <div className={styles.labelActions}>
            <Button
              type="link"
              size="small"
              onClick={() => {
                setCoreAbilities([
                  ...coreAbilities,
                  {
                    id: nanoid(),
                    name: '',
                    description: '',
                    icon: abilityIcons[coreAbilities.length % abilityIcons.length].type,
                    color: abilityColors[coreAbilities.length % abilityColors.length].value,
                    expanded: true,
                    acceptBoundary: [],
                    rejectBoundary: [],
                    example: [],
                  },
                ]);
              }}
              style={{ padding: 0, height: 'auto' }}
            >
              + {intl.formatMessage({ id: 'refineModal.add' })}
            </Button>
          </div>
        </div>
        <div className={styles.abilityHint}>{intl.formatMessage({ id: 'refineModal.coreAbilityHint' })}</div>
        <Collapse
          activeKey={coreAbilities.filter((item) => item.expanded).map((item) => item.id)}
          onChange={(keys) => {
            setCoreAbilities(
              coreAbilities.map((item) => ({
                ...item,
                expanded: keys.includes(item.id),
              }))
            );
          }}
          className={styles.abilityCollapse}
          ghost
        >
          {coreAbilities.map((ability, index) => (
            <Panel
              key={ability.id}
              header={
                <div className={styles.abilityPanelHeader}>
                  <Popover
                    trigger="click"
                    open={iconPopoverOpen[ability.id]}
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    onOpenChange={(_open) => {}}
                    placement="bottomLeft"
                  >
                    <div className={styles.abilityIcon} style={{ color: ability.color }}>
                      <AntdIcon type={ability.icon} style={{ fontSize: 16 }} />
                    </div>
                  </Popover>
                  <Form.Item style={{ marginBottom: 0, flex: 1 }}>
                    <Input
                      placeholder={intl.formatMessage(
                        { id: 'refineModal.abilityNamePlaceholder' },
                        { index: index + 1 }
                      )}
                      value={ability.name}
                      onChange={(e) => {
                        setCoreAbilities(
                          coreAbilities.map((item) =>
                            item.id === ability.id ? { ...item, name: e.target.value } : item
                          )
                        );
                      }}
                      bordered={false}
                      className={styles.abilityNameInput}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Form.Item>
                  <div className={styles.abilityPanelActions}>
                    {/* <AntdIcon
                      type="icon-a-Cross-ringjiaochahuan"
                      className={styles.actionIcon}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingBoundaryAbilityId(ability.id);
                        setBoundaryModalOpen(true);
                      }}
                    />
                    <AntdIcon
                      type="icon-a-Tips-onetishi"
                      className={styles.actionIcon}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingExampleAbilityId(ability.id);
                        setExampleModalOpen(true);
                      }}
                    /> */}
                    {coreAbilities.length > 1 && (
                      <AntdIcon
                        type="icon-a-Deleteshanchu"
                        className={styles.actionIcon}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCoreAbilities(coreAbilities.filter((item) => item.id !== ability.id));
                        }}
                      />
                    )}
                  </div>
                </div>
              }
            >
              <div className={styles.abilityPanelContent}>
                <Form.Item label="" style={{ marginBottom: 0 }}>
                  <TextArea
                    placeholder={intl.formatMessage({ id: 'refineModal.abilityDescPlaceholder' })}
                    value={ability.description}
                    onChange={(e) => {
                      setCoreAbilities(
                        coreAbilities.map((item) =>
                          item.id === ability.id ? { ...item, description: e.target.value } : item
                        )
                      );
                    }}
                    rows={3}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                  />
                </Form.Item>
              </div>
            </Panel>
          ))}
        </Collapse>
      </div>
      <AbilityBoundaryModal
        open={boundaryModalOpen}
        onCancel={() => {
          setBoundaryModalOpen(false);
          setEditingBoundaryAbilityId(null);
        }}
        ability={coreAbilities.find((item) => item.id === editingBoundaryAbilityId)}
        isReadOnly={false}
        onOk={(payload) => {
          setCoreAbilities(
            coreAbilities.map((item) =>
              item.id === editingBoundaryAbilityId
                ? {
                  ...item,
                  acceptBoundary: payload.acceptBoundary,
                  rejectBoundary: payload.rejectBoundary,
                }
                : item
            )
          );
          setBoundaryModalOpen(false);
          setEditingBoundaryAbilityId(null);
        }}
      />
      <AbilityExampleModal
        open={exampleModalOpen}
        onCancel={() => {
          setExampleModalOpen(false);
          setEditingExampleAbilityId(null);
        }}
        ability={coreAbilities.find((item) => item.id === editingExampleAbilityId)}
        isReadOnly={false}
        onOk={(list) => {
          setCoreAbilities(
            coreAbilities.map((item) =>
              item.id === editingExampleAbilityId
                ? {
                  ...item,
                  example: list,
                }
                : item
            )
          );
          setExampleModalOpen(false);
          setEditingExampleAbilityId(null);
        }}
      />

      {/* 标签管理 */}
      <Form.Item label={intl.formatMessage({ id: 'employeeDetail.tags' })} name="tags">
        <Select
          mode="multiple"
          value={selectedTags}
          onChange={(values) => {
            setSelectedTags(values);
            // 更新表单值
            form.setFieldsValue({ tags: values });
          }}
          onDeselect={handleTagDeselect}
          placeholder={intl.formatMessage({ id: 'employeeDetail.tagSearchPlaceholder' })}
          options={tagsOptions}
          filterOption={(inputValue, option) => {
            return option?.value?.toLowerCase().includes(inputValue.toLowerCase());
          }}
          onSearch={(value) => {
            setInputTag(value);
          }}
          onInputKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleTagPressEnter();
            }
          }}
          style={{ marginBottom: 8 }}
          showSearch
          allowClear
        />
      </Form.Item>
      <Form.Item
        label={intl.formatMessage({ id: 'employeeDetail.personalityDefinition' })}
        name="corePersonaDefinition"
      >
        <TextArea
          rows={4}
          placeholder={intl.formatMessage({
            id: 'employeeDetail.personalityDefinitionRequired',
          })}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
        />
      </Form.Item>
      <Form.Item label={intl.formatMessage({ id: 'refineModal.opening' })} name="descText">
        <TextArea
          rows={3}
          placeholder={intl.formatMessage({
            id: 'refineModal.openingPlaceholder',
          })}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
        />
      </Form.Item>
      <div className={styles.commonQuestion}>
        <div className={styles.questionLabel}>
          <span>{intl.formatMessage({ id: 'refineModal.questions' })}</span>
          <AntdIcon
            type="icon-a-Plusjia"
            onClick={() => {
              if (last(questionList)?.infoTitle === '') return;
              setQuestionList((pre) =>
                pre.concat([
                  {
                    infoTitle: '',
                    infoContent: '',
                    instructCode: '',
                    slotSettings: {},
                    infoType: 5,
                    datasetIdList: [],
                    uuid: customAlphabetRef.current(),
                  },
                ])
              );
            }}
          />
        </div>
        <div className={styles.questionContent}>
          {questionList.map((item, index) => (
            <Card key={index} className={styles.card}>
              <div className={styles.content}>
                <Input
                  value={item.infoTitle}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQuestionList((pre) =>
                      pre.map((it, i) => {
                        if (index === i) {
                          set(it, 'infoTitle', v);
                          set(it, 'infoContent', v);
                          set(it, 'instructCode', v);
                          return it;
                        }
                        return it;
                      })
                    );
                  }}
                  placeholder={intl.formatMessage({
                    id: 'refineModal.questionPlaceholder',
                  })}
                />
                <AntdIcon
                  style={{ marginLeft: '16px' }}
                  type="icon-a-Deleteshanchu"
                  onClick={() => {
                    setQuestionList((pre) =>
                      compact(
                        pre.map((it, i) => {
                          if (index === i) {
                            return null;
                          }
                          return it;
                        })
                      )
                    );
                  }}
                />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Form>
  );
};

export default MyForm;
