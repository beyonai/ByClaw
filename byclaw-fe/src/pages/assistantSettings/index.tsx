import React, { useState, useEffect, useCallback, useMemo } from 'react';
import classnames from 'classnames';
import { getAvatarUrl } from '@/utils/agent';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';
import { Tag, Card, Collapse, Select, Spin, Divider, Form, Input, Button, message } from 'antd';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { isEmpty, trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import type { CollapseProps } from 'antd';
import { Image } from '@/components/Image';
import {
  getUserSuas,
  updateBySuperassistId,
  getUserResourcePrivileges,
  saveResourcePrivilege,
  getUserAllAvailableResources,
} from '@/service/assistantSetting';
import SuperAssistantMemory from './components/SuperAssistantMemory';
import DigitalEmployeeMemory from './components/DigitalEmployeeMemory';
import styles from './index.module.less';

interface CustomTagProps {
  label: React.ReactNode;
  value: any;
  closable: boolean;
  onClose: (e: React.MouseEvent<HTMLElement>) => void;
}

interface KnowledgeBaseItem {
  resourceId: string;
  resourceName: string;
  resourceDesc: string;
}

const { TextArea } = Input;
const abilitiesIconMap = {
  chat: <AntdIcon type="icon-huihua" />,
  company: <AntdIcon type="icon-a-Book-oneshuji11" />,
  network: <AntdIcon type="icon-a-Sphereyuanqiu" />,
  employee: <AntdIcon type="icon-cebianlan-shuziyuangong" />,
  task: <AntdIcon type="icon-baiyingzhiban" />,
} as const;

const AssistantSettings: React.FC = () => {
  // 获取用户信息
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const intl = useIntl();
  const [form] = Form.useForm();
  const [assistantForm] = Form.useForm();
  const [employeeForm] = Form.useForm();
  const [loading, setLoading] = useState(false); // 加载loading
  const [userBasicInfo, setUserBasicInfo] = useState<any>({});
  const [saveLoading, setSaveLoading] = useState(false); // 保存loading
  const [assistantSaveLoading, setAssistantSaveLoading] = useState(false); // 保存loading
  const [employeeSaveLoading, setEmployeeSaveLoading] = useState(false); // 保存loading
  const [activeTitle, setActiveTitle] = useState('assistant'); // 默认展示超级助手记忆
  const [showEditEmployeeName, setShowEditEmployeeName] = useState(false); // 数字分身修改
  const [editEmployeeName, setEditEmployeeName] = useState(userInfo?.userName); // 数字分身修改name
  const [showEditAssistantName, setShowEditAssistantName] = useState(false); // 超级助手修改
  const [editAssistantName, setEditAssistantName] = useState(userInfo?.userName); // 超级助手修改name
  const [avatar, setAvatar] = useState('');
  const [kbSearch, setKbSearch] = useState('');
  const [empKbSearch, setEmpKbSearch] = useState('');
  const [dbSearch, setDbSearch] = useState('');
  const [emDbSearch, setEmDbSearch] = useState('');
  const [assistantKnowledgeBases, setAssistantKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [employeeKnowledgeBases, setEmployeeKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [assistantDataBases, setAssistantDBases] = useState<KnowledgeBaseItem[]>([]);
  const [employeeDataBases, setEmployeeDBases] = useState<KnowledgeBaseItem[]>([]);

  const abilities = [
    { id: 'chat', name: intl.formatMessage({ id: 'assistantSetting.dailyChat' }) },
    { id: 'company', name: intl.formatMessage({ id: 'assistantSetting.corporateSearch' }) },
    { id: 'network', name: intl.formatMessage({ id: 'assistantSetting.onlineSearch' }) },
    { id: 'employee', name: intl.formatMessage({ id: 'assistantSetting.employeeCall' }) },
    { id: 'task', name: intl.formatMessage({ id: 'assistantSetting.taskPlanning' }) },
  ];

  const filteredKBs = useMemo(() => {
    const kw = kbSearch.trim().toLowerCase();
    if (!kw) return assistantKnowledgeBases;
    return assistantKnowledgeBases.filter((k) => `${k.resourceName}`.toLowerCase().includes(kw));
  }, [kbSearch, assistantKnowledgeBases]);

  const filteredEmpKBs = useMemo(() => {
    const kw = empKbSearch.trim().toLowerCase();
    if (!kw) return employeeKnowledgeBases;
    return employeeKnowledgeBases.filter((k) => `${k.resourceName}`.toLowerCase().includes(kw));
  }, [empKbSearch, employeeKnowledgeBases]);

  const filteredDBs = useMemo(() => {
    const kw = dbSearch.trim().toLowerCase();
    if (!kw) return assistantDataBases;
    return assistantDataBases.filter((k) => `${k.resourceName}`.toLowerCase().includes(kw));
  }, [dbSearch, assistantDataBases]);

  const filteredEmpDBs = useMemo(() => {
    const kw = emDbSearch.trim().toLowerCase();
    if (!kw) return employeeDataBases;
    return employeeDataBases.filter((k) => `${k.resourceName}`.toLowerCase().includes(kw));
  }, [emDbSearch, employeeDataBases]);

  // 查询助手信息
  const queryUserSuas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUserSuas({
        userId: userInfo.userId,
      });
      setUserBasicInfo(res);
      const { memoryMessage, nickName, extName, extAvatar } = JSON.parse(res.prologue);
      form.setFieldsValue({
        assistantName: nickName,
        rememberInfo: memoryMessage,
      });
      setAvatar(`${extAvatar}`);
      setEditEmployeeName(extName);
      setEditAssistantName(res?.suasName || '');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [userInfo.userId]);

  const queryUserResourcePrivileges = async () => {
    setLoading(true);
    try {
      const res = await getUserResourcePrivileges({
        privilegeType: ['INNER', 'OUTER'],
        resourceType: ['KNOWLEDGE_BASE', 'DATA_BASE'],
      });
      const innerKbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'INNER' && i.resourceType === 'KNOWLEDGE_BASE'
        )?.resourceList || {};
      const innerDbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'INNER' && i.resourceType === 'DATA_BASE'
        )?.resourceList || {};

      assistantForm.setFieldsValue({
        knowledgeBases: innerKbList?.map((i: { resourceId: string }) => i.resourceId) || [],
        databases: innerDbList?.map((i: { resourceId: string }) => i.resourceId) || [],
      });

      const outerKbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'OUTER' && i.resourceType === 'KNOWLEDGE_BASE'
        )?.resourceList || {};

      const outerDbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'OUTER' && i.resourceType === 'DATA_BASE'
        )?.resourceList || {};

      employeeForm.setFieldsValue({
        employeeKnowledgeBases: outerKbList?.map((i: { resourceId: string }) => i.resourceId) || [],
        employeeDatabases: outerDbList?.map((i: { resourceId: string }) => i.resourceId) || [],
      });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const queryUserAllAvailableResources = async () => {
    setLoading(true);
    try {
      const res = await getUserAllAvailableResources({
        privilegeType: ['INNER', 'OUTER'],
        resourceType: ['KNOWLEDGE_BASE', 'DATA_BASE'],
      });
      const innerKbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'INNER' && i.resourceType === 'KNOWLEDGE_BASE'
        )?.resourceList || [];
      setAssistantKnowledgeBases(innerKbList || []);

      const innerDbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'INNER' && i.resourceType === 'DATA_BASE'
        )?.resourceList || [];
      setAssistantDBases(innerDbList || []);

      const outerKbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'OUTER' && i.resourceType === 'KNOWLEDGE_BASE'
        )?.resourceList || [];
      setEmployeeKnowledgeBases(outerKbList || []);

      const outerDbList =
        res?.find(
          (i: { privilegeType: string; resourceType: string }) =>
            i.privilegeType === 'OUTER' && i.resourceType === 'DATA_BASE'
        )?.resourceList || [];
      setEmployeeDBases(outerDbList || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // 首次加载
  useEffect(() => {
    queryUserSuas();
    queryUserAllAvailableResources();
    queryUserResourcePrivileges();
  }, []);

  // 自定义标签渲染
  const tagRender = (props: CustomTagProps) => {
    const { label } = props; // closable, onClose
    const onPreventMouseDown = (event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
    };

    return (
      <Tag
        style={{
          backgroundColor: '#E8F3FF',
          color: '#165DFF',
        }}
        color="#E8F3FF"
        onMouseDown={onPreventMouseDown}
        bordered={false}
      >
        {label}
      </Tag>
    );
  };

  const onFinish = async () => {
    setSaveLoading(true);
    try {
      const values = form.getFieldsValue();
      const res = await updateBySuperassistId({
        assistPrologue: { nickName: values?.assistantName, memoryMessage: values?.rememberInfo },
      });
      if (res) {
        message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
      }
    } catch (error) {
      message.error(intl.formatMessage({ id: 'common.requestFailed' }));
    } finally {
      setSaveLoading(false);
    }
  };

  const onAssistantFinish = async () => {
    setAssistantSaveLoading(true);
    try {
      const values = assistantForm.getFieldsValue();
      const res = await saveResourcePrivilege({
        privilegeType: 'INNER',
        knowledgeList: values.knowledgeBases,
        dataList: values.databases,
      });
      if (res) {
        message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
      }
    } catch (error) {
      message.error(intl.formatMessage({ id: 'common.requestFailed' }));
    } finally {
      setAssistantSaveLoading(false);
    }
  };

  const onEmployeeFinish = async () => {
    setEmployeeSaveLoading(true);
    try {
      const values = employeeForm.getFieldsValue();
      const res = await saveResourcePrivilege({
        privilegeType: 'OUTER',
        knowledgeList: values.employeeKnowledgeBases,
        dataList: values.employeeDatabases,
      });
      if (res) {
        message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
      }
    } catch (error) {
      message.error(intl.formatMessage({ id: 'common.requestFailed' }));
    } finally {
      setEmployeeSaveLoading(false);
    }
  };

  const items = (type: 'all' | 'two'): CollapseProps['items'] => {
    const displayAbilities = type === 'all' ? abilities : abilities.slice(0, 2);
    const count = displayAbilities.length;

    return [
      {
        key: '1',
        label: (
          <span>
            {intl.formatMessage({ id: 'employees.abilityMap' })}
            <span className={styles.labelExtra}>
              {intl.formatMessage({ id: 'assistantSetting.abilityCount' }, { count })}
            </span>
          </span>
        ),
        children: (
          <div className={styles.abilitiesList}>
            {displayAbilities.map((ability) => (
              <div key={ability.id} className={classnames(styles.abilityItem, 'gap4')}>
                <div className={styles.abilityIcon}>
                  {abilitiesIconMap[ability.id as keyof typeof abilitiesIconMap]}
                </div>
                <div>{ability.name}</div>
              </div>
            ))}
          </div>
        ),
      },
    ];
  };

  return (
    <Spin spinning={loading}>
      <div className={styles.settingsRoot} style={{ overflowY: activeTitle === 'assistant' ? 'scroll' : 'initial' }}>
        <div
          className={styles.settingsContainer}
          style={{
            overflow: activeTitle === 'assistant' ? 'initial' : 'hidden',
            display: activeTitle === 'assistant' ? 'initial' : 'flex',
          }}
        >
          <div className={styles.settingsTitle}>
            <h1
              onClick={() => setActiveTitle('assistant')}
              className={activeTitle === 'assistant' ? styles.activeTitle : ''}
            >
              {intl.formatMessage({ id: 'assistantSetting.memory.superAssistantMemory' })}
            </h1>
            <h1
              onClick={() => setActiveTitle('employee')}
              className={activeTitle === 'employee' ? styles.activeTitle : ''}
            >
              {intl.formatMessage({ id: 'assistantSetting.memory.digitalEmployeeMemory' })}
            </h1>
          </div>
          {/* 个人信息设置 - 暂时隐藏 */}
          {false && activeTitle === 'info' && (
            <div className={styles.settingsContent}>
              {/* 默认设置 */}
              <Card className={styles.infoCard}>
                <div className={styles.infoGrid}>
                  <div className={styles.infoTag}>{intl.formatMessage({ id: 'assistantSetting.DefaultSetting' })}</div>
                  <div className={styles.infoHeader}>
                    <div className={styles.avatarStyle}>{getDisplayUserNameInChat(userBasicInfo?.userName)}</div>
                    <div className={styles.infoValue}>
                      <div className={styles.infoHeaderName}>
                        <span className={styles.nameText}>{userBasicInfo?.userName || ''}</span>
                      </div>
                      <div className={styles.subtext}>{userBasicInfo?.positionName || ''}</div>
                    </div>
                  </div>
                  <Divider style={{ margin: '10px 0' }} />
                  <div className={styles.infoRow}>
                    <div className={styles.infoLabel}>{intl.formatMessage({ id: 'login.department' })}</div>
                    <div className={styles.infoValue}>{userBasicInfo?.pathName || ''}</div>
                  </div>
                  <div className={styles.infoRow}>
                    <div className={styles.infoLabel}>{intl.formatMessage({ id: 'login.employeeId' })}</div>
                    <div className={styles.infoValue}>{userBasicInfo?.userCode || ''}</div>
                  </div>
                  <div className={styles.infoRow}>
                    <div className={styles.infoLabel}>
                      {intl.formatMessage({ id: 'orgMgr.personalSelect.station' })}
                    </div>
                    <div className={styles.infoValue}>{userBasicInfo?.stationName || ''}</div>
                  </div>
                  <div className={styles.infoRow}>
                    <div className={styles.infoLabel}>
                      {intl.formatMessage({ id: 'assistantSetting.BusinessSupervisor' })}
                    </div>
                    <div className={styles.infoValue}>{userBasicInfo?.headerName || ''}</div>
                  </div>
                  <div className={styles.infoRow}>
                    <div className={styles.infoLabel}>{intl.formatMessage({ id: 'assistantSetting.Email' })}</div>
                    <div className={styles.infoValue}>{userBasicInfo?.email || ''}</div>
                  </div>
                </div>
              </Card>
              {/* 偏好设置 */}
              <Card className={styles.infoCard}>
                <div className={styles.infoGrid}>
                  <div className={styles.infoTag}>
                    {intl.formatMessage({ id: 'assistantSetting.PreferencesSetting' })}
                  </div>
                  <Form form={form} layout="vertical" className={styles.preferencesForm}>
                    <Form.Item
                      label={intl.formatMessage({ id: 'assistantSetting.AssistantCallName' })}
                      name="assistantName"
                      rules={[
                        {
                          max: 20,
                          message: intl.formatMessage({ id: 'assistantSetting.assistantNameMax' }),
                        },
                      ]}
                    >
                      <Input placeholder={intl.formatMessage({ id: 'form.input' })} allowClear />
                    </Form.Item>

                    <Form.Item
                      label={intl.formatMessage({ id: 'assistantSetting.AssistantRemembers' })}
                      name="rememberInfo"
                      rules={[
                        {
                          max: 200,
                          message: intl.formatMessage({ id: 'assistantSetting.rememberInfoMax' }),
                        },
                      ]}
                    >
                      <TextArea
                        placeholder={intl.formatMessage({ id: 'form.input' })}
                        rows={3}
                        showCount
                        maxLength={200}
                      />
                    </Form.Item>
                  </Form>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={saveLoading}
                    className={styles.saveButton}
                    onClick={onFinish}
                  >
                    {intl.formatMessage({ id: 'common.save' })}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* 超级助手记忆 */}
          {activeTitle === 'assistant' && (
            <div className={styles.memoryContent}>
              <SuperAssistantMemory userBasicInfo={userBasicInfo} />
            </div>
          )}

          {/* 数字员工记忆 */}
          {activeTitle === 'employee' && (
            <div className={styles.memoryContent}>
              <DigitalEmployeeMemory />
            </div>
          )}

          {/* 超级助手管理 - 保留原有功能，暂时隐藏 */}
          {false && activeTitle === 'assistant-old' && (
            <div className={styles.settingsContent}>
              {/* 对内超级助手 */}
              <Card className={styles.infoCard}>
                <div className={styles.infoGrid} style={{ marginBottom: '24px' }}>
                  <div className={styles.infoTag}>
                    {intl.formatMessage({ id: 'assistantSetting.Internal' })}(
                    {intl.formatMessage({ id: 'dialogueRecord.superAssistant' })})
                  </div>
                  <div className={styles.infoHeader}>
                    <div className={styles.avatarOut}>
                      <figure className={styles.currentAvatar}>
                        <Image src={getAvatarUrl(avatar)} width="100%" />
                      </figure>
                    </div>
                    <div className={styles.infoValue}>
                      {showEditAssistantName && (
                        <>
                          <Input
                            maxLength={20}
                            onChange={(e) => {
                              setEditAssistantName(trim(e.target.value));
                            }}
                            onPressEnter={() => {
                              if (isEmpty(editAssistantName)) {
                                message.error(intl.formatMessage({ id: 'assistantSetting.inputPlaceholder' }));
                                return;
                              }
                              updateBySuperassistId({ name: editAssistantName });
                              setShowEditAssistantName(false);
                            }}
                            autoFocus
                            value={editAssistantName}
                            style={{ marginRight: '5px', color: '#000' }}
                            onBlur={() => {
                              setShowEditAssistantName(false);
                            }}
                          />
                        </>
                      )}
                      {!showEditAssistantName && (
                        <div className={styles.infoHeaderName}>
                          <span className={styles.nameText}>{editAssistantName || ''}</span>
                          <AntdIcon
                            type="icon-a-Editbianji"
                            style={{ color: '#707680', fontSize: '14px' }}
                            onClick={() => {
                              setShowEditAssistantName(true);
                              setEditAssistantName(editAssistantName);
                            }}
                          />
                          <span className={styles.official}>
                            <span>{intl.formatMessage({ id: 'dialogueRecord.superAssistant' })}</span>
                          </span>
                        </div>
                      )}
                      <div className={styles.subtext}>
                        {intl.formatMessage({ id: 'assistantSetting.AssistantDesc' })}
                      </div>
                    </div>
                  </div>
                  <Divider style={{ margin: '10px 0' }} />
                  <Collapse defaultActiveKey={['1']} ghost items={items('all')} expandIconPosition="end" />
                  <Form form={assistantForm} layout="vertical" className={styles.preferencesForm}>
                    <Form.Item
                      name="knowledgeBases"
                      label={
                        <span>
                          {intl.formatMessage({ id: 'assistantSetting.kbTitle' })}
                          <span className={styles.labelExtra}>
                            {intl.formatMessage({ id: 'assistantSetting.kbTitleDesc' })}
                          </span>
                        </span>
                      }
                    >
                      <Select
                        mode="multiple"
                        tagRender={tagRender}
                        placeholder={intl.formatMessage({ id: 'assistantSetting.kbSelectPlaceholder' })}
                        maxTagCount={2}
                        maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
                        allowClear
                        showSearch={false}
                        optionLabelProp="title"
                        dropdownRender={(menu) => (
                          <div>
                            <div className={styles.dropdownSearch}>
                              <Input
                                allowClear
                                value={kbSearch}
                                onChange={(e) => setKbSearch(e.target.value)}
                                placeholder={intl.formatMessage({ id: 'assistantSetting.kbInputPlaceholder' })}
                                autoFocus
                              />
                            </div>
                            {menu}
                          </div>
                        )}
                        options={filteredKBs.map((knowledge) => ({
                          label: (
                            <div className={styles.knowledgeOption}>
                              <AntdIcon type="icon-a-Book-oneshuji12" className={styles.knowledgeIcon} />
                              <span className={styles.knowledgeName}>{knowledge.resourceName}</span>
                              <div className={styles.knowledgeDesc}>{knowledge.resourceDesc}</div>
                            </div>
                          ),
                          value: knowledge.resourceId,
                          title: knowledge.resourceName,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name="databases"
                      label={
                        <span>
                          {intl.formatMessage({ id: 'assistantSetting.dbTitle' })}
                          <span className={styles.labelExtra}>
                            {intl.formatMessage({ id: 'assistantSetting.dbTitleDesc' })}
                          </span>
                        </span>
                      }
                    >
                      <Select
                        mode="multiple"
                        tagRender={tagRender}
                        placeholder={intl.formatMessage({ id: 'assistantSetting.dbSelectPlaceholder' })}
                        maxTagCount={2}
                        maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
                        allowClear
                        showSearch={false}
                        optionLabelProp="title"
                        dropdownRender={(menu) => (
                          <div>
                            <div className={styles.dropdownSearch}>
                              <Input
                                allowClear
                                value={dbSearch}
                                onChange={(e) => setDbSearch(e.target.value)}
                                placeholder={intl.formatMessage({ id: 'assistantSetting.dbInputPlaceholder' })}
                                autoFocus
                              />
                            </div>
                            {menu}
                          </div>
                        )}
                        options={filteredDBs.map((db) => ({
                          label: (
                            <div className={styles.knowledgeOption}>
                              <AntdIcon type="icon-shujukutubiao" className={styles.knowledgeIcon} />
                              <span className={styles.knowledgeName}>{db.resourceName}</span>
                              <div className={styles.knowledgeDesc}>{db.resourceDesc}</div>
                            </div>
                          ),
                          value: db.resourceId,
                          title: db.resourceName,
                        }))}
                      />
                    </Form.Item>
                  </Form>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={assistantSaveLoading}
                    className={styles.saveBth}
                    onClick={onAssistantFinish}
                  >
                    {intl.formatMessage({ id: 'common.save' })}
                  </Button>
                </div>
              </Card>
              {/* 对外数字分身 */}
              <Card className={styles.infoCard}>
                <div className={styles.infoGrid} style={{ marginBottom: '24px' }}>
                  <div className={styles.infoTag}>
                    {intl.formatMessage({ id: 'assistantSetting.External' })}(
                    {intl.formatMessage({ id: 'assistantSetting.DigitalClone' })})
                  </div>
                  <div className={styles.infoHeader}>
                    <div className={styles.avatarStyle}>{getDisplayUserNameInChat(userBasicInfo?.userName)}</div>
                    <div className={styles.infoValue}>
                      {showEditEmployeeName && (
                        <>
                          <Input
                            maxLength={20}
                            onChange={(e) => {
                              setEditEmployeeName(trim(e.target.value));
                            }}
                            onPressEnter={() => {
                              if (isEmpty(editEmployeeName)) {
                                message.error(intl.formatMessage({ id: 'assistantSetting.inputPlaceholder' }));
                                return;
                              }
                              updateBySuperassistId({ assistPrologue: { extName: editEmployeeName } });
                              setShowEditEmployeeName(false);
                            }}
                            autoFocus
                            value={editEmployeeName}
                            style={{ marginRight: '5px', color: '#000' }}
                            onBlur={() => {
                              setShowEditEmployeeName(false);
                            }}
                          />
                        </>
                      )}
                      {!showEditEmployeeName && (
                        <div className={styles.infoHeaderName}>
                          <span className={styles.nameText}>{editEmployeeName}</span>
                          <AntdIcon
                            type="icon-a-Editbianji"
                            style={{ color: '#707680', fontSize: '14px' }}
                            onClick={() => {
                              setShowEditEmployeeName(true);
                              setEditEmployeeName(editEmployeeName);
                            }}
                          />
                          <span className={styles.aiMark}>
                            <span> {intl.formatMessage({ id: 'assistantSetting.DigitalClone' })}</span>
                          </span>
                        </div>
                      )}
                      <div className={styles.subtext}>
                        {intl.formatMessage({ id: 'assistantSetting.EmployeeDesc' })}
                      </div>
                    </div>
                  </div>
                  <Divider style={{ margin: '10px 0' }} />
                  <Collapse defaultActiveKey={['1']} ghost items={items('two')} expandIconPosition="end" />
                  <Form form={employeeForm} layout="vertical" className={styles.preferencesForm}>
                    <Form.Item
                      name="employeeKnowledgeBases"
                      label={
                        <span>
                          {intl.formatMessage({ id: 'assistantSetting.kbTitle' })}
                          <span className={styles.labelExtra}>
                            {intl.formatMessage({ id: 'assistantSetting.kbTitleDesc' })}
                          </span>
                        </span>
                      }
                    >
                      <Select
                        mode="multiple"
                        tagRender={tagRender}
                        placeholder={intl.formatMessage({ id: 'assistantSetting.kbSelectPlaceholder' })}
                        maxTagCount={2}
                        maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
                        allowClear
                        showSearch={false}
                        optionLabelProp="title"
                        dropdownRender={(menu) => (
                          <div>
                            <div className={styles.dropdownSearch}>
                              <Input
                                allowClear
                                value={empKbSearch}
                                onChange={(e) => setEmpKbSearch(e.target.value)}
                                placeholder={intl.formatMessage({ id: 'assistantSetting.kbInputPlaceholder' })}
                                autoFocus
                              />
                            </div>
                            {menu}
                          </div>
                        )}
                        options={filteredEmpKBs.map((knowledge) => ({
                          label: (
                            <div className={styles.knowledgeOption}>
                              <AntdIcon type="icon-a-Book-oneshuji12" className={styles.knowledgeIcon} />
                              <span className={styles.knowledgeName}>{knowledge.resourceName}</span>
                              <div className={styles.knowledgeDesc}>{knowledge.resourceDesc}</div>
                            </div>
                          ),
                          value: knowledge.resourceId,
                          title: knowledge.resourceName,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name="employeeDatabases"
                      label={
                        <span>
                          {intl.formatMessage({ id: 'assistantSetting.dbTitle' })}
                          <span className={styles.labelExtra}>
                            {intl.formatMessage({ id: 'assistantSetting.dbTitleDesc' })}
                          </span>
                        </span>
                      }
                    >
                      <Select
                        mode="multiple"
                        tagRender={tagRender}
                        placeholder={intl.formatMessage({ id: 'assistantSetting.dbSelectPlaceholder' })}
                        maxTagCount={2}
                        maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
                        allowClear
                        showSearch={false}
                        optionLabelProp="title"
                        dropdownRender={(menu) => (
                          <div>
                            <div className={styles.dropdownSearch}>
                              <Input
                                allowClear
                                value={emDbSearch}
                                onChange={(e) => setEmDbSearch(e.target.value)}
                                placeholder={intl.formatMessage({ id: 'assistantSetting.dbInputPlaceholder' })}
                                autoFocus
                              />
                            </div>
                            {menu}
                          </div>
                        )}
                        options={filteredEmpDBs.map((db) => ({
                          label: (
                            <div className={styles.knowledgeOption}>
                              <AntdIcon type="icon-shujukutubiao" className={styles.knowledgeIcon} />
                              <span className={styles.knowledgeName}>{db.resourceName}</span>
                              <div className={styles.knowledgeDesc}>{db.resourceDesc}</div>
                            </div>
                          ),
                          value: db.resourceId,
                          title: db.resourceName,
                        }))}
                      />
                    </Form.Item>
                  </Form>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={employeeSaveLoading}
                    className={styles.saveBth}
                    onClick={onEmployeeFinish}
                  >
                    {intl.formatMessage({ id: 'common.save' })}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Spin>
  );
};

export default AssistantSettings;
