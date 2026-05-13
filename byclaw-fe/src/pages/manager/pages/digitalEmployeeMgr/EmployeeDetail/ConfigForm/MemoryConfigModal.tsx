// @ts-nocheck
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Modal, Button, Tabs, Input, Card, Tag, Form, message, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useHover } from 'ahooks';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import commonStyles from '@/pages/manager/styles/commonTabList.less';
import styles from './MemoryConfigModal.module.less';
import {
  queryTemplateRuleInfo,
  createTemplateRuleInfo,
  deleteTemplateRuleInfo,
  updateTemplateRuleInfo,
} from '@/pages/manager/service/DigitalEmployeeMgr';

const { TabPane } = Tabs;
const { TextArea } = Input;

// 添加/移除按钮组件
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AddRemoveButton = ({ _rule, isAdded, onAdd, onRemove }) => {
  const intl = useIntl();
  const ref = useRef(null);
  const isHovering = useHover(ref);

  if (isAdded) {
    return (
      <Button
        ref={ref}
        type={isHovering ? 'primary' : 'default'}
        danger={isHovering}
        className={styles.addRuleButton}
        onClick={onRemove}
        size="small"
      >
        {isHovering
          ? intl.formatMessage({ id: 'employeeDetail.memoryConfig.remove' })
          : intl.formatMessage({ id: 'employeeDetail.memoryConfig.added' })}
      </Button>
    );
  }

  return (
    <Button type="primary" icon={<PlusOutlined />} className={styles.addRuleButton} onClick={onAdd} size="small">
      {intl.formatMessage({ id: 'employeeDetail.memoryConfig.add' })}
    </Button>
  );
};

// 新增/编辑记忆规则弹窗组件
const AddMemoryRuleModal = ({ open, onClose, onSave, editingRule }) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingRule) {
        // 编辑模式：填充表单数据
        form.setFieldsValue({
          ruleName: editingRule.ruleName,
          extractionRules: editingRule.ruleContent,
        });
      } else {
        // 新增模式：重置表单
        form.resetFields();
        form.setFieldsValue({
          ruleName: '',
          extractionRules: '',
        });
      }
    }
  }, [open, form, editingRule]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      // 等待保存完成
      await onSave?.(values);
      form.resetFields();
      onClose();
    } catch (error) {
      console.error('表单验证失败:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={
        <span className={styles.addModalTitle}>
          {editingRule
            ? intl.formatMessage({ id: 'employeeDetail.memoryConfig.editRule' })
            : intl.formatMessage({ id: 'employeeDetail.memoryConfig.newRule' })}
        </span>
      }
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={600}
      centered
      destroyOnHidden
      maskClosable
      className={styles.addRuleModal}
    >
      <Form form={form} layout="vertical" className={styles.addRuleForm}>
        <Form.Item
          name="ruleName"
          label={
            <span className={styles.requiredLabel}>
              {intl.formatMessage({ id: 'employeeDetail.memoryConfig.ruleName' })}
            </span>
          }
          rules={[
            { required: true, message: intl.formatMessage({ id: 'employeeDetail.memoryConfig.ruleNameRequired' }) },
          ]}
        >
          <Input placeholder={intl.formatMessage({ id: 'employeeDetail.memoryConfig.ruleNamePlaceholder' })} />
        </Form.Item>

        <Form.Item
          name="extractionRules"
          label={
            <span className={styles.requiredLabel}>
              {intl.formatMessage({ id: 'employeeDetail.memoryConfig.extractionRule' })}
            </span>
          }
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'employeeDetail.memoryConfig.extractionRuleRequired' }),
            },
          ]}
        >
          <TextArea
            placeholder={intl.formatMessage({ id: 'employeeDetail.memoryConfig.extractionRulePlaceholder' })}
            rows={8}
            className={styles.extractionRulesTextArea}
          />
        </Form.Item>

        <div className={styles.addRuleFooter}>
          <Button onClick={handleCancel} disabled={saving}>
            {intl.formatMessage({ id: 'employeeDetail.memoryConfig.cancel' })}
          </Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            {editingRule
              ? intl.formatMessage({ id: 'employeeDetail.memoryConfig.updateTemplate' })
              : intl.formatMessage({ id: 'employeeDetail.memoryConfig.saveTemplate' })}
          </Button>
        </div>
      </Form>
    </Modal>
  );
};

