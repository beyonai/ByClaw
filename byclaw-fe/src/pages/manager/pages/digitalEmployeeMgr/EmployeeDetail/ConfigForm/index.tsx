// @ts-nocheck
/* eslint-disable indent */
/* eslint-disable react/jsx-indent */
/* eslint-disable react/jsx-curly-brace-presence */
/* eslint-disable function-paren-newline */
/* eslint-disable react/jsx-props-no-multi-spaces,react/no-danger,no-empty */
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';

import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  TreeSelect,
  Dropdown,
  Modal,
  Popover,
  message,
  Popconfirm,
} from 'antd';
import { FormOutlined, QuestionCircleOutlined, EyeOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { compact, set, trim } from 'lodash';
import { customAlphabet } from 'nanoid';
import { useIntl, getLocale } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import { DingtalkCircleFilled } from '@ant-design/icons';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import { getCatalogOnResource, getDcSystemConfigListByStandType } from '@/pages/manager/service/DigitalEmployeeMgr';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import ExampleModal from './ExampleModal';
import MemoryConfigModal from './MemoryConfigModal';
import AbilityBoundaryModal from './AbilityBoundaryModal';
import AbilityExampleModal from './AbilityExampleModal';
import { useFileTookit } from '@/pages/manager/hooks/useFileTookit';
import ModelPopover from '../../components/ModelPopover';
import RelResourceInfoModal from './RelResourceInfoModal';
import ToolSelectorModal from './ToolSelectorModal';
import { compressImgFileAndUpload } from '@/pages/manager/utils/file';
import { Image } from '@/pages/manager/components/Image';
import { getAvatarUrl } from '@/pages/manager/utils/agent';
import UploadFileConfig from './UploadFileConfig';
import styles from './index.module.less';
import pStyles from '../index.module.less';
import { DEFAULT_PERSONALITY_DEFINITION } from '../personalityDefinitionDefault';
import RobotModal from './RobotModal';
import { normalizeCatalogTree } from '@/utils/catalog';
import { DEFAULT_AGENT_TYPE_OPTIONS, DEFAULT_TEMPLATE_DATA } from '../../constants';

const { TextArea } = Input;

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6);

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

const promptFieldGroups = {
  assistant: ['corePersonaDefinition', 'workStandard', 'toolStandard', 'memoryStandard'],
  qa: ['questionRewrite', 'questionDecomposition', 'singleSummary', 'multipleSummary', 'comprehensiveAnswer'],
  other: ['workStandard'],
};

const promptFieldNames = Array.from(new Set(Object.values(promptFieldGroups).flat()));
const rolePromptFieldNames = [
  'roleAttributes',
  'processingFlow',
  'personalityDimensions',
  'wordPreferences',
  'sentenceAndTone',
  'bundledSkills',
  ...promptFieldNames,
  'customPromptTabs',
  'customPromptValues',
];

const parseConfigList = (value: any) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonRecursively = (str: string, maxDepth: number = 5): any => {
  if (maxDepth <= 0 || typeof str !== 'string') return str;
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'string') {
      return parseJsonRecursively(parsed, maxDepth - 1);
    }
    return parsed;
  } catch {
    return str;
  }
};

const parseCorePersonaDefinition = (value: string, isEN?: boolean) => {
  const tabs: Array<{ key: string; name: string; isSystem: boolean }> = [];
  const fieldValues: Record<string, string> = {};
  let isArray = false;

  if (!value) {
    return { tabs, fieldValues, isArray };
  }

  try {
    const parsedData = parseJsonRecursively(value);
    const corePersonaData = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;
    if (Array.isArray(corePersonaData)) {
      isArray = true;
      corePersonaData.forEach((item) => {
        if (!item?.key) return;

        let itemValue = item.value || '';
        if (typeof itemValue === 'string') {
          itemValue = parseJsonRecursively(itemValue);
          if (typeof itemValue !== 'string') {
            itemValue = JSON.stringify(itemValue);
          }
        }

        fieldValues[item.key] = itemValue;
        tabs.push({
          key: item.key,
          name: isEN ? item.nameEn || item.name || item.key : item.name || item.key,
          isSystem: false,
        });
      });
    }
  } catch (error) {
    console.error('解析 corePersonaDefinition 失败:', error);
  }

  return { tabs, fieldValues, isArray };
};

const buildTemplatePromptConfig = (templateList: any[] = [], isEN?: boolean) => {
  const corePersonaDefinition: Array<{ name: string; nameEn?: string; key: string; value: string }> = [];
  const fieldValues: Record<string, string> = {};
  const tabs: Array<{ key: string; name: string; isSystem: boolean }> = [];

  templateList.forEach((item) => {
    const key = item.paramEnName || item.paramName;
    const value = (item.paramValue || '').replace(/\\n/g, '\n');
    const displayName = isEN ? item.paramEnName || item.paramName || key : item.paramName || key;
    tabs.push({
      key,
      name: displayName,
      isSystem: true,
    });
    corePersonaDefinition.push({
      name: item.paramName || key,
      nameEn: item.paramEnName,
      key,
      value,
    });
    fieldValues[key] = value;
  });

  return {
    tabs,
    fieldValues,
    corePersonaDefinitionJson: JSON.stringify(corePersonaDefinition, null, 2),
  };
};

const ManAvatarList = Array.from({ length: 17 }).map(
  (_, i) => `beyond/avatar/man/avatar${String(i + 1).padStart(2, '0')}.jpg`
);

const WomanAvatarList = Array.from({ length: 13 }).map(
  (_, i) => `beyond/avatar/woman/avatar${String(i + 1).padStart(2, '0')}.jpg`
);