const MemoryConfigModal = ({ open, onClose, onAdd, addedRules = [], onRemove, resourceId }) => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState('template');
  const [searchValue, setSearchValue] = useState('');
  const [addRuleModalOpen, setAddRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [loading, setLoading] = useState(false);
  const [memoryRules, setMemoryRules] = useState([]);
  const [myTemplateRules, setMyTemplateRules] = useState([]);

  // 获取模板规则列表
  const fetchTemplateRules = async (isMemoryTemplate, ruleName = '') => {
    setLoading(true);
    try {
      const params = {
        isMemoryTemplate,
        templateType: isMemoryTemplate ? 'SUPER_ASSISTANT' : 'DIGITAL_EMPLOYEE',
      };
      if (ruleName) {
        params.ruleName = ruleName;
      }
      const response = await queryTemplateRuleInfo(params);
      if (response?.code === 0 && response?.data) {
        // 将接口返回的数据映射为组件需要的数据结构
        const rules = (response.data.rows || []).map((item) => ({
          id: item.templateId,
          ruleName: item.ruleName,
          fields: [], // 接口未返回字段信息，暂时为空数组
          icon: 'icon-zhishiku2', // 使用知识库图标作为占位
          templateId: item.templateId,
          templateType: item.templateType,
          ruleContent: item.ruleContent,
          memoryRuleId: item.memoryRuleId,
        }));
        return rules;
      } else {
        message.error(response?.msg || intl.formatMessage({ id: 'employeeDetail.memoryConfig.getRulesFail' }));
        return [];
      }
    } catch (error) {
      console.error('获取模板规则失败:', error);
      message.error(intl.formatMessage({ id: 'employeeDetail.memoryConfig.getRulesFail' }));
      return [];
    } finally {
      setLoading(false);
    }
  };

  // 加载记忆模板数据
  const loadMemoryTemplate = async (ruleName = '') => {
    const rules = await fetchTemplateRules(true, ruleName);
    setMemoryRules(rules);
  };

  // 加载我的模板数据
  const loadMyTemplate = async (ruleName = '') => {
    const rules = await fetchTemplateRules(false, ruleName);
    setMyTemplateRules(rules);
  };

  // 弹窗打开时重置搜索值
  useEffect(() => {
    if (open) {
      // 弹窗打开时，重置搜索值
      setSearchValue('');
    }
  }, [open]);

  // 搜索功能 - 防抖处理
  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      if (activeTab === 'template') {
        loadMemoryTemplate(searchValue);
      } else if (activeTab === 'myTemplate') {
        loadMyTemplate(searchValue);
      }
    }, 300); // 300ms 防抖

    return () => clearTimeout(timer);
  }, [searchValue, activeTab, open]);

  // 获取当前标签页的规则列表
  const currentRules = useMemo(() => {
    return activeTab === 'template' ? memoryRules : myTemplateRules;
  }, [activeTab, memoryRules, myTemplateRules]);

  // 判断规则是否已添加
  const isRuleAdded = (ruleId) => {
    if (!ruleId) return false;
    // 同时比较 id 和 templateId，确保类型一致性
    return addedRules.some((it) => {
      const addedId = String(it.id || it.templateId || '');
      const ruleIdStr = String(ruleId || '');
      return addedId === ruleIdStr && addedId !== '';
    });
  };

  const handleAddRule = (rule) => {
    // 检查是否已添加
    if (!isRuleAdded(rule.id)) {
      onAdd?.(rule);
    }
  };

  const handleRemoveRule = (rule) => {
    onRemove?.(rule);
  };

  const handleAddRuleClick = () => {
    setEditingRule(null);
    setAddRuleModalOpen(true);
  };

  const handleEditRule = (rule) => {
    setEditingRule(rule);
    setAddRuleModalOpen(true);
  };

  const handleDeleteRule = async (rule) => {
    try {
      if (!resourceId) {
        message.error(intl.formatMessage({ id: 'employeeDetail.memoryConfig.missingResourceId' }));
        return;
      }

      const params = {
        templateType: 'DIGITAL_EMPLOYEE',
        templateId: rule.templateId,
      };

      const response = await deleteTemplateRuleInfo(params);

      if (response?.code === 0) {
        message.success(intl.formatMessage({ id: 'employeeDetail.memoryConfig.deleteSuccess' }));
        // 删除成功后刷新当前标签页的数据
        if (activeTab === 'template') {
          await loadMemoryTemplate(searchValue);
        } else {
          await loadMyTemplate(searchValue);
        }
      } else {
        message.error(response?.msg || intl.formatMessage({ id: 'employeeDetail.memoryConfig.deleteFail' }));
      }
    } catch (error) {
      console.error('删除记忆规则失败:', error);
      message.error(intl.formatMessage({ id: 'employeeDetail.memoryConfig.deleteFail' }));
    }
  };

  const handleSaveRule = async (values) => {
    try {
      if (editingRule) {
        // 编辑模式：调用更新接口
        const params = {
          templateType: 'DIGITAL_EMPLOYEE',
          templateId: editingRule.templateId,
          ruleName: values.ruleName,
          ruleContent: values.extractionRules,
        };

        const response = await updateTemplateRuleInfo(params);

        if (response?.code === 0) {
          message.success(intl.formatMessage({ id: 'employeeDetail.memoryConfig.updateSuccess' }));
          setEditingRule(null);
          // 保存成功后刷新当前标签页的数据
          if (activeTab === 'template') {
            await loadMemoryTemplate(searchValue);
          } else {
            await loadMyTemplate(searchValue);
          }
        } else {
          message.error(response?.msg || intl.formatMessage({ id: 'employeeDetail.memoryConfig.updateFail' }));
        }
      } else {
        // 新增模式：调用创建接口
        const params = {
          ruleName: values.ruleName,
          ruleContent: values.extractionRules, // 表单字段 extractionRules 对应接口的 ruleContent
          templateType: 'DIGITAL_EMPLOYEE',
        };

        const response = await createTemplateRuleInfo(params);

        if (response?.code === 0) {
          message.success(intl.formatMessage({ id: 'employeeDetail.memoryConfig.saveSuccess' }));
          // 保存成功后刷新当前标签页的数据
          if (activeTab === 'template') {
            await loadMemoryTemplate(searchValue);
          } else {
            await loadMyTemplate(searchValue);
          }
        } else {
          message.error(response?.msg || intl.formatMessage({ id: 'employeeDetail.memoryConfig.saveFail' }));
        }
      }
    } catch (error) {
      console.error('保存记忆规则失败:', error);
      message.error(intl.formatMessage({ id: 'employeeDetail.memoryConfig.saveFail' }));
    }
  };

  const handleTabChange = (key) => {
    setActiveTab(key);
    setSearchValue(''); // 切换标签页时清空搜索
  };

  return (
    <>
      <Modal
        title={
          <span className={styles.modalTitle}>{intl.formatMessage({ id: 'employeeDetail.memoryConfig.title' })}</span>
        }
        open={open}
        onCancel={onClose}
        footer={null}
        width={880}
        centered
        bodyStyle={{ padding: '24px', overflow: 'auto' }}
        className={styles.memoryModal}
        destroyOnHidden
        maskClosable
      >
        <div className={styles.container}>
          {/* 添加记忆规则按钮 */}
          <Button type="default" icon={<PlusOutlined />} className={styles.addButton} onClick={handleAddRuleClick}>
            {intl.formatMessage({ id: 'employeeDetail.memoryConfig.addRule' })}
          </Button>

          {/* 标签页和搜索框容器 */}
          <div className={styles.tabsContainer}>
            <Tabs activeKey={activeTab} onChange={handleTabChange} className={styles.tabs}>
              <TabPane tab={intl.formatMessage({ id: 'employeeDetail.memoryConfig.memoryTemplate' })} key="template">
                <div className={styles.tabContent}>
                  {/* 规则列表 */}
                  <div className={styles.ruleList}>
                    {loading ? (
                      <div className={styles.emptyState}>
                        {intl.formatMessage({ id: 'employeeDetail.memoryConfig.loading' })}
                      </div>
                    ) : currentRules.length > 0 ? (
                      currentRules.map((rule) => (
                        <Card key={rule.id} className={styles.ruleCard}>
                          <div className={styles.ruleContent}>
                            {/* 左侧图标和内容 */}
                            <div className={styles.ruleLeft}>
                              <div className={styles.ruleIcon}>
                                <AntdIcon type={rule.icon} />
                              </div>
                              <div className={styles.ruleInfo}>
                                <div className={styles.ruleName}>{rule.ruleName}</div>
                                <div className={styles.ruleDescription}>{rule.ruleContent}</div>
                                {rule.fields && rule.fields.length > 0 && (
                                  <div className={styles.ruleFields}>
                                    <span className={styles.fieldsLabel}>
                                      {intl.formatMessage({ id: 'employeeDetail.memoryConfig.structuredFields' })}
                                    </span>
                                    <div className={styles.fieldsTags}>
                                      {rule.fields.map((field, index) => (
                                        <Tag key={index} className={styles.fieldTag}>
                                          {field}
                                        </Tag>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 右侧添加/移除按钮 */}
                            <AddRemoveButton
                              rule={rule}
                              isAdded={isRuleAdded(rule.id)}
                              onAdd={() => handleAddRule(rule)}
                              onRemove={() => handleRemoveRule(rule)}
                            />
                          </div>
                        </Card>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        {intl.formatMessage({ id: 'employeeDetail.memoryConfig.noRules' })}
                      </div>
                    )}
                  </div>
                </div>
              </TabPane>
              <TabPane tab={intl.formatMessage({ id: 'employeeDetail.memoryConfig.myTemplate' })} key="myTemplate">
                <div className={styles.tabContent}>
                  <div className={styles.ruleList}>
                    {loading ? (
                      <div className={styles.emptyState}>
                        {intl.formatMessage({ id: 'employeeDetail.memoryConfig.loading' })}
                      </div>
                    ) : currentRules.length > 0 ? (
                      currentRules.map((rule) => (
                        <Card key={rule.id} className={styles.ruleCard}>
                          <div className={styles.ruleContent}>
                            {/* 左侧图标和内容 */}
                            <div className={styles.ruleLeft}>
                              <div className={styles.ruleIcon}>
                                <AntdIcon type={rule.icon} />
                              </div>
                              <div className={styles.ruleInfo}>
                                <div className={styles.ruleName}>{rule.ruleName}</div>
                                <div className={styles.ruleDescription}>{rule.ruleContent}</div>
                                {rule.fields && rule.fields.length > 0 && (
                                  <div className={styles.ruleFields}>
                                    <span className={styles.fieldsLabel}>
                                      {intl.formatMessage({ id: 'employeeDetail.memoryConfig.structuredFields' })}
                                    </span>
                                    <div className={styles.fieldsTags}>
                                      {rule.fields.map((field, index) => (
                                        <Tag key={index} className={styles.fieldTag}>
                                          {field}
                                        </Tag>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 右侧操作按钮区域 */}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              {/* 添加/移除按钮 */}
                              <AddRemoveButton
                                rule={rule}
                                isAdded={isRuleAdded(rule.id)}
                                onAdd={() => handleAddRule(rule)}
                                onRemove={() => handleRemoveRule(rule)}
                              />
                              {/* 编辑按钮 */}
                              <Button
                                type="default"
                                icon={<EditOutlined />}
                                size="small"
                                onClick={() => handleEditRule(rule)}
                              >
                                {intl.formatMessage({ id: 'employeeDetail.memoryConfig.edit' })}
                              </Button>
                              {/* 删除按钮 */}
                              <Popconfirm
                                title={intl.formatMessage({ id: 'employeeDetail.memoryConfig.deleteConfirm' })}
                                onConfirm={() => handleDeleteRule(rule)}
                                okText={intl.formatMessage({ id: 'employeeDetail.memoryConfig.confirm' })}
                                cancelText={intl.formatMessage({ id: 'employeeDetail.memoryConfig.cancel' })}
                              >
                                <Button
                                  type="default"
                                  danger
                                  icon={<DeleteOutlined />}
                                  size="small"
                                  style={{ display: isRuleAdded(rule.id) ? 'none' : 'block' }}
                                >
                                  {intl.formatMessage({ id: 'common.delete' })}
                                </Button>
                              </Popconfirm>
                            </div>
                          </div>
                        </Card>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        {intl.formatMessage({ id: 'employeeDetail.memoryConfig.noMyTemplate' })}
                      </div>
                    )}
                  </div>
                </div>
              </TabPane>
            </Tabs>
            {/* 搜索框 */}
            <Input
              suffix={
                <AntdIcon
                  type="icon-a-Searchsousuo"
                  onClick={() => {
                    // 搜索功能已在 onChange 和 onPressEnter 中处理
                  }}
                  style={{ cursor: 'pointer' }}
                />
              }
              placeholder={intl.formatMessage({ id: 'employeeDetail.memoryConfig.searchPlaceholder' })}
              className={`${commonStyles.searchInput} ${styles.searchInput}`}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onPressEnter={() => {
                // 搜索功能通过 useEffect 自动触发
              }}
              allowClear
            />
          </div>
        </div>
      </Modal>

      {/* 新增/编辑记忆规则弹窗 */}
      <AddMemoryRuleModal
        open={addRuleModalOpen}
        onClose={() => {
          setAddRuleModalOpen(false);
          setEditingRule(null);
        }}
        onSave={handleSaveRule}
        editingRule={editingRule}
      />
    </>
  );
};

export default MemoryConfigModal;