const ConfigForm = (props) => {
  const {
    agentId,
    form,
    questionList,
    setQuestionList,
    digitalType,
    showBaseList,
    updateResource,
    updateCompositeAppInfo,
    skills,
    setSkills,
    knowledgeBases,
    setKnowledgeBases,
    tagOptions,
    setTagOptions,
    managementAddresses,
    setManagementAddresses,
    memoryRules,
    setMemoryRules,
    robotConfigs = [],
    setRobotConfigs,
    isReadOnly = false,
    className,
    employeeType,
    onValuesChange,
    modelName,
    modelList,
    lastAvatar,
    avatar,
    resultDataRef,
    prologueRef,
    setModelName,
    setAvatar,
    setRefineModalOpen,
    auditErrors = {},
    terminalTypeList = [],
    initialCoreCompetencies = [],
    ownerType,
    agentType,
  } = props;

  const intl = useIntl();
  const { pick } = useFileTookit();
  const isEN = getLocale().includes('en');
  const [robotChannelOptions, setRobotChannelOptions] = useState([]);
  const [catalogList, setCatalogList] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [robotModalOpen, setRobotModalOpen] = useState(false);
  const [robotItem, setRobotItem] = useState<RobotConfig>({ channel: '' });
  const [templateData, setTemplateData] = useState([]);
  const [configurableTabs, setConfigurableTabs] = useState<Array<{ key: string; name: string; isSystem: boolean }>>([]);
  const [agentTypeOptions, setAgentTypeOptions] = useState([]);
  const [bundledSkillOptions, setBundledSkillOptions] = useState([]);
  const [bundledSkillLoading, setBundledSkillLoading] = useState(false);
  const [bundledSkillModalOpen, setBundledSkillModalOpen] = useState(false);
  const [bundledSkillSearchName, setBundledSkillSearchName] = useState('');
  const formOwnerType = Form.useWatch('ownerType', form, { form, preserve: true });
  const effectiveOwnerType = formOwnerType || ownerType;
  const selectedBundledSkills = Form.useWatch('bundledSkills', { form, preserve: true }) || [];

  useEffect(() => {
    let mounted = true;

    const fetchRobotChannels = async () => {
      try {
        const res = await getByParamGroupCode({
          paramGroupCode: 'DIG_EMPLOYEE_MACHINE_CHANNEL',
        });
        const list = res?.data?.byaiSystemConfigLists;
        if (!mounted) return;
        if (Array.isArray(list) && list.length > 0) {
          setRobotChannelOptions(
            list
              .map((item) => ({
                value: item?.paramValue,
                label: isEN ? item?.paramEnName : item?.paramName,
                seq: Number(item?.paramSeq) || 0,
              }))
              .filter((item) => item.value)
              .sort((a, b) => a.seq - b.seq)
              .map(({ value, label }) => ({ value, label }))
          );
          return;
        }
        setRobotChannelOptions([]);
      } catch {
        if (mounted) {
          setRobotChannelOptions([]);
        }
      }
    };

    const fetchAgentTypeOptions = async () => {
      try {
        const response = await getDcSystemConfigListByStandType({
          standType: 'DIG_EMPLOYEE_AGENT_TYPE',
        });

        const local = getLocale();
        const isEN = local.includes('en');

        let options = response?.data;
        if (!Array.isArray(options) || options.length === 0) {
          options = DEFAULT_AGENT_TYPE_OPTIONS.map((item) => ({
            paramValue: item.paramValue,
            paramName: item.paramName,
            paramEnName: item.paramEnName,
          }));
        }
        if (mounted) {
          setAgentTypeOptions(
            options.map((item) => ({
              value: item.paramValue,
              label: isEN ? item.paramEnName : item.paramName,
            }))
          );
        }
      } catch (error) {
        if (mounted) {
          const local = getLocale();
          const isEN = local.includes('en');
          setAgentTypeOptions(
            DEFAULT_AGENT_TYPE_OPTIONS.map((item) => ({
              value: item.paramValue,
              label: isEN ? item.paramEnName : item.paramName,
            }))
          );
        }
      }
    };

    fetchRobotChannels();
    fetchAgentTypeOptions();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchBundledSkills = async () => {
      setBundledSkillLoading(true);
      try {
        const res = await getDcSystemConfig({
          paramCode: 'OPENCLAW_BUNDLED_SKILLS',
        });
        if (!mounted) return;

        const list = parseConfigList(res?.paramValue || res?.data?.paramValue || res?.data || res);
        setBundledSkillOptions(
          list
            .map((item) => ({
              ...item,
              value: item.skillCode || item.skillName,
              label: item.skillName || item.skillCode,
              description: isEN ? item.skillDescEn || item.skillDescZh : item.skillDescZh || item.skillDescEn,
            }))
            .filter((item) => item.value)
        );
      } catch {
        if (mounted) {
          setBundledSkillOptions([]);
        }
      } finally {
        if (mounted) {
          setBundledSkillLoading(false);
        }
      }
    };

    fetchBundledSkills();
    return () => {
      mounted = false;
    };
  }, [isEN]);

  useEffect(() => {
    let mounted = true;

    const fetchCatalogList = async () => {
      setCatalogLoading(true);
      try {
        const res = await getCatalogOnResource({
          catalogType: 6,
        });
        if (!mounted) return;

        if (res?.code === 0) {
          setCatalogList(normalizeCatalogTree(res?.data || []));
          return;
        }
        setCatalogList([]);
        if (res?.msg) {
          message.error(res.msg);
        }
      } catch (e) {
        if (mounted) {
          setCatalogList([]);
        }
      } finally {
        if (mounted) {
          setCatalogLoading(false);
        }
      }
    };

    fetchCatalogList();
    return () => {
      mounted = false;
    };
  }, []);

  const robotChannelLabelMap = useMemo(
    () =>
      robotChannelOptions.reduce((map, item) => {
        // eslint-disable-next-line no-param-reassign
        map[item.value] = item.label;
        return map;
      }, {}),
    [robotChannelOptions]
  );

  const knowledgeTypeLabelMap = {
    KG_DOC: intl.formatMessage({ id: 'employeeDetail.knowledgeType.doc' }),
    KG_QA: intl.formatMessage({ id: 'employeeDetail.knowledgeType.qa' }),
    KG_DB: intl.formatMessage({ id: 'employeeDetail.knowledgeType.db' }),
    KG_TERM: intl.formatMessage({ id: 'employeeDetail.knowledgeType.term' }),
  };

  const compositionRef = useRef(false);
  const [tags, setTags] = useState([]);
  const [inputTag, setInputTag] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [uploadImgs, setUploadImgs] = useState([]);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const internalSyncRef = useRef(false);

  const [relResourceInfoModalOpen, setRelResourceInfoModalOpen] = useState(false);
  const [skillItem, setSkillItem] = useState(null);
  const [boundaryModalOpen, setBoundaryModalOpen] = useState(false);
  const [editingBoundaryAbilityId, setEditingBoundaryAbilityId] = useState(null);
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [editingExampleAbilityId, setEditingExampleAbilityId] = useState(null);
  const [toolSelectorOpen, setToolSelectorOpen] = useState(false);
  const [customPromptModalOpen, setCustomPromptModalOpen] = useState(false);
  const [customPromptName, setCustomPromptName] = useState('');
  const [activePromptTabKey, setActivePromptTabKey] = useState();
  const customPromptTabs = Form.useWatch('customPromptTabs', { form, preserve: true }) || [];

  const handleRobotModalOk = useCallback((item) => {
    setRobotModalOpen(false);
    setRobotConfigs((prev) => {
      if (item.clientId) {
        const target = prev.find((it) => it.clientId === item.clientId);
        if (target) {
          return prev.map((it) => (it.clientId === item.clientId ? item : it));
        }
        return [...prev, item];
      }

      return [...prev, item];
    });
  }, []);

  const normalizeSkillType = useCallback((type) => {
    const typeMap = {
      DIG_EMPLOYEE: 'AGENT',
      KG_DOC: 'TOOLKIT',
      KG_QA: 'TOOLKIT',
    };
    return typeMap[type] || type;
  }, []);

  const handleToolSelectorConfirm = useCallback(
    (selectedRows) => {
      setSkills((prev) => {
        const existMap = new Map(prev.map((it) => [`${it.resourceId}`, it]));
        selectedRows.forEach((item) => {
          const resourceId = `${item.resourceId || item.id}`;
          if (!existMap.has(resourceId)) {
            existMap.set(resourceId, {
              ...item,
              resourceId: item.resourceId || item.id,
              resourceName: item.resourceName || item.name,
              description: item.description || item.resourceDesc || '',
              grantResourceType: normalizeSkillType(item.grantResourceType || item.resourceBizType),
            });
          }
        });
        return Array.from(existMap.values());
      });
    },
    [setSkills, normalizeSkillType]
  );

  // 记录上一次的初始岗位职责，用于判断是否需要根据外部变更重新回显
  const prevInitialCoreCompetenciesRef = useRef([]);

  // 岗位职责列表状态
  const [coreAbilities, setCoreAbilities] = useState(() => {
    // 默认3个能力项
    return [
      {
        id: nanoid(),
        name: '',
        description: '',
        icon: abilityIcons[0].type,
        color: abilityColors[0].value,
        expanded: true,
        acceptBoundary: [],
        rejectBoundary: [],
        example: [],
      },
    ];
  });

  // 提前定义映射与工具函数，确保后续回显 useEffect 可用
  const abilityFieldMapping = {
    coreAbility: 'ability',
    abilityBoundary: 'constraints',
    exampleQuestions: 'faqs',
  };

  // 当终端类型列表加载后，如果表单字段为空，默认选中第一个
  useEffect(() => {
    if (terminalTypeList.length > 0) {
      const currentTerminal = form.getFieldValue('terminal');
      if (!currentTerminal) {
        form.setFieldsValue({ terminal: terminalTypeList[0].value });
      }
    }
  }, [terminalTypeList, form]);

  // 根据 agentType 动态请求接口初始化自定义配置模板
  useEffect(() => {
    if (!agentType) return;
    let cancelled = false;

    const getStandType = () => {
      switch (agentType) {
        case '001':
          return 'TEMPLATE_PERSONAL_ASSISTANT';
        case '006':
          return 'TEMPLATE_GENERAL_QUESTIONS_ANSWERS';
        default:
          return 'TEMPLATE_DEFAULT_OTHER';
      }
    };

    const fetchTemplateData = async () => {
      try {
        const response = await getDcSystemConfigListByStandType({
          standType: getStandType(),
        });
        if (cancelled) return;

        let templateData = response?.data;
        if (!Array.isArray(templateData) || templateData.length === 0) {
          templateData = DEFAULT_TEMPLATE_DATA;
        } else {
          templateData = [...response.data].sort((a, b) => (a.paramSeq || 0) - (b.paramSeq || 0));
        }

        setTemplateData(templateData);

        const { tabs, fieldValues, corePersonaDefinitionJson } = buildTemplatePromptConfig(templateData, isEN);

        // 新建时使用模板，编辑时使用已有数据
        // 通过 agentId 判断是否为新建：没有 agentId 表示新建
        if (!agentId) {
          setConfigurableTabs(tabs);
          setActivePromptTabKey((current) => current || tabs[0]?.key);
          let roleObj = {};
          try {
            roleObj = JSON.parse(form.getFieldValue('role') || '{}');
          } catch {
            roleObj = {};
          }
          tabs.forEach((tab) => {
            roleObj[tab.key] = fieldValues[tab.key] || '';
          });
          roleObj.corePersonaDefinition = corePersonaDefinitionJson;
          roleObj.personalityDefinition = corePersonaDefinitionJson;

          internalSyncRef.current = true;
          form.setFieldsValue({
            role: JSON.stringify(roleObj),
            corePersonaDefinition: corePersonaDefinitionJson,
            ...fieldValues,
          });
          internalSyncRef.current = false;
        }
      } catch (error) {
        if (cancelled) return;
        console.error('获取自定义配置模板失败', error);
      }
    };

    fetchTemplateData();
    return () => {
      cancelled = true;
    };
  }, [agentType, agentId, form]);

  const corePersonaDefinitionValue = Form.useWatch('corePersonaDefinition', { form, preserve: true });

  useEffect(() => {
    if (!agentId) return;
    if (!Array.isArray(templateData) || templateData.length === 0) return;

    const parsedConfig = parseCorePersonaDefinition(corePersonaDefinitionValue, isEN);
    const templateKeys = templateData.map((item) => item.paramEnName || item.paramName).filter(Boolean);
    const matchesCurrentTemplate = templateKeys.some((key) => parsedConfig.tabs.some((tab) => tab.key === key));

    if (parsedConfig.isArray && parsedConfig.tabs.length > 0 && matchesCurrentTemplate) {
      setConfigurableTabs(parsedConfig.tabs);
      setActivePromptTabKey((current) =>
        current && parsedConfig.tabs.some((item) => item.key === current) ? current : parsedConfig.tabs[0].key
      );

      internalSyncRef.current = true;
      form.setFieldsValue(parsedConfig.fieldValues);
      internalSyncRef.current = false;
      return;
    }

    const { tabs, fieldValues, corePersonaDefinitionJson } = buildTemplatePromptConfig(templateData, isEN);
    let roleObj = {};
    try {
      roleObj = JSON.parse(form.getFieldValue('role') || '{}');
    } catch {
      roleObj = {};
    }
    tabs.forEach((tab) => {
      roleObj[tab.key] = fieldValues[tab.key] || '';
    });
    roleObj.corePersonaDefinition = corePersonaDefinitionJson;
    roleObj.personalityDefinition = corePersonaDefinitionJson;
    setConfigurableTabs(tabs);
    setActivePromptTabKey((current) => (current && tabs.some((item) => item.key === current) ? current : tabs[0]?.key));
    internalSyncRef.current = true;
    form.setFieldsValue({
      role: JSON.stringify(roleObj),
      corePersonaDefinition: corePersonaDefinitionJson,
      ...fieldValues,
    });
    internalSyncRef.current = false;
  }, [agentId, corePersonaDefinitionValue, form, templateData]);

  // 同步岗位职责数据到表单字段（coreAbility 文本 + coreCompetencies 结构化列表）
  useEffect(() => {
    const abilityText = coreAbilities.map((item) => `${item.name}: ${item.description}`).join('\n');

    const coreCompetencies = coreAbilities.map((item) => ({
      coreCompetency: item.name,
      description: item.description,
      acceptBoundary: Array.isArray(item.acceptBoundary) ? item.acceptBoundary : [],
      rejectBoundary: Array.isArray(item.rejectBoundary) ? item.rejectBoundary : [],
      example: Array.isArray(item.example) ? item.example : [],
    }));

    const prevCoreAbility = form.getFieldValue('coreAbility') || '';
    const prevCoreCompetencies = form.getFieldValue('coreCompetencies') || [];

    const isAbilityChanged = abilityText !== prevCoreAbility;
    const isCompetenciesChanged = JSON.stringify(coreCompetencies) !== JSON.stringify(prevCoreCompetencies);

    if (isAbilityChanged || isCompetenciesChanged) {
      internalSyncRef.current = true;
      form.setFieldsValue({
        coreAbility: abilityText,
        coreCompetencies,
      });
      internalSyncRef.current = false;
    }
  }, [coreAbilities, form]);

  useEffect(() => {
    const coreCompetenciesFromForm = initialCoreCompetencies;

    if (!Array.isArray(coreCompetenciesFromForm) || coreCompetenciesFromForm.length === 0) {
      return;
    }

    const hasCoreCompetenciesChanged =
      JSON.stringify(coreCompetenciesFromForm || []) !== JSON.stringify(prevInitialCoreCompetenciesRef.current || []);

    if (!hasCoreCompetenciesChanged) {
      return;
    }

    const parsedFromStruct = coreCompetenciesFromForm.map((item, index) => ({
      id: `${item.coreCompetency || 'core_ability'}_${index}`,
      name: item.coreCompetency || '',
      description: item.description || '',
      icon: abilityIcons[index % abilityIcons.length].type,
      color: abilityColors[index % abilityColors.length].value,
      expanded: true, // 前3个默认展开
      acceptBoundary: Array.isArray(item.acceptBoundary) ? item.acceptBoundary : [],
      rejectBoundary: Array.isArray(item.rejectBoundary) ? item.rejectBoundary : [],
      example: Array.isArray(item.example) ? item.example : [],
    }));

    setCoreAbilities(parsedFromStruct);
    prevInitialCoreCompetenciesRef.current = coreCompetenciesFromForm || [];
  }, [initialCoreCompetencies]);

  // 管理地址表格列配置
  const managementColumns = [
    {
      title: (
        <span className={styles.fontWeightBold}>
          {intl.formatMessage({ id: 'thirdPartyCreateModel.managementName' })}
        </span>
      ),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: (
        <span className={styles.fontWeightBold}>
          {intl.formatMessage({
            id: 'thirdPartyCreateModel.managementAddressValue',
          })}
        </span>
      ),
      dataIndex: 'url',
      key: 'url',
    },
    {
      title: <span className={styles.fontWeightBold}>{intl.formatMessage({ id: 'common.operation' })}</span>,
      key: 'action',
      width: 80,
      render: (_, record) => {
        return (
          <Button
            type="link"
            disabled={isReadOnly}
            className={styles.paddingHorizontalNone}
            onClick={() => {
              setManagementAddresses((prev) => {
                return prev.filter((item) => item.key !== record.key);
              });
            }}
          >
            {intl.formatMessage({ id: 'common.delete' })}
          </Button>
        );
      },
    },
  ];

  // 添加管理地址
  const addManagementAddress = () => {
    const newKey = (managementAddresses.length + 1).toString();
    setManagementAddresses((prev) => {
      return [...prev, { key: newKey, name: '', url: '' }];
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleCompositionEnd = useCallback(() => {
    updateResource();
    compositionRef.current = false;
  }, [updateResource]);

  const syncRoleToForm = useCallback(
    (overrideValues: Record<string, any> = {}, tabs?: Array<{ key: string; name: string; isSystem?: boolean }>) => {
      let roleObj = {};
      const roleStr = form.getFieldValue('role') || '{}';
      try {
        roleObj = JSON.parse(roleStr || '{}');
      } catch {
        roleObj = {};
      }

      // 获取所有可配置的 tab（优先使用传入的 tabs，否则使用 configurableTabs）
      const allTabs = tabs ? [...tabs] : [...configurableTabs];

      // 获取所有需要的字段名（包括可配置 tab 的 key 和其他角色相关字段）
      const allFieldNames = [...rolePromptFieldNames, ...allTabs.map((tab) => tab.key)];

      const current = {
        ...form.getFieldsValue(allFieldNames),
        ...overrideValues,
      };

      rolePromptFieldNames.forEach((key) => {
        roleObj[key] =
          current[key] ||
          (key === 'customPromptTabs' ? [] : key === 'customPromptValues' ? {} : key === 'bundledSkills' ? [] : '');
      });
      roleObj.roleAttributes = current.roleAttributes || current.workStandard || '';

      // 将所有配置存成 JSON 放到 corePersonaDefinition 字段（数组格式）
      const corePersonaDefinition: Array<{ name: string; key: string; value: string }> = [];

      // 获取所有 prompt 字段的名称映射（从模板数据中获取）
      const fieldNameMap: Record<string, { name: string; key: string }> = {};

      // 尝试从模板数据中获取字段映射
      if (templateData && Array.isArray(templateData)) {
        templateData.forEach((item: any) => {
          if (item.paramEnName && item.paramName) {
            fieldNameMap[item.paramEnName] = {
              name: item.paramName,
              key: item.paramEnName,
            };
          }
        });
      }

      // 从现有的 corePersonaDefinition 中获取 name 信息（用于编辑时保持原有值）
      const existingNameMap: Record<string, string> = {};
      try {
        const existingData = JSON.parse(current.corePersonaDefinition || '[]');
        if (Array.isArray(existingData)) {
          existingData.forEach((item: any) => {
            if (item && item.key) {
              existingNameMap[item.key] = item.name || item.key;
            }
          });
        }
      } catch {
        // 解析失败，使用模板数据或key作为name
      }

      // 遍历所有 tab，将值存入 corePersonaDefinition
      allTabs.forEach((tab) => {
        const fieldValue = current[tab.key];
        if (fieldValue) {
          const fieldInfo = fieldNameMap[tab.key];
          const key = fieldInfo?.key || tab.key;
          const name = existingNameMap[key] || fieldInfo?.name || tab.name || tab.key;

          corePersonaDefinition.push({
            name,
            key,
            value: fieldValue,
          });
        }
      });

      const corePersonaDefinitionJson = JSON.stringify(corePersonaDefinition);
      roleObj.corePersonaDefinition = corePersonaDefinitionJson;
      roleObj.personalityDefinition = corePersonaDefinitionJson;

      internalSyncRef.current = true;
      form.setFieldsValue({
        role: JSON.stringify(roleObj),
        corePersonaDefinition: corePersonaDefinitionJson,
      });
      internalSyncRef.current = false;

      // 返回 Promise，确保表单字段更新完成后再执行后续操作
      return Promise.resolve();
    },
    [form, configurableTabs, templateData]
  );

  const updateBundledSkills = useCallback(
    async (nextSkills = []) => {
      form.setFieldsValue({ bundledSkills: nextSkills });
      await syncRoleToForm({ bundledSkills: nextSkills });
      updateResource();
    },
    [form, syncRoleToForm, updateResource]
  );

  const filteredBundledSkillOptions = useMemo(() => {
    const keyword = trim(bundledSkillSearchName).toLowerCase();
    if (!keyword) {
      return bundledSkillOptions;
    }
    return bundledSkillOptions.filter((item) => {
      return [item.label, item.value, item.description].some((value) =>
        `${value || ''}`.toLowerCase().includes(keyword)
      );
    });
  }, [bundledSkillOptions, bundledSkillSearchName]);

  const renderPromptTextArea = useCallback(
    (name, placeholder) => (
      <Form.Item name={name} className={styles.marginBottomNone}>
        <TextArea
          className={styles.personalityDefinitionTextArea}
          autoSize={{ minRows: 5, maxRows: 10 }}
          placeholder={placeholder}
          disabled={isReadOnly}
          onBlur={() => {
            if (!compositionRef.current) {
              updateResource();
            }
          }}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
        />
      </Form.Item>
    ),
    [isReadOnly, updateResource, handleCompositionEnd]
  );

  const handleAddCustomPromptTab = useCallback(async () => {
    const name = trim(customPromptName);
    if (!name) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.promptField.customNameRequired' }));
      return;
    }

    // 检查所有可配置 tab 中是否有重复名称
    const existingNames = [...configurableTabs.map((item) => trim(item.name))];
    if (existingNames.some((item) => item === name)) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.promptField.duplicateName' }));
      return;
    }

    const nextTab = { key: `custom_${nanoid()}`, name, isSystem: false };
    const nextConfigurableTabs = [...configurableTabs, nextTab];
    const nextCustomPromptTabs = [...customPromptTabs, { key: nextTab.key, name: nextTab.name }];

    // 更新可配置 tab 列表
    console.log('nextConfigurableTabs', nextConfigurableTabs);
    setConfigurableTabs(nextConfigurableTabs);

    // 更新表单字段
    form.setFieldsValue({ customPromptTabs: nextCustomPromptTabs });
    // 传入最新的 tabs，确保 syncRoleToForm 使用最新的 tab 列表
    await syncRoleToForm({ customPromptTabs: nextCustomPromptTabs }, nextConfigurableTabs);
    setActivePromptTabKey(nextTab.key);
    setCustomPromptName('');
    setCustomPromptModalOpen(false);
    updateResource();
  }, [customPromptName, customPromptTabs, configurableTabs, form, intl, syncRoleToForm, updateResource]);

  const handleDeletePromptTab = useCallback(
    async (tabKey) => {
      const deleteIndex = configurableTabs.findIndex((item) => item.key === tabKey);
      const nextTabs = configurableTabs.filter((item) => item.key !== tabKey);

      // 清除对应字段的值
      const fieldValues = { ...form.getFieldsValue() };
      delete fieldValues[tabKey];

      // 更新可配置 tab 列表
      console.log('nextTabs', nextTabs);
      setConfigurableTabs(nextTabs);

      // 更新表单字段
      form.setFieldsValue(fieldValues);

      // 同步 role（传入最新的 tabs），等待完成
      await syncRoleToForm({}, nextTabs);

      // 如果删除的是当前激活的 tab，优先切换到前一个 tab
      if (activePromptTabKey === tabKey) {
        setActivePromptTabKey(nextTabs[Math.max(deleteIndex - 1, 0)]?.key || '');
      }

      updateResource();
    },
    [activePromptTabKey, configurableTabs, form, syncRoleToForm, updateResource]
  );

  const promptTabItems = useMemo(() => {
    // 从 configurableTabs 获取所有可配置的 tab（包括系统默认和自定义的）
    const tabs = configurableTabs.map((item) => ({
      key: item.key,
      label: (
        <span className={styles.customPromptTabLabel}>
          <span className={styles.promptFieldLabel}>{item.name}</span>
          {!isReadOnly && configurableTabs.length > 1 && (
            <Popconfirm
              title={intl.formatMessage({ id: 'employeeDetail.promptField.deleteConfirm' })}
              okText={intl.formatMessage({ id: 'common.delete' })}
              cancelText={intl.formatMessage({ id: 'employeeDetail.cancel' })}
              onConfirm={(e) => {
                e?.stopPropagation?.();
                handleDeletePromptTab(item.key);
              }}
            >
              <AntdIcon
                type="icon-a-Deleteshanchu"
                className={styles.customPromptDeleteIcon}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          )}
        </span>
      ),
      children: renderPromptTextArea(
        item.key,
        intl.formatMessage({ id: 'employeeDetail.promptField.customPlaceholder' }, { name: item.name })
      ),
    }));

    return tabs;
  }, [configurableTabs, intl, renderPromptTextArea, isReadOnly]);

  const handleTagAdd = (value) => {
    if (value && !tags.includes(value)) {
      setTags([...tags, value]);
    }
    if (value && !selectedTags.includes(value)) {
      setSelectedTags([...selectedTags, value]);
    }
    setInputTag('');
  };

  const handleTagSelect = (value) => {
    if (value && !selectedTags.includes(value)) {
      setSelectedTags([...selectedTags, value]);
    }
    setInputTag('');
  };

  const handleTagPressEnter = () => {
    if (inputTag.trim()) {
      // 检查是否已存在该选项
      const existingOption = tagOptions.find((option) => {
        return option.value.toLowerCase() === inputTag.trim().toLowerCase();
      });

      if (!existingOption) {
        // 如果不存在，新增选项
        const newOption = {
          value: inputTag.trim(),
          label: inputTag.trim(),
        };
        // 这里可以更新tagOptions，但由于它是常量，我们直接添加到selectedTags
        setTagOptions([...tagOptions, newOption]);
        handleTagAdd(inputTag.trim());
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

  const getColumn = (columns) => {
    return columns.map((column) => {
      return {
        render: (text, record, index) => {
          return (
            <Input
              key={index}
              value={text}
              disabled={isReadOnly}
              onChange={(e) => {
                setManagementAddresses(
                  managementAddresses.map((it, i) => {
                    return i === index ? { ...it, [column.dataIndex]: e.target.value } : it;
                  })
                );
              }}
            />
          );
        },
        ...column,
      };
    });
  };
  const avatarMenu = [
    {
      key: 'upload',
      label: intl.formatMessage({ id: 'employeeDetail.uploadImage' }),
      icon: <AntdIcon type="icon-shouye-icon-wrapper1" />,
    },
  ];

  const onAvatarClick = (url) => () => {
    // 如果url是对象，表示还在上传中，不进行处理
    if (typeof url !== 'string') {
      return;
    }
    resultDataRef.current = {
      ...resultDataRef.current,
      avatar: url,
    };
    setAvatar(url);
  };

  const avatarMenuRender = (menu) => (
    <div className={pStyles.avatarMenu}>
      <div className={pStyles.menuHead}>
        <div className={pStyles.menuTitle}>{intl.formatMessage({ id: 'employeeDetail.avatar' })}</div>
        <div className={pStyles.menuClose} onClick={() => setAvatarMenuOpen(false)}>
          <AntdIcon type="icon-a-Closeguanbi" />
        </div>
      </div>
      <div className={pStyles.menuBody}>
        {[...ManAvatarList, ...WomanAvatarList, ...uploadImgs, ...(lastAvatar ? [lastAvatar] : [])].map((it, i) => (
          <figure
            key={i}
            className={classnames(pStyles.avatarItem, it.localUrl && pStyles.loadingimage)}
            onClick={onAvatarClick(it)}
          >
            <Image
              src={typeof it === 'string' ? getAvatarUrl(it) : it.localUrl}
              width={40}
              height={40}
              defaultSrc={getAvatarUrl()}
            />
          </figure>
        ))}
      </div>
      <div className={pStyles.menuFoot}>{menu}</div>
    </div>
  );

  const handleAvatarMenuClick = async (item) => {
    if (item.key === 'upload') {
      const img = await pick({
        accept: 'image/*',
        maxSize: 1024 * 1024 * 5,
        maxWidth: 200,
        maxHeight: 200,
      });
      if (!img) return;
      const localUrl = URL.createObjectURL(img);
      // 先显示本地图片
      setUploadImgs((v) => [...v, { localUrl }]);

      const res = await compressImgFileAndUpload({ file: img });
      if (res?.datasetLogosUrl) {
        const { datasetLogosUrl } = res;

        setUploadImgs((v) => {
          const idx = v.findIndex((x) => typeof x !== 'string' && x.localUrl === localUrl);

          if (idx !== -1) {
            window.URL.revokeObjectURL(v[idx].localUrl);
            v[idx] = datasetLogosUrl;
          }
          return [...v];
        });

        onAvatarClick(datasetLogosUrl)();

        return;
      }
      message.error(res?.msg || intl.formatMessage({ id: 'employeeDetail.uploadFail' }));
    }
  };

  // （已上移至文件前部）

  return (
    <div className={classnames('ub-f1 full-width full-height', className, styles.paddingHorizontal16)}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          corePersonaDefinition: DEFAULT_PERSONALITY_DEFINITION,
        }}
        onValuesChange={(changedValues) => {
          onValuesChange?.(changedValues);

          if (internalSyncRef.current) return;
          const abilityKeys = ['coreAbility', 'abilityBoundary', 'exampleQuestions'];
          const roleKeys = rolePromptFieldNames;
          const promptFieldKeys = configurableTabs.map((item) => item.key);

          try {
            // 同步 abilityDesc
            if (abilityKeys.some((k) => Object.prototype.hasOwnProperty.call(changedValues, k))) {
              let descObj = {};
              const abilityDescStr = form.getFieldValue('abilityDesc') || '{}';
              try {
                descObj = JSON.parse(abilityDescStr || '{}');
              } catch {
                descObj = {};
              }
              const current = form.getFieldsValue(abilityKeys);
              descObj[abilityFieldMapping.coreAbility] = current.coreAbility || '';
              descObj[abilityFieldMapping.abilityBoundary] = current.abilityBoundary || '';
              descObj[abilityFieldMapping.exampleQuestions] = current.exampleQuestions || '';
              internalSyncRef.current = true;
              form.setFieldsValue({ abilityDesc: JSON.stringify(descObj) });
              internalSyncRef.current = false;
            }

            // 同步 role
            if (roleKeys.some((k) => Object.prototype.hasOwnProperty.call(changedValues, k))) {
              syncRoleToForm();
            }

            if (promptFieldKeys.some((k) => Object.prototype.hasOwnProperty.call(changedValues, k))) {
              syncRoleToForm();
            }
          } catch {}

          if (!compositionRef.current) {
            updateResource();
          }
        }}
        className={classnames(styles.formSection, 'full-height')}
      >
        <Form.Item name="customPromptTabs" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="customPromptValues" hidden>
          <Input />
        </Form.Item>
        <div className="ub full-height">
          <div className={classnames(styles.basicSettings, 'full-height')}>
            <p className={styles.fontSize16Weight500}>{intl.formatMessage({ id: 'employeeDetail.basicSettings' })}</p>
            <div className={pStyles.avatarSection}>
              <Dropdown
                dropdownRender={avatarMenuRender}
                trigger={['click']}
                placement="bottom"
                open={!isReadOnly && avatarMenuOpen}
                onOpenChange={setAvatarMenuOpen}
                getPopupContainer={() => document.body}
                menu={{ items: avatarMenu, onClick: handleAvatarMenuClick }}
              >
                <div>
                  <figure className={pStyles.currentAvatar}>
                    <Image src={getAvatarUrl(avatar)} width="100%" />
                  </figure>
                </div>
              </Dropdown>
              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) => {
                  return (
                    prevValues.resourceName !== currentValues.resourceName ||
                    prevValues.resourceDesc !== currentValues.resourceDesc
                  );
                }}
              >
                {({ getFieldValue }) => {
                  const canQuickCreate = trim(getFieldValue('resourceName')) && trim(getFieldValue('resourceDesc'));
                  return (
                    <div className="ub ub-ac gap4">
                      <div
                        className={classnames(pStyles.quickCreate, {
                          [pStyles.quickCreateDisabled]: !canQuickCreate,
                          [styles.displayNone]: isReadOnly,
                        })}
                        onClick={() => {
                          if (canQuickCreate) {
                            setRefineModalOpen(true);
                          }
                        }}
                      >
                        <span className={pStyles.magicIcon} role="img" aria-label="shansuo">
                          ✨
                        </span>{' '}
                        {intl.formatMessage({ id: 'employeeDetail.refine' })}
                      </div>
                      {!canQuickCreate && (
                        <Tooltip
                          title={intl.formatMessage({
                            id: 'employeeDetail.quickCreateTooltip',
                          })}
                        >
                          <ExclamationCircleOutlined />
                        </Tooltip>
                      )}
                    </div>
                  );
                }}
              </Form.Item>
            </div>
            <Form.Item
              label={intl.formatMessage({ id: 'form.name' })}
              name="resourceName"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: 'employeeDetail.namePlaceholder',
                  }),
                },
              ]}
              help={auditErrors.resourceName}
              validateStatus={auditErrors.resourceName ? 'error' : ''}
            >
              <Input
                placeholder={intl.formatMessage({
                  id: 'employeeDetail.namePlaceholder',
                })}
                onCompositionStart={() => {
                  compositionRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  return handleCompositionEnd(e, 'resourceName');
                }}
                disabled={isReadOnly}
                maxLength={300}
              />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'employeeDetail.digitalEmployeeDesc' })}
              name="resourceDesc"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'employeeDetail.digitalEmployeeDescRequired' }),
                },
              ]}
            >
              <TextArea
                rows={3}
                placeholder={intl.formatMessage({ id: 'employeeDetail.digitalEmployeeDescPlaceholder' })}
                disabled={isReadOnly}
                onCompositionStart={() => {
                  compositionRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  return handleCompositionEnd(e, 'digitalEmployeeDescription');
                }}
                maxLength={4000}
              />
            </Form.Item>
            {/* 岗位职责 */}
            <div className={styles.commonQuestion}>
              <div className={styles.questionLabel}>
                <span>
                  {intl.formatMessage({ id: 'employeeDetail.coreAbility' })}
                  <Tooltip title={intl.formatMessage({ id: 'employeeDetail.coreAbilityHint' })}>
                    <QuestionCircleOutlined className={styles.tooltipIcon} />
                  </Tooltip>
                </span>
                {!isReadOnly && (
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
                      updateResource();
                    }}
                    className={styles.paddingNoneHeightAuto}
                  >
                    + {intl.formatMessage({ id: 'common.plus' })}
                  </Button>
                )}
              </div>
              <div className={styles.questionContent}>
                {coreAbilities.map((ability) => (
                  <Card key={ability.id}>
                    <div className={styles.content}>
                      {/* <span>{index + 1}、</span> */}
                      <Form.Item
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({ id: 'employeeDetail.abilityNameRequired' }),
                          },
                        ]}
                        className={styles.marginBottomNoneFlex1}
                      >
                        <Input
                          placeholder={intl.formatMessage({ id: 'employeeDetail.abilityNamePlaceholder' })}
                          value={ability.name}
                          onChange={(e) => {
                            setCoreAbilities(
                              coreAbilities.map((item) =>
                                item.id === ability.id ? { ...item, name: e.target.value } : item
                              )
                            );
                          }}
                          onBlur={() => {
                            if (!compositionRef.current) {
                              updateResource();
                            }
                          }}
                          onCompositionStart={() => {
                            compositionRef.current = true;
                          }}
                          onCompositionEnd={handleCompositionEnd}
                          disabled={isReadOnly}
                          bordered={false}
                          className={styles.abilityNameInput}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Form.Item>
                      {!isReadOnly && (
                        <AntdIcon
                          type="icon-a-Deleteshanchu"
                          className={styles.actionIcon}
                          onClick={(e) => {
                            e?.stopPropagation?.();
                            setCoreAbilities(coreAbilities.filter((item) => item.id !== ability.id));
                            updateResource();
                          }}
                        />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
            {/* 自定义配置 */}
            <div className={styles.personalityDefinitionSection}>
              <Tabs
                activeKey={activePromptTabKey}
                onChange={setActivePromptTabKey}
                items={promptTabItems}
                tabBarExtraContent={
                  !isReadOnly
                    ? {
                        right: (
                          <Button
                            type="link"
                            className={styles.customPromptAddButton}
                            onClick={() => {
                              setCustomPromptName('');
                              setCustomPromptModalOpen(true);
                            }}
                          >
                            + {intl.formatMessage({ id: 'common.plus' })}
                          </Button>
                        ),
                      }
                    : undefined
                }
              />
              <Modal
                open={customPromptModalOpen}
                title={intl.formatMessage({ id: 'employeeDetail.promptField.customModalTitle' })}
                okText={intl.formatMessage({ id: 'common.confirm' })}
                cancelText={intl.formatMessage({ id: 'employeeDetail.cancel' })}
                onOk={handleAddCustomPromptTab}
                onCancel={() => {
                  setCustomPromptModalOpen(false);
                  setCustomPromptName('');
                }}
                destroyOnClose
              >
                <Input
                  autoFocus
                  value={customPromptName}
                  placeholder={intl.formatMessage({ id: 'employeeDetail.promptField.customNamePlaceholder' })}
                  onChange={(e) => setCustomPromptName(e.target.value)}
                  onPressEnter={(e) => {
                    e.preventDefault();
                    handleAddCustomPromptTab();
                  }}
                />
              </Modal>
            </div>
          </div>
          <div className={classnames(styles.configurationDetails, 'full-height')}>
            <div className={classnames('ub ub-ac', styles.marginBottom12)}>
              <div className={styles.fontSize16Weight500}>
                {intl.formatMessage({ id: 'employeeDetail.configDetails' })}
              </div>
              <div className={classnames(pStyles.topSection, 'ub-f1')}>
                <Popover
                  content={
                    <ModelPopover
                      modelList={modelList}
                      resultDataRef={resultDataRef}
                      prologueRef={prologueRef}
                      setModelName={setModelName}
                    />
                  }
                  trigger={!isReadOnly ? ['click'] : []}
                  placement="bottomRight"
                  arrow={false}
                >
                  <div className={pStyles.configBox}>
                    <AntdIcon type="icon-a-Sphereyuanqiu1" className={styles.fontSize20} />
                    <span className={pStyles.modelName}>{modelName}</span>
                    <AntdIcon type="icon-a-Downxia1" />
                  </div>
                </Popover>
              </div>
            </div>

            {/* 数字员工类型 */}
            {digitalType !== 'FROM_THIRD' && (
              <div className={styles.rowFlexBetween}>
                <div>
                  <span>{intl.formatMessage({ id: 'employeeDetail.employeeType' })}</span>
                </div>
                <Form.Item
                  noStyle
                  shouldUpdate={(prevValues, currentValues) => prevValues.ownerType !== currentValues.ownerType}
                >
                  {({ getFieldValue }) => {
                    const isPersonal =
                      getFieldValue('ownerType') !== 'enterprise' && effectiveOwnerType !== 'enterprise';
                    if (isPersonal) {
                      return (
                        <span className={styles.typeTag}>
                          <span className={styles.tagText}>
                            {intl.formatMessage({ id: 'employeeDetail.personalAssistant' })}
                          </span>
                        </span>
                      );
                    }
                    return (
                      <span className={styles.typeTag}>
                        <span className={styles.tagText}>
                          {agentTypeOptions.find((item) => item.value === agentType)?.label}
                        </span>
                      </span>
                    );
                  }}
                </Form.Item>
              </div>
            )}

            {/* 目录管理 */}
            <Form.Item label={intl.formatMessage({ id: 'employeeDetail.catalogManage' })} name="catalogId">
              <TreeSelect
                allowClear
                treeData={catalogList}
                placeholder={intl.formatMessage({
                  id: 'employeeDetail.catalogManagePlaceholder',
                })}
                treeDataSimpleMode={{
                  id: 'catalogId',
                  pId: 'pcatalogId',
                  // 与 ss_resource_catalog 顶层 p_catalog_id = -1 一致，否则简单模式无法挂根、选中项不回显
                  rootPId: -1,
                }}
                fieldNames={{
                  label: 'catalogName',
                  value: 'catalogId',
                }}
                showSearch
                treeNodeFilterProp="catalogName"
                loading={catalogLoading}
                disabled={isReadOnly}
                onChange={() => {
                  updateResource();
                }}
              />
            </Form.Item>

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
                placeholder={intl.formatMessage({
                  id: 'employeeDetail.tagSearchPlaceholder',
                })}
                options={tagOptions}
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
                className={styles.marginBottom8}
                showSearch
                allowClear
                disabled={isReadOnly}
              />
            </Form.Item>
            {/* 开场白 */}
            <Form.Item label={intl.formatMessage({ id: 'employeeDetail.opening' })} name="descText">
              <TextArea
                rows={3}
                placeholder={intl.formatMessage({
                  id: 'employeeDetail.openingPlaceholder',
                })}
                disabled={isReadOnly}
                onCompositionStart={() => {
                  compositionRef.current = true;
                }}
                onCompositionEnd={handleCompositionEnd}
                maxLength={2000}
              />
            </Form.Item>

            {/* 开场引导问题 */}
            <div className={styles.commonQuestion}>
              <div className={styles.questionLabel}>
                <span>{intl.formatMessage({ id: 'employeeDetail.questions' })}</span>
                {!isReadOnly && (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setQuestionList((pre) =>
                        pre.concat([
                          {
                            infoTitle: '',
                            infoContent: '',
                            instructCode: '',
                            slotSettings: {},
                            infoType: 5,
                            datasetIdList: [],
                            uuid: nanoid(),
                          },
                        ])
                      );
                      updateResource();
                    }}
                    className={styles.paddingNoneHeightAuto}
                  >
                    + {intl.formatMessage({ id: 'common.plus' })}
                  </Button>
                )}
              </div>
              <div className={styles.questionContent}>
                {questionList.map((item, index) => (
                  <Card key={index}>
                    <div className={styles.content}>
                      <Input
                        bordered={false}
                        value={item.infoTitle}
                        maxLength={200}
                        onChange={(e) => {
                          setQuestionList((pre) =>
                            pre.map((it, i) => {
                              if (index === i) {
                                set(it, 'infoTitle', e.target.value);
                                set(it, 'infoContent', e.target.value);
                                set(it, 'instructCode', e.target.value);
                                return it;
                              }
                              return it;
                            })
                          );
                        }}
                        placeholder={intl.formatMessage({
                          id: 'employeeDetail.questionPlaceholder',
                        })}
                        onBlur={() => {
                          if (item) {
                            updateResource();
                          }
                        }}
                        disabled={isReadOnly}
                      />
                      {!isReadOnly && (
                        <AntdIcon
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
                            updateCompositeAppInfo?.();
                          }}
                          disabled={isReadOnly}
                        />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
            {/* 数字员工查询终端类型 */}
            {/* <Form.Item
              label={intl.formatMessage({ id: 'employeeDetail.terminalType' })}
              name="terminal"
              initialValue={terminalTypeList[0]?.value}
            >
              <Radio.Group disabled={isReadOnly}>
                {terminalTypeList.map((item) => (
                  <Radio key={item.value} value={item.value}>
                    {item.label}
                  </Radio>
                ))}
              </Radio.Group>
            </Form.Item> */}
            {/* {(digitalType === 'FROM_THIRD' || digitalType === 'FROM_SANDBOX') && ( */}
            <UploadFileConfig isOutsideSkills prologueRef={prologueRef} isReadOnly={isReadOnly} />
            {/* )} */}
            {/* {digitalType === 'FROM_MANUALLY' && ( */}
            <>
              {/* 配置工具 */}
              {employeeType !== '006' && (
                <div className={styles.skillsSection}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                      {intl.formatMessage({
                        id: 'employeeDetail.configureSkills',
                      })}
                    </span>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        showBaseList('005');
                        // setToolSelectorOpen(true);
                      }}
                      disabled={isReadOnly}
                    >
                      + {intl.formatMessage({ id: 'common.plus' })}
                    </Button>
                  </div>
                  {/* <UploadFileConfig prologueRef={prologueRef} isReadOnly={isReadOnly} setSkills={setSkills} /> */}
                  <div className={styles.skillsList}>
                    {skills.map((skill, index) => {
                      return (
                        <Card
                          key={[skill.id, index].join()}
                          className={classnames(styles.configCard, styles.skillCard)}
                        >
                          <div className={styles.skillContent}>
                            <AntdIcon type="icon-chajiantubiao" className={styles.fontSize36MarginRight12} />
                            <div className={styles.skillInfo}>
                              <div className={styles.skillHeader}>
                                <span className={styles.skillName}>{skill.resourceName}</span>
                                <Tag size="small" className={styles.skillTag}>
                                  {
                                    {
                                      AGENT: intl.formatMessage({
                                        id: 'employeeDetail.skillType.agent',
                                      }),
                                      TOOLKIT: intl.formatMessage({
                                        id: 'employeeDetail.skillType.toolkit',
                                      }),
                                      TOOL: intl.formatMessage({
                                        id: 'employeeDetail.skillType.tool',
                                      }),
                                      MCP: 'MCP',
                                      VIEW: intl.formatMessage({ id: 'employeeDetail.view' }),
                                      OBJECT: intl.formatMessage({ id: 'employeeDetail.object' }),
                                    }[skill.grantResourceType]
                                  }
                                </Tag>
                              </div>
                              <div className={styles.skillDescription}>{skill.description}</div>
                            </div>
                            <div className={styles.skillActions}>
                              {isReadOnly ? (
                                <Space>
                                  {['VIEW', 'OBJECT'].includes(skill.grantResourceType) && (
                                    <EyeOutlined
                                      onClick={() => {
                                        setSkillItem(skill);
                                        setRelResourceInfoModalOpen(true);
                                      }}
                                    />
                                  )}
                                </Space>
                              ) : (
                                <Space>
                                  {['VIEW', 'OBJECT'].includes(skill.grantResourceType) && (
                                    <FormOutlined
                                      onClick={() => {
                                        setSkillItem(skill);
                                        setRelResourceInfoModalOpen(true);
                                      }}
                                    />
                                  )}
                                  <AntdIcon
                                    type="icon-a-Deleteshanchu"
                                    onClick={() => {
                                      setSkills(skills.filter((it) => it.resourceId !== skill.resourceId));
                                    }}
                                  />
                                </Space>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 配置知识 */}
              {employeeType !== '005' && (
                <div className={styles.knowledgeSection}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                      {intl.formatMessage({
                        id: 'employeeDetail.configureKnowledge',
                      })}
                    </span>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        showBaseList('006');
                      }}
                      disabled={isReadOnly}
                    >
                      + {intl.formatMessage({ id: 'common.plus' })}
                    </Button>
                  </div>

                  {/* 知识库类别列表 */}
                  {knowledgeBases.map((category, i) => (
                    <div key={[category.id, i].join()} className={styles.knowledgeCategory}>
                      <div className={`${styles.knowledgeItems} ${category.expanded ? styles.expanded : ''}`}>
                        {category.items.length > 0
                          ? category.items.map((item, i) => (
                              <Card
                                key={[item.id, i].join()}
                                className={classnames(styles.configCard, styles.knowledgeCard)}
                              >
                                <div className={styles.knowledgeContent}>
                                  <AntdIcon type="icon-zhishiku2" className={styles.fontSize36MarginRight12} />
                                  <div className={styles.knowledgeInfo}>
                                    <div className={styles.knowledgeDetails}>
                                      <div className={styles.knowledgeHeader}>
                                        <div className={styles.knowledgeName} title={item.resourceName}>
                                          {item.resourceName}
                                        </div>
                                        <Tag size="small" className={styles.knowledgeTag}>
                                          {knowledgeTypeLabelMap[item.grantResourceType] ||
                                            knowledgeTypeLabelMap[item.resourceBizType] ||
                                            knowledgeTypeLabelMap[category.id] ||
                                            category.title}
                                        </Tag>
                                      </div>
                                      <div className={styles.knowledgeDescription}>{item.description}</div>
                                    </div>
                                  </div>
                                  {!isReadOnly && (
                                    <AntdIcon
                                      type="icon-a-Deleteshanchu"
                                      onClick={() => {
                                        setKnowledgeBases(
                                          knowledgeBases.map((it) => {
                                            if (it.id === category.id) {
                                              return {
                                                ...it,
                                                items: it.items.filter((i) => i.resourceId !== item.resourceId),
                                              };
                                            }
                                            return it;
                                          })
                                        );
                                      }}
                                      disabled={isReadOnly}
                                    />
                                  )}
                                </div>
                              </Card>
                            ))
                          : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 配置技能 */}
              {bundledSkillOptions.length > 0 && (
                <div className={styles.skillsSection}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                      {intl.formatMessage({ id: 'employeeDetail.configureBundledSkills' })}
                    </span>
                    <Button
                      type="link"
                      size="small"
                      disabled={isReadOnly}
                      onClick={() => {
                        setBundledSkillSearchName('');
                        setBundledSkillModalOpen(true);
                      }}
                    >
                      + {intl.formatMessage({ id: 'common.plus' })}
                    </Button>
                  </div>
                  {selectedBundledSkills.length > 0 && (
                    <div className={styles.skillsList}>
                      {selectedBundledSkills
                        .map((code) => bundledSkillOptions.find((item) => item.value === code))
                        .filter(Boolean)
                        .map((item) => (
                          <Card key={item.value} className={classnames(styles.configCard, styles.skillCard)}>
                            <div className={styles.skillContent}>
                              <AntdIcon type="icon-chajiantubiao" className={styles.fontSize36MarginRight12} />
                              <div className={styles.skillInfo}>
                                <div className={styles.skillHeader}>
                                  <span className={styles.skillName}>{item.label}</span>
                                </div>
                                <div className={styles.skillDescription}>{item.description}</div>
                              </div>
                              <div className={styles.skillActions}>
                                {!isReadOnly && (
                                  <Space>
                                    <AntdIcon
                                      type="icon-a-Deleteshanchu"
                                      onClick={() => {
                                        updateBundledSkills(
                                          selectedBundledSkills.filter((code) => code !== item.value)
                                        );
                                      }}
                                    />
                                  </Space>
                                )}
                              </div>
                            </div>
                          </Card>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* 配置机器人 */}
              {robotChannelOptions.length > 0 && (
                <div className={styles.robotSection}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                      {intl.formatMessage({ id: 'employeeDetail.robotConfig.title' })}
                    </span>
                    {isReadOnly ? null : (
                      <Button
                        type="link"
                        size="small"
                        disabled={isReadOnly}
                        onClick={() => {
                          setRobotItem({});
                          setRobotModalOpen(true);
                        }}
                      >
                        + {intl.formatMessage({ id: 'employeeDetail.robotConfig.add' })}
                      </Button>
                    )}
                  </div>
                  {robotConfigs.map((item) => {
                    return (
                      <Card key={item.clientId} className={classnames(styles.configCard, styles.skillCard)}>
                        <div className={classnames(styles.skillContent, 'ub gap12 ub-ac')}>
                          <DingtalkCircleFilled className={styles.fontSize32PrimaryColor} />
                          <div className={styles.skillInfo}>
                            <div className={styles.skillHeader}>
                              <span className={styles.skillName}>
                                {intl.formatMessage({ id: 'digitalEmployeeMgr.robotName' })}
                              </span>
                            </div>
                            <div className={classnames(styles.skillDescription, styles.textTertiaryColor)}>
                              clientId: <span>{item.clientId}</span>
                            </div>
                          </div>
                          <div className={classnames(styles.skillActions, styles.marginLeftAuto)}>
                            {isReadOnly ? (
                              <EyeOutlined
                                onClick={() => {
                                  setRobotItem(item);
                                  setRobotModalOpen(true);
                                }}
                              />
                            ) : (
                              <Space>
                                <FormOutlined
                                  onClick={() => {
                                    setRobotItem(item);
                                    setRobotModalOpen(true);
                                  }}
                                />
                                <AntdIcon
                                  type="icon-a-Deleteshanchu"
                                  onClick={() => {
                                    setRobotConfigs(robotConfigs.filter((it) => it.clientId !== item.clientId));
                                  }}
                                />
                              </Space>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
            {/* )} */}
            {(digitalType === 'FROM_THIRD' || digitalType === 'FROM_SANDBOX') && (
              <>
                <Form.Item
                  label={intl.formatMessage({
                    id: 'employeeDetail.integrationMethod',
                  })}
                  name="integrationType"
                  initialValue="INTERFACE"
                >
                  <Radio.Group disabled={isReadOnly}>
                    <Radio value="INTERFACE">
                      {intl.formatMessage({
                        id: 'employeeDetail.interfaceIntegration',
                      })}
                    </Radio>
                    <Radio value="PAGE">{intl.formatMessage({ id: 'employeeDetail.pageIntegration' })}</Radio>
                    <Radio value="A2A">A2A</Radio>
                  </Radio.Group>
                </Form.Item>
                {/* 首页类型 */}
                <Form.Item
                  label={intl.formatMessage({
                    id: 'thirdPartyCreateModel.homeMethod',
                  })}
                  name="homeType"
                  initialValue={'default'}
                >
                  <Radio.Group disabled={isReadOnly}>
                    <Radio value={'default'} disabled={isReadOnly}>
                      <Space>
                        {intl.formatMessage({
                          id: 'thirdPartyCreateModel.defaultTemplate',
                        })}
                      </Space>
                    </Radio>
                    <Radio value={'custom'} disabled={isReadOnly}>
                      <Space>
                        {intl.formatMessage({
                          id: 'thirdPartyCreateModel.customTemplate',
                        })}
                        <Tooltip
                          title={intl.formatMessage({
                            id: 'thirdPartyCreateModel.customTemplateTip',
                          })}
                        >
                          <QuestionCircleOutlined className={styles.colorGray999} />
                        </Tooltip>
                      </Space>
                    </Radio>
                  </Radio.Group>
                </Form.Item>
                {/* 首页地址 - 当首页类型选择自定义时显示 */}
                <Form.Item
                  noStyle
                  shouldUpdate={(prevValues, currentValues) => {
                    return prevValues.homeType !== currentValues.homeType;
                  }}
                >
                  {({ getFieldValue }) => {
                    return getFieldValue('homeType') === 'custom' ? (
                      <Form.Item
                        label={intl.formatMessage({
                          id: 'thirdPartyCreateModel.homeAddress',
                        })}
                        name="agentHomeUrl"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({
                              id: 'thirdPartyCreateModel.homeAddressRequired',
                            }),
                          },
                        ]}
                      >
                        <Input
                          placeholder={intl.formatMessage({
                            id: 'thirdPartyCreateModel.inputPlaceholder',
                          })}
                          disabled={isReadOnly}
                        />
                      </Form.Item>
                    ) : null;
                  }}
                </Form.Item>
                {/* 对话地址 */}
                <Form.Item
                  noStyle
                  shouldUpdate={(prevValues, currentValues) => {
                    return prevValues.integrationType !== currentValues.integrationType;
                  }}
                >
                  {({ getFieldValue }) => {
                    const integrationType = getFieldValue('integrationType');
                    const isRequired = integrationType === 'INTERFACE' || integrationType === 'A2A';

                    return (
                      <Form.Item
                        label={
                          <Space>
                            <span>
                              {intl.formatMessage({
                                id: 'thirdPartyCreateModel.conversationAddress',
                              })}
                            </span>
                            <Tooltip
                              title={intl.formatMessage({
                                id: 'thirdPartyCreateModel.conversationAddressTip',
                              })}
                            >
                              <QuestionCircleOutlined className={styles.colorGray999} />
                            </Tooltip>
                          </Space>
                        }
                        name="agentSseUrlOri"
                        rules={[
                          {
                            required: isRequired,
                            message: intl.formatMessage({
                              id: 'thirdPartyCreateModel.conversationAddressRequired',
                            }),
                          },
                        ]}
                      >
                        <Input
                          placeholder={intl.formatMessage({
                            id: 'thirdPartyCreateModel.inputPlaceholder',
                          })}
                          disabled={isReadOnly}
                        />
                      </Form.Item>
                    );
                  }}
                </Form.Item>

                {/* 认证方式 */}
                <Form.Item
                  label={intl.formatMessage({
                    id: 'thirdPartyCreateModel.authMethod',
                  })}
                  name="authType"
                  initialValue={'session'}
                >
                  <Radio.Group disabled={isReadOnly}>
                    <Radio value={'session'} disabled={isReadOnly}>
                      <Space>
                        {intl.formatMessage({
                          id: 'thirdPartyCreateModel.sessionShared',
                        })}
                        <Tooltip
                          title={intl.formatMessage({
                            id: 'thirdPartyCreateModel.authMethodTip',
                          })}
                        >
                          <QuestionCircleOutlined className={styles.colorGray999} />
                        </Tooltip>
                      </Space>
                    </Radio>
                    <Radio value={'oauth2'} disabled={isReadOnly}>
                      <Space>
                        {intl.formatMessage({
                          id: 'thirdPartyCreateModel.oauth2Auth',
                        })}
                        <Tooltip
                          title={intl.formatMessage({
                            id: 'thirdPartyCreateModel.oauth2AuthTip',
                          })}
                        >
                          <QuestionCircleOutlined className={styles.colorGray999} />
                        </Tooltip>
                      </Space>
                    </Radio>
                  </Radio.Group>
                </Form.Item>

                {/* 应用地址 */}
                <Form.Item
                  label={intl.formatMessage({
                    id: 'thirdPartyCreateModel.appAddress',
                  })}
                  name="agentWebUrlOri"
                >
                  <Input
                    placeholder={intl.formatMessage({
                      id: 'thirdPartyCreateModel.inputPlaceholder',
                    })}
                    disabled={isReadOnly}
                  />
                </Form.Item>

                {/* 管理地址 */}
                <Form.Item
                  label={intl.formatMessage({
                    id: 'thirdPartyCreateModel.managementAddress',
                  })}
                  name="urlList"
                >
                  <div>
                    <Table
                      columns={getColumn(managementColumns)}
                      dataSource={managementAddresses}
                      pagination={false}
                      size="small"
                      rowKey="key"
                      disabled={isReadOnly}
                    />
                    {!isReadOnly && (
                      <Button
                        type="dashed"
                        onClick={addManagementAddress}
                        className={styles.managementAddressAddBtn}
                        disabled={isReadOnly}
                      >
                        {intl.formatMessage({
                          id: 'thirdPartyCreateModel.addManagement',
                        })}
                      </Button>
                    )}
                  </div>
                </Form.Item>
              </>
            )}
          </div>
        </div>
      </Form>
      <ExampleModal
        open={exampleOpen}
        onClose={() => setExampleOpen(false)}
        onInsert={(tpl) => {
          try {
            const data = tpl?.standCode ? JSON.parse(tpl.standCode) : {};

            // 解析岗位职责 coreCompetencies（支持数组或字符串）
            let coreCompetenciesFromTpl = [];
            const rawCoreCompetencies = data.coreCompetencies;
            if (Array.isArray(rawCoreCompetencies)) {
              coreCompetenciesFromTpl = rawCoreCompetencies;
            } else if (typeof rawCoreCompetencies === 'string') {
              try {
                const parsed = JSON.parse(rawCoreCompetencies);
                if (Array.isArray(parsed)) coreCompetenciesFromTpl = parsed;
              } catch {
                coreCompetenciesFromTpl = [];
              }
            }

            // ability/constraints/faqs 兼容数组或字符串
            const abilityText = Array.isArray(data.ability) ? data.ability.join('\n') : data.ability || '';
            const faqsText = Array.isArray(data.faqs) ? data.faqs.join('\n') : data.faqs || '';

            // 从 corePersonaDefinition 中解析数据（支持数组格式：[{name, key, value}, ...]）
            let customPromptTabs: Array<{ key: string; name: string }> = [];
            let customPromptValues: Record<string, string> = {};
            const corePersonaDefinitionValue = data.corePersonaDefinition || data.personalityDefinition || '';

            // 用于存储从 corePersonaDefinition 解析出的系统字段值
            const parsedSystemFields: Record<string, string> = {};

            // 用于存储所有可配置的 tab（包括系统字段和自定义字段）
            const parsedConfigurableTabs: Array<{ key: string; name: string; isSystem: boolean }> = [];

            // 递归解析多层嵌套的 JSON（处理多次序列化的情况）
            const parseJsonRecursively = (str: string, maxDepth: number = 5): any => {
              if (maxDepth <= 0) return str;
              try {
                const parsed = JSON.parse(str);
                if (typeof parsed === 'string') {
                  return parseJsonRecursively(parsed, maxDepth - 1);
                }
                return parsed;
              } catch {
                return str;
              }
            };

            try {
              const parsedData = parseJsonRecursively(corePersonaDefinitionValue);
              const corePersonaData = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;

              if (Array.isArray(corePersonaData)) {
                // 数组格式：[{name, key, value}, ...]
                corePersonaData.forEach((item) => {
                  if (item && item.key) {
                    const key = item.key;
                    // 解析 value 字段（处理多层转义）
                    let value = item.value;
                    if (typeof value === 'string') {
                      value = parseJsonRecursively(value);
                      // 如果解析后是数组或对象，转换为字符串
                      if (typeof value !== 'string') {
                        value = JSON.stringify(value);
                      }
                    }

                    // 直接使用 key 作为表单字段名
                    parsedSystemFields[key] = value;

                    // 添加到可配置 tab 列表
                    parsedConfigurableTabs.push({
                      key: key,
                      name: item.name || key,
                      isSystem: false,
                    });
                  }
                });
              } else if (typeof corePersonaData === 'object' && corePersonaData !== null) {
                // 兼容旧的对象格式：{key: value, ...}
                Object.keys(corePersonaData).forEach((key) => {
                  if (corePersonaData[key]) {
                    let value = corePersonaData[key];
                    if (typeof value === 'string') {
                      value = parseJsonRecursively(value);
                      if (typeof value !== 'string') {
                        value = JSON.stringify(value);
                      }
                    }
                    // 直接使用 key 作为表单字段名
                    parsedSystemFields[key] = value;

                    // 添加到可配置 tab 列表
                    parsedConfigurableTabs.push({
                      key: key,
                      name: key,
                      isSystem: false,
                    });
                  }
                });
              }
            } catch (error) {
              console.error('解析 corePersonaDefinition 失败:', error);
            }

            // 更新可配置 tab 列表
            if (parsedConfigurableTabs.length > 0) {
              console.log('parsedConfigurableTabs', parsedConfigurableTabs);
              setConfigurableTabs(parsedConfigurableTabs);
            }

            // 写入基础表单字段（受控必填/非必填）
            form.setFieldsValue({
              resourceName: data.resourceName || form.getFieldValue('resourceName'),
              resourceDesc: data.resourceDesc || form.getFieldValue('resourceDesc'),
              coreAbility: abilityText,
              coreCompetencies: coreCompetenciesFromTpl,
              abilityBoundary: data.constraints || '',
              exampleQuestions: faqsText,
              roleAttributes: data.roleAttributes || data.workStandard || parsedSystemFields.workStandard || '',
              processingFlow: data.processingFlow || '',
              personalityDimensions: data.personalityDimensions || '',
              wordPreferences: data.wordPreferences || '',
              sentenceAndTone: data.sentenceAndTone || '',
              workStandard: data.workStandard || data.roleAttributes || parsedSystemFields.workStandard || '',
              corePersonaDefinition: corePersonaDefinitionValue,
              toolStandard: data.toolStandard || parsedSystemFields.toolStandard || '',
              memoryStandard: data.memoryStandard || parsedSystemFields.memoryStandard || '',
              questionRewrite: data.questionRewrite || parsedSystemFields.questionRewrite || '',
              questionDecomposition: data.questionDecomposition || parsedSystemFields.questionDecomposition || '',
              singleSummary: data.singleSummary || parsedSystemFields.singleSummary || '',
              multipleSummary: data.multipleSummary || parsedSystemFields.multipleSummary || '',
              comprehensiveAnswer: data.comprehensiveAnswer || parsedSystemFields.comprehensiveAnswer || '',
              customPromptTabs,
              customPromptValues,
            });

            // 同步 abilityDesc 与 role JSON
            const abilityDescStr = form.getFieldValue('abilityDesc') || '{}';
            let abilityDescObj = {};
            try {
              abilityDescObj = JSON.parse(abilityDescStr || '{}');
            } catch {
              abilityDescObj = {};
            }
            abilityDescObj[abilityFieldMapping.coreAbility] = abilityText;
            abilityDescObj[abilityFieldMapping.abilityBoundary] = data.constraints || '';
            abilityDescObj[abilityFieldMapping.exampleQuestions] = faqsText;

            const roleStr = form.getFieldValue('role') || '{}';
            let roleObj = {};
            try {
              roleObj = JSON.parse(roleStr || '{}');
            } catch {
              roleObj = {};
            }
            roleObj.roleAttributes = data.roleAttributes || data.workStandard || '';
            roleObj.processingFlow = data.processingFlow || '';
            roleObj.personalityDimensions = data.personalityDimensions || '';
            roleObj.wordPreferences = data.wordPreferences || '';
            roleObj.sentenceAndTone = data.sentenceAndTone || '';
            roleObj.workStandard = data.workStandard || data.roleAttributes || '';
            roleObj.corePersonaDefinition = data.corePersonaDefinition || data.personalityDefinition || '';
            roleObj.personalityDefinition = data.corePersonaDefinition || data.personalityDefinition || '';
            roleObj.toolStandard = data.toolStandard || '';
            roleObj.memoryStandard = data.memoryStandard || '';
            roleObj.questionRewrite = data.questionRewrite || '';
            roleObj.questionDecomposition = data.questionDecomposition || '';
            roleObj.singleSummary = data.singleSummary || '';
            roleObj.multipleSummary = data.multipleSummary || '';
            roleObj.comprehensiveAnswer = data.comprehensiveAnswer || '';

            form.setFieldsValue({
              abilityDesc: JSON.stringify(abilityDescObj),
              role: JSON.stringify(roleObj),
            });

            // 如果模板提供了结构化 coreCompetencies，同步到外层岗位职责 Collapse
            if (coreCompetenciesFromTpl.length > 0) {
              const mappedAbilities = coreCompetenciesFromTpl.map((item, index) => ({
                id: nanoid(),
                name: item.coreCompetency || '',
                description: item.description || '',
                icon: abilityIcons[index % abilityIcons.length].type,
                color: abilityColors[index % abilityColors.length].value,
                expanded: true,
                acceptBoundary: Array.isArray(item.acceptBoundary) ? item.acceptBoundary : [],
                rejectBoundary: Array.isArray(item.rejectBoundary) ? item.rejectBoundary : [],
                example: Array.isArray(item.example) ? item.example : [],
              }));
              setCoreAbilities(mappedAbilities);
            }
          } catch {}
          setExampleOpen(false);
        }}
      />
      <AbilityBoundaryModal
        open={boundaryModalOpen}
        onCancel={() => {
          setBoundaryModalOpen(false);
          setEditingBoundaryAbilityId(null);
        }}
        ability={coreAbilities.find((item) => item.id === editingBoundaryAbilityId)}
        isReadOnly={isReadOnly}
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
          updateResource();
        }}
      />
      <AbilityExampleModal
        open={exampleModalOpen}
        onCancel={() => {
          setExampleModalOpen(false);
          setEditingExampleAbilityId(null);
        }}
        ability={coreAbilities.find((item) => item.id === editingExampleAbilityId)}
        isReadOnly={isReadOnly}
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
          updateResource();
        }}
      />
      <MemoryConfigModal
        open={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        onAdd={(rule) => {
          // 检查是否已添加（同时比较 id 和 templateId，确保类型一致性）
          const ruleId = String(rule.id || rule.templateId || '');
          const isAlreadyAdded = memoryRules.some((it) => {
            const addedId = String(it.id || it.templateId || '');
            return addedId === ruleId && addedId !== '';
          });
          if (!isAlreadyAdded) {
            setMemoryRules([...memoryRules, rule]);
          }
        }}
        addedRules={memoryRules}
        onRemove={(rule) => {
          // 移除时同时比较 id 和 templateId，确保类型一致性
          const ruleId = String(rule.id || rule.templateId || '');
          setMemoryRules(
            memoryRules.filter((it) => {
              const addedId = String(it.id || it.templateId || '');
              return addedId !== ruleId || addedId === '';
            })
          );
        }}
        resourceId={resultDataRef?.current?.resourceId}
      />
      <RelResourceInfoModal
        open={relResourceInfoModalOpen}
        onClose={() => setRelResourceInfoModalOpen(false)}
        onOk={(item) => {
          setSkills((prev) => {
            const target = prev.find((it) => it.resourceId === item.resourceId);
            if (target) {
              Object.assign(target, item);
              return [...prev];
            }
            return prev;
          });
        }}
        item={skillItem}
        isReadOnly={isReadOnly}
      />
      <Modal
        className={styles.bundledSkillModal}
        open={bundledSkillModalOpen}
        width={900}
        onCancel={() => setBundledSkillModalOpen(false)}
        destroyOnHidden
        closable={false}
        footer={null}
      >
        <div className={styles.modalContent}>
          <div className={styles.modalHeader}>
            <span className={styles.modalTitle}>
              {intl.formatMessage({ id: 'employeeDetail.configureBundledSkills' })}
            </span>
            <div className={styles.headerRight}>
              <Input
                className={styles.searchInput}
                suffix={<AntdIcon type="icon-a-Searchsousuo" />}
                allowClear
                value={bundledSkillSearchName}
                onChange={(e) => setBundledSkillSearchName(e.target.value)}
                placeholder={intl.formatMessage({ id: 'employeeDetail.bundledSkillsSearchPlaceholder' })}
              />
              <AntdIcon
                type="icon-a-Closeguanbi"
                className={styles.modalCloseIcon}
                onClick={() => setBundledSkillModalOpen(false)}
              />
            </div>
          </div>
          <div className={styles.bundledSkillCardListWrap}>
            <Spin spinning={bundledSkillLoading}>
              {filteredBundledSkillOptions.length > 0 ? (
                <div className={styles.bundledSkillCardList}>
                  {filteredBundledSkillOptions.map((item) => {
                    const isSelected = selectedBundledSkills.includes(item.value);

                    return (
                      <div key={item.value} className={styles.bundledSkillModalCard}>
                        <div className={styles.bundledSkillModalCardInner}>
                          <AntdIcon type="icon-chajiantubiao" className={styles.fontSize36MarginRight12} />
                          <div className={styles.bundledSkillModalCardInfo}>
                            <div className={styles.bundledSkillModalCardTitle}>
                              {item.label}
                              {/* <Tag>{item.value}</Tag> */}
                            </div>
                            <div className={styles.bundledSkillModalCardDesc}>{item.description || '-'}</div>
                          </div>
                          <Button
                            className={classnames(styles.actionButton, {
                              [styles.isAdd]: isSelected,
                              [styles.notAdd]: !isSelected,
                            })}
                            danger={isSelected}
                            size="small"
                            onClick={() => {
                              if (isSelected) {
                                updateBundledSkills(selectedBundledSkills.filter((code) => code !== item.value));
                                return;
                              }
                              updateBundledSkills([...selectedBundledSkills, item.value]);
                            }}
                          >
                            {isSelected
                              ? intl.formatMessage({ id: 'itemCard.remove' })
                              : intl.formatMessage({ id: 'common.add' })}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty />
              )}
            </Spin>
          </div>
        </div>
      </Modal>
      <ToolSelectorModal
        open={toolSelectorOpen}
        onClose={() => setToolSelectorOpen(false)}
        onConfirm={handleToolSelectorConfirm}
      />
      <RobotModal
        open={robotModalOpen}
        setOpen={setRobotModalOpen}
        onOk={handleRobotModalOk}
        robotChannelLabelMap={robotChannelLabelMap}
        item={robotItem}
        isReadOnly={isReadOnly}
      />
    </div>
  );
};

export default ConfigForm;
