// @ts-nocheck
/* eslint-disable no-param-reassign */
/* eslint-disable indent */
/* eslint-disable function-paren-newline */
/* eslint-disable no-empty */
/* eslint-disable no-empty-pattern */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AntdIcon from '@/pages/manager/components/AntdIcon';
import { Image } from '@/pages/manager/components/Image';
import useShowModal from '@/pages/manager/hooks/useShowModal';
import { getAvatarUrl } from '@/pages/manager/utils/agent';
import { showAuditConfirm } from '@/pages/manager/utils/auditConfirm';
import { getIframeUrl, getValidValue } from '@/pages/manager/utils/managerUtils';
import { agentHomeUrlHandler } from '@/pages/manager/utils/agent';
import { ArrowLeftOutlined, ArrowRightOutlined, EllipsisOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { Button, Divider, Form, message, Space, Spin, Tooltip } from 'antd';
import classnames from 'classnames';
import dayjs from 'dayjs';
import { debounce, isEmpty, set, noop, isString, omit } from 'lodash';
import { connect, history, useDispatch, useIntl, useLocation, getLocale } from '@umijs/max';
import { agentHandler } from '@/pages/manager/utils/agent';
import useGlobal from '@/pages/manager/hooks/useGlobal';
import BaseListModal from '../components/BaseListModal';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import PublishModal from '../components/PublishModal';
import RefineModal from '../components/RefineModal';
import LogInfoDrawer from './components/LogInfoDrawer';
import ConfigForm from './ConfigForm';
import OntologyResourceSelectorDrawer, { normalizeOntologyResource } from './ConfigForm/OntologyResourceSelectorDrawer';
import { normalizeRobotConfig } from './ConfigForm/robotConfig';
import { DEFAULT_PERSONALITY_DEFINITION } from './personalityDefinitionDefault';
import styles from './index.module.less';
import Log from './Log';
import Manage from './Manage';
import Operation from './Operation';

const PREVIEW_HOST = `${window.location.origin}${window.routerBase === '/' ? '/' : window.routerBase}`;
const DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH = 10000;
const DIGITAL_EMPLOYEE_TEXT_FIELD_CONFIG = [
  { key: 'resourceDesc', labelId: 'employeeDetail.digitalEmployeeDesc' },
  { key: 'ability', labelId: 'employeeDetail.coreAbility' },
  { key: 'constraints', labelId: 'employeeDetail.abilityBoundary' },
  { key: 'faqs', labelId: 'employeeDetail.example' },
  { key: 'processingFlow', labelId: 'employeeDetail.processingFlow' },
  { key: 'personalityDimensions', labelId: 'employeeDetail.personalityDimensions' },
  { key: 'wordPreferences', labelId: 'employeeDetail.wordPreferences' },
  { key: 'sentenceAndTone', labelId: 'employeeDetail.sentenceAndTone' },
  { key: 'corePersonaDefinition', labelId: 'employeeDetail.promptField.corePersonaDefinition' },
  { key: 'coreCompetencies', labelId: 'employeeDetail.coreAbility' },
  { key: 'advancedSettings', labelId: 'employeeDetail.advancedSettings.title' },
];

const getTextLength = (value) => Array.from(`${value ?? ''}`).length;

const getPromptFieldLabelText = (item, isEN) => {
  const defaultName = isEN ? item?.nameEn || item?.name : item?.name || item?.nameEn;
  if (defaultName) return defaultName;
  return item?.key;
};

const parseJsonRecursively = (value, maxDepth = 5) => {
  if (maxDepth <= 0 || typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parseJsonRecursively(parsed, maxDepth - 1) : parsed;
  } catch {
    return value;
  }
};

const getOverLengthPromptField = (corePersonaDefinition, isEN, maxLength = DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH) => {
  if (!corePersonaDefinition) return null;

  try {
    const parsedData = parseJsonRecursively(corePersonaDefinition);
    const promptList = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;
    if (!Array.isArray(promptList)) return null;

    return promptList
      .map((item) => {
        const value = item?.value ?? '';
        return {
          key: item?.key,
          labelText: getPromptFieldLabelText(item, isEN),
          length: getTextLength(value),
          maxLength,
        };
      })
      .find((item) => item.length > item.maxLength);
  } catch {
    return null;
  }
};

const getOverLengthDigitalEmployeeField = (payload, isEN, promptMaxLength = DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH) => {
  const overLengthPromptField = getOverLengthPromptField(payload?.corePersonaDefinition, isEN, promptMaxLength);
  if (overLengthPromptField) {
    return overLengthPromptField;
  }

  return DIGITAL_EMPLOYEE_TEXT_FIELD_CONFIG.filter((item) => item.key !== 'corePersonaDefinition')
    .map((item) => ({
      ...item,
      length: getTextLength(payload?.[item.key]),
      maxLength: item.maxLength || promptMaxLength || DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH,
    }))
    .find((item) => item.length > item.maxLength);
};

export const skillHandler = (it) => {
  const resourceType = it.grantResourceType || it.resourceBizType;
  const p = {
    ...it,
    resourceId: it.resourceId || it.id,
    resourceName: it.resourceName || it.name,
    grantResourceType: resourceType,
    description: it.description ?? it.resourceDesc ?? it.remark ?? '',
  };

  if (['VIEW', 'OBJECT'].includes(resourceType)) {
    if (it.relResourceInfo) {
      try {
        const relResourceInfo = JSON.parse(it.relResourceInfo);
        Object.assign(p, {
          activeResourceIds: (relResourceInfo?.activeResourceIds || []).map((s) => `${s}`),
        });
      } catch (e) {
        console.error(e);
      }
    }
  }

  return p;
};

const normalizeOntologyResourceForEdit = (item, fallbackOwnerType) =>
  normalizeOntologyResource(item, fallbackOwnerType);

const isOntologyResource = (item) =>
  ['VIEW', 'OBJECT'].includes(`${item?.grantResourceType || item?.resourceBizType || ''}`.toUpperCase());

const parseBundledSkills = (value) => {
  const normalizeBundledSkillItems = (items = []) =>
    items
      .map((item) => {
        if (typeof item === 'string') {
          const skillCode = item.trim();
          return skillCode ? { skillCode } : null;
        }

        const resourceId = item?.resourceId || item?.skillId || item?.id;
        const skillCode =
          item?.skillCode || item?.resourceCode || item?.value || item?.code || item?.resourceId || item?.id;
        const normalized = {
          resourceId,
          skillCode: `${skillCode || ''}`.trim(),
          skillType: item?.skillType,
          skillUrl: item?.skillUrl,
          versionUrl: item?.versionUrl,
        };
        Object.keys(normalized).forEach((key) => {
          if (normalized[key] === undefined || normalized[key] === null || normalized[key] === '') {
            delete normalized[key];
          }
        });
        return normalized.skillCode || normalized.resourceId ? normalized : null;
      })
      .filter(Boolean);

  if (Array.isArray(value)) {
    return normalizeBundledSkillItems(value);
  }
  if (typeof value !== 'string' || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeBundledSkillItems(parsed) : [];
  } catch {
    return normalizeBundledSkillItems(value.split(','));
  }
};

const parseDigitalEmployeeTemplates = (value) => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
  return [value];
};

const normalizePromptConfigKey = (key, item = {}) => {
  const candidates = [key, item?.name, item?.nameEn, item?.paramName, item?.paramEnName].filter(Boolean);
  if (candidates.some((value) => ['agent', '工作规范', 'Work Specification'].includes(value))) {
    return 'agent';
  }
  if (
    candidates.some((value) =>
      ['persona', 'soul', 'corePersonaDefinition', '人格定义', 'Persona', 'Personality Definition'].includes(value)
    )
  ) {
    return 'soul';
  }
  if (candidates.some((value) => ['tool', 'tools', '工具规范', 'Tool Specification'].includes(value))) {
    return 'tools';
  }
  if (candidates.some((value) => ['memory', '记忆规范', 'Memory Specification'].includes(value))) {
    return 'memory';
  }
  return key;
};

const getPromptDefinitionWithFormValues = (corePersonaDefinition, form) => {
  if (!corePersonaDefinition) return '';

  try {
    const parsedData = parseJsonRecursively(corePersonaDefinition);
    const promptList = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;
    if (!Array.isArray(promptList)) return corePersonaDefinition;

    return JSON.stringify(
      promptList.map((item) => {
        const key = normalizePromptConfigKey(item?.key, item);
        const formValue = form.getFieldValue(key);
        return {
          ...item,
          key,
          value: formValue === undefined ? item?.value || '' : formValue || '',
        };
      })
    );
  } catch {
    return corePersonaDefinition;
  }
};

const extractPromptFieldsFromCorePersonaDefinition = (value) => {
  const systemFieldValues = {};
  const customPromptTabs = [];
  const customPromptValues = {};
  const systemFields = new Set([
    'agent',
    'soul',
    'tools',
    'memory',
    'questionRewrite',
    'questionDecomposition',
    'singleSummary',
    'multipleSummary',
    'comprehensiveAnswer',
    'corePersonaDefinition',
    'workStandard',
    'toolStandard',
    'memoryStandard',
  ]);

  if (!value) {
    return { systemFieldValues, customPromptTabs, customPromptValues };
  }

  try {
    const parsedData = parseJsonRecursively(value);
    const corePersonaData = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;

    if (Array.isArray(corePersonaData)) {
      corePersonaData.forEach((item) => {
        if (!item?.key) return;

        const key = normalizePromptConfigKey(item.key, item);
        const normalizedValue = parseJsonRecursively(item.value || '');
        const fieldValue =
          typeof normalizedValue === 'string' ? normalizedValue : JSON.stringify(normalizedValue || '');

        if (systemFields.has(key)) {
          systemFieldValues[key] = fieldValue;
          return;
        }

        if (fieldValue) {
          customPromptTabs.push({
            key,
            name: item.name || key,
          });
          customPromptValues[key] = fieldValue;
        }
      });
    } else if (corePersonaData && typeof corePersonaData === 'object') {
      Object.keys(corePersonaData).forEach((rawKey) => {
        const key = normalizePromptConfigKey(rawKey);
        const normalizedValue = parseJsonRecursively(corePersonaData[rawKey]);
        const fieldValue =
          typeof normalizedValue === 'string' ? normalizedValue : JSON.stringify(normalizedValue || '');

        if (systemFields.has(key)) {
          systemFieldValues[key] = fieldValue;
          return;
        }

        if (fieldValue) {
          customPromptTabs.push({
            key,
            name: key,
          });
          customPromptValues[key] = fieldValue;
        }
      });
    }
  } catch {
    return { systemFieldValues, customPromptTabs, customPromptValues };
  }

  return { systemFieldValues, customPromptTabs, customPromptValues };
};

const parseMaybeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getDigitalEmployeeTemplate = (templates, ownerType, agentType) => {
  const effectiveOwnerType = ownerType === 'personal' ? 'personal' : 'enterprise';
  const findTemplate = (list) =>
    list.find((item) => item?.ownerType === effectiveOwnerType && item?.agentType === agentType) ||
    list.find((item) => item?.ownerType === effectiveOwnerType);

  return findTemplate(templates) || {};
};

const getDigitalEmployeeTemplateMaxLength = (templates, ownerType, agentType) => {
  const list = Array.isArray(templates) ? templates : [];
  const effectiveOwnerType =
    String(ownerType || '')
      .trim()
      .toLowerCase() === 'personal'
      ? 'personal'
      : 'enterprise';
  const effectiveAgentType = agentType === undefined || agentType === null ? '' : String(agentType).trim();
  const matchedTemplate = list.find(
    (item) =>
      String(item?.ownerType || '')
        .trim()
        .toLowerCase() === effectiveOwnerType && String(item?.agentType ?? '').trim() === effectiveAgentType
  );

  const maxLength = Number(matchedTemplate?.maxLength);
  return Number.isFinite(maxLength) && maxLength > 0 ? maxLength : DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH;
};

const EmployeeDetail = ({ loading }) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const { state, search } = useLocation();
  // React Router 6 无稳定的 location.query，须从 search 解析（与地址栏 ?appId= 一致）
  const query = useMemo(() => {
    const o = {};
    if (!search || search === '?') {
      return o;
    }
    const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    sp.forEach((value, key) => {
      o[key] = value;
    });
    return o;
  }, [search]);

  const {
    uuid,
    appId,
    digitalType = 'FROM_MANUALLY',
    resourceName: oldResourseName,
    resourceDesc: oldResourceDesc,
    ownerType,
    catalogId: queryCatalogId,
    agentType: queryAgentType,
    agentDevType: queryAgentDevType,
    isFrontAccess: _isFrontAccess = 'false',
    readOnly: _readOnly = 'false',
    log: _log = 'true',
    manage: _manage = 'true',
    config: _config = 'true',
    operation: _operation = 'false',
    defaultTab,
  } = query || {};

  // 与当前地址栏 ?appId= 保持一致（首屏 query 可能滞后时由 effect 补全）
  const [agentId, setAgentId] = useState(() =>
    appId !== undefined && appId !== null && `${appId}` !== '' ? String(appId) : undefined
  );

  const local = getLocale();
  const isEN = React.useMemo(() => {
    return local.includes('en');
  }, [local]);

  useEffect(() => {
    if (appId !== undefined && appId !== null && `${appId}` !== '') {
      setAgentId(String(appId));
    }
  }, [appId]);

  const { agentType: agentTypeFromState, systemCode, param = {} } = state || {};
  const routeAgentType = queryAgentType || agentTypeFromState;
  // query 作为兜底来源：避免 state 丢失导致回落到默认 '001'
  const agentType = routeAgentType || '001';
  const agentDevType = useRef(queryAgentDevType || 'byai');

  const isFrontAccess = _isFrontAccess === 'true';
  const showLog = _log === 'true';
  const readOnly = _readOnly === 'true';
  const showManage = _manage === 'true';
  const showConfig = _config === 'true';
  const showOperation = _operation === 'true';

  const [form] = Form.useForm();

  // 新建场景：根据 URL query 覆盖 ConfigForm 默认值
  useEffect(() => {
    if (agentId) return; // 编辑场景：由详情接口回填
    form.setFieldsValue({
      ownerType,
      catalogId: queryCatalogId ? Number(queryCatalogId) || queryCatalogId : undefined,
      agentType,
    });
  }, [agentId, ownerType, queryCatalogId, agentType, form]);
  const agentName = Form.useWatch('resourceName', form);
  const ask = Form.useWatch('descText', form);
  const watchedOwnerType = Form.useWatch('ownerType', { form, preserve: true });
  const effectiveOwnerType = watchedOwnerType || ownerType;
  const homeType = Form.useWatch('homeType', { form, preserve: true });
  const agentHomeUrl = Form.useWatch('agentHomeUrl', { form, preserve: true });

  const [log, setLog] = useState();
  const [questionList, setQuestionList] = useState([]);
  const [updateTime, setUpdateTime] = useState();
  const [modelName, setModelName] = useState();
  const [modelList, setModelList] = useState([]);
  const [avatar, setAvatar] = useState('');
  const [refineModalOpen, setRefineModalOpen] = useState(false);

  const [modalState, modalAction] = useShowModal();
  const [baseListState, baseListAction] = useShowModal();
  const [baseListType, setBaseListType] = useState('006');

  const [lastAvatar, setLastAvatar] = useState();

  const [title, setTitle] = useState('');

  const iframeRef = useRef(null);
  const [debugPage, setDebugPage] = useState('');
  const [isConfigChanged, setIsConfigChanged] = useState(false);

  // 当前选中的导航标签
  const [activeTab, setActiveTab] = useState(() => {
    // 优先判断 defaultTab 参数
    if (defaultTab === 'log') {
      return 'log';
    }
    // 其次判断 showOperation
    if (showOperation) {
      return 'operation';
    }
    // 默认返回 config
    return 'config';
  });

  const [detailAgentType, setDetailAgentType] = useState();
  const [detailCreateType, setDetailCreateType] = useState();
  const [resourceStatus, setResourceStatus] = useState();
  const [promptFieldMaxLength, setPromptFieldMaxLength] = useState(DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH);

  const effectiveDigitalType = agentId ? detailCreateType || digitalType : digitalType;

  // 设置标题：优先使用 agentName，如果没有则使用 oldResourseName
  useEffect(() => {
    if (agentName) {
      setTitle(agentName);
    } else if (oldResourseName) {
      setTitle(oldResourseName);
    }
  }, [agentName, oldResourseName]);

  // 根据URL参数defaultTab设置activeTab
  useEffect(() => {
    if (defaultTab === 'log') {
      setActiveTab('log');
    }
  }, [defaultTab]);

  // 根据URL参数设置activeTab
  useEffect(() => {
    // 如果 defaultTab 已设置为 log，则不覆盖
    if (defaultTab === 'log') {
      return;
    }
    if (showOperation) {
      // 只有当resourceStatus为2（已上架）时才显示operation标签
      if (resourceStatus === 2) {
        setActiveTab('operation');
      } else if (resourceStatus !== undefined) {
        // 如果resourceStatus已加载但不是2，则回退到config
        setActiveTab('config');
      }
    }
  }, [showOperation, resourceStatus, defaultTab]);

  // 监听 homeType 和 agentHomeUrl 变化，更新 debugPage
  useEffect(() => {
    if (agentId && homeType !== undefined) {
      let url;
      if (homeType === 'custom' && agentHomeUrl) {
        url = agentHomeUrlHandler(
          {
            agentHomeUrl,
            id: agentId,
            resourceCode: '',
          },
          '',
          agentHomeUrl
        );
      } else {
        url = `${PREVIEW_HOST}iframes/employee?canCleanSession=1&agentId=${agentId}`;
      }
      setDebugPage(url);
    }
  }, [homeType, agentHomeUrl, agentId]);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  // 合规校验错误提示状态
  const [auditErrors, setAuditErrors] = useState({});
  const [issues, setIssues] = useState([]);

  const [selectedTools, setSelectedTools] = useState([]);
  const [savedRelOntology, setSavedRelOntology] = useState([]);
  const [selectedOntologyResources, setSelectedOntologyResources] = useState([]);
  const [ontologyResourcesDirty, setOntologyResourcesDirty] = useState(false);
  const [ontologyDrawerOpen, setOntologyDrawerOpen] = useState(false);
  const [coreCompetenciesState, setCoreCompetenciesState] = useState([]);
  const [memoryRules, setMemoryRules] = useState([]);

  /** 机器人渠道配置：钉钉 / 飞书 / 企微等，随保存提交 machineChannel(JSON) */
  const [robotConfigs, setRobotConfigs] = useState([]);
  // 知识库数据状态
  const [knowledgeBases, setKnowledgeBases] = useState([
    {
      id: 'KG_DOC',
      title: intl.formatMessage({ id: 'employeeDetail.documentKnowledge' }),
      count: 0,
      expanded: true,
      items: [],
    },
    {
      id: 'KG_QA',
      title: intl.formatMessage({ id: 'employeeDetail.qaKnowledge' }),
      count: 0,
      expanded: true,
      items: [],
    },
  ]);

  const [managementAddresses, setManagementAddresses] = useState([]);

  const resultDataRef = useRef(null);
  const prologueRef = useRef(null);

  // 预设的标签选项
  const [tagOptions, setTagOptions] = useState([]);

  const [projectList, setProjectList] = useState([]);
  const [accessTerminalList, setAccessTerminalList] = useState([]);
  const [contentFeedbackType, setContentFeedbackType] = useState([]);
  const [terminalTypeList, setTerminalTypeList] = useState([]);

  const effectiveAgentType = useMemo(() => {
    // 编辑场景以接口返回的 detailAgentType 为准：避免保存时回落默认 '001'
    if (agentId) return detailAgentType || routeAgentType;

    if (effectiveDigitalType === 'FROM_MANUALLY') return agentType;

    return null;
  }, [agentId, effectiveDigitalType, detailAgentType, routeAgentType, agentType]);

  const prevRoutePath = useMemo(() => {
    let prevRoute = sessionStorage.getItem('EmployeeDetail_prevRoute');
    if (prevRoute) {
      try {
        const base = (window.routerBase || '/').replace(/\/$/, '');
        // 支持传入完整 URL 的情况
        try {
          const u = new URL(prevRoute, window.location.origin);
          prevRoute = `${u.pathname}${u.search}${u.hash}`;
        } catch (e) {}
        if (prevRoute.startsWith(base)) {
          prevRoute = prevRoute.slice(base.length) || '/';
        }
        if (!prevRoute.startsWith('/')) {
          prevRoute = `/${prevRoute}`;
        }
      } catch (e) {}

      return prevRoute;
    }

    return '';
  }, []);

  useEffect(() => {
    dispatch({
      type: 'conversationMgr/getProject',
      success: (res) => {
        setProjectList(
          (res || [])?.map((it) => ({
            label: it.paramName,
            value: it.paramValue,
          }))
        );
      },
    });
    dispatch({
      type: 'conversationMgr/getAccessTerminal',
      success: (res) => {
        setAccessTerminalList(
          (res || [])?.map((it) => ({
            label: it.paramName,
            value: it.paramValue,
          }))
        );
      },
    });
    dispatch({
      type: 'conversationMgr/getContentFeedbackType',
      success: (res) => {
        const { QUESTION = [], EFFECT = [], REPORT = [] } = res || {};
        setContentFeedbackType(
          [...QUESTION, ...EFFECT, ...REPORT].map((it) => ({
            label: it.paramName,
            value: it.paramValue,
          }))
        );
      },
    });
    // 获取数字员工查询终端类型列表
    dispatch({
      type: 'session/getDcSystemConfigListByStandType',
      payload: { standType: 'TERMINAL' },
    }).then((res) => {
      if (res && res.code === 0) {
        const { data: resData } = res;
        setTerminalTypeList(
          resData.map((item) => ({
            label: isEN ? item.paramEnName : item.paramName,
            value: item.paramValue,
          }))
        );
      }
    });
  }, []);

  const agentTypeFormValue = Form.useWatch('agentType', form);

  useEffect(() => {
    form.setFieldsValue({
      resourceName: oldResourseName,
      resourceDesc: oldResourceDesc,
      agentSseUrlOri: getValidValue(param?.agentSseUrlOri),
      agentWebUrlOri: getValidValue(param?.agentWebUrlOri),
    });
  }, [oldResourseName, oldResourceDesc]);

  const getCompositeAppInfo = useCallback(
    (type, callback) => {
      dispatch({
        type: 'employeeMgr/getCompositeAppInfo',
        payload: { resourceId: agentId },
        success: (res) => {
          const {
            resourceName,
            resourceDesc,
            avatar: avatarUrl,
            param,
            recommendPrompt,
            tags: tagsList,
            integrationType,
            prologue,
            relResourceList,
            homeType,
            authType,
            agentHomeUrl,
            agentSseUrlOri,
            agentWebUrlOri,
            agentAdminUrlOriList,
            ownerType: detailOwnerType,
            agentType: detailAgentType,
            createType,
            terminal,
            memoryConfigList,
            advancedSettings: advancedSettingsRaw,
            coreCompetencies: coreCompetenciesRaw,
            machineChannel: machineChannelRaw,
            robotChannelConfigList: robotChannelConfigListRaw,
            catalogId,
            relTools,
            relOntology,
          } = res || {};

          // debugger;
          const {} = param || {};
          agentDevType.current = res?.agentDevType;

          let url;
          if (homeType === 'custom') {
            url = getIframeUrl(agentHomeUrl);
          } else {
            url = `${PREVIEW_HOST}iframes/employee?canCleanSession=1&agentId=${res.resourceId}`;
          }
          setDebugPage(url);

          const { prompt } = recommendPrompt || {};
          try {
            const prologueTemp = JSON.parse(prologue || '{}');
            const agentAdminUrlOriListTemp = JSON.parse(agentAdminUrlOriList || '{}');
            const { openingQuestion, descText, modelInfo } = prologueTemp || {};
            const { authParams, urlList } = agentAdminUrlOriListTemp || {};
            let prologueRoleJson = {};
            try {
              if (typeof prologueTemp?.role === 'string') {
                prologueRoleJson = JSON.parse(prologueTemp.role || '{}');
              } else if (prologueTemp?.role && typeof prologueTemp.role === 'object') {
                prologueRoleJson = prologueTemp.role;
              }
            } catch {
              prologueRoleJson = {};
            }
            setQuestionList((prevList) => {
              if (isEmpty(openingQuestion)) {
                return prevList;
              }

              let list = openingQuestion || [];
              try {
                if (isString(openingQuestion)) {
                  list = JSON.parse(openingQuestion);
                }
              } catch (error) {
                console.error('parse openingQuestion error', error);
                list = [];
              }

              return list.map((it) => ({ infoTitle: it }));
            });
            if (avatarUrl) {
              let myAvatarUrl = avatarUrl;
              if (!myAvatarUrl) {
                if (detailAgentType === '002') {
                  myAvatarUrl = 'beyond/avatar/headChatBI.png';
                }
                if (detailAgentType === '003') {
                  myAvatarUrl = 'beyond/avatar/headWrite.png';
                }
              }

              setAvatar(myAvatarUrl);
              setLastAvatar(myAvatarUrl);
            }
            if (modelInfo) {
              setModelName(modelInfo?.model ?? '');
            }
            let tags = [];
            try {
              tags = JSON.parse(tagsList || '[]') || [];
            } catch (error) {
              console.warn('tagsList parse error', error);
            }
            setTagOptions(tags?.map((it) => ({ label: it, value: it })));
            const relOntologyRows = parseMaybeArray(relOntology)
              .map((item) => normalizeOntologyResourceForEdit(item, detailOwnerType || ownerType))
              .filter(isOntologyResource);
            const relOntologyResources = (relResourceList || [])
              .map((item) => normalizeOntologyResourceForEdit(item, detailOwnerType || ownerType))
              .filter(isOntologyResource);
            const nextOntologyResources = relOntologyResources.length > 0 ? relOntologyResources : relOntologyRows;
            setSelectedOntologyResources(nextOntologyResources);
            setSavedRelOntology(nextOntologyResources);
            setOntologyResourcesDirty(false);

            let myHomeType = homeType;
            if (homeType === intl.formatMessage({ id: 'thirdPartyCreateModel.defaultTemplate' })) {
              myHomeType = 'default';
            } else if (homeType === intl.formatMessage({ id: 'thirdPartyCreateModel.customTemplate' })) {
              myHomeType = 'custom';
            }

            let myAuthType = authType;
            if (authType === intl.formatMessage({ id: 'thirdPartyCreateModel.sessionShared' })) {
              myAuthType = 'session';
            } else if (authType === intl.formatMessage({ id: 'thirdPartyCreateModel.oauth2Auth' })) {
              myAuthType = 'oauth2';
            }

            // 将接口返回的新增字段组装进 abilityDesc 与 role，便于表单回显
            const abilityDescJson = JSON.stringify({
              ability: res?.ability || '',
              constraints: res?.constraints || '',
              faqs: res?.faqs || '',
            });

            // 从 corePersonaDefinition 中解析自定义 tab 和值（支持数组格式：[{name, key, value}, ...]）
            const corePersonaDefinitionValue = res?.corePersonaDefinition || res?.personalityDefinition || '';
            const {
              systemFieldValues: promptFieldValuesFromCore,
              customPromptTabs: customPromptTabsFromCore,
              customPromptValues: customPromptValuesFromCore,
            } = extractPromptFieldsFromCorePersonaDefinition(corePersonaDefinitionValue);
            const promptWorkStandard = promptFieldValuesFromCore.agent || promptFieldValuesFromCore.workStandard || '';
            const effectiveWorkStandard = promptWorkStandard || res?.workStandard || res?.roleAttributes || '';

            const roleJson = JSON.stringify({
              processingFlow: res?.processingFlow || '',
              personalityDimensions: res?.personalityDimensions || '',
              wordPreferences: res?.wordPreferences || '',
              sentenceAndTone: res?.sentenceAndTone || '',
              bundledSkills: parseBundledSkills(res?.skills || res?.bundledSkills || prologueRoleJson?.bundledSkills),
              agent: promptFieldValuesFromCore.agent || effectiveWorkStandard,
              soul: promptFieldValuesFromCore.soul || '',
              tools: res?.toolStandard || promptFieldValuesFromCore.tools || '',
              memory: res?.memoryStandard || promptFieldValuesFromCore.memory || '',
              workStandard: effectiveWorkStandard,
              corePersonaDefinition:
                res?.corePersonaDefinition || res?.personalityDefinition || DEFAULT_PERSONALITY_DEFINITION,
              personalityDefinition:
                res?.corePersonaDefinition || res?.personalityDefinition || DEFAULT_PERSONALITY_DEFINITION,
              toolStandard: res?.toolStandard || promptFieldValuesFromCore.tools || '',
              memoryStandard: res?.memoryStandard || promptFieldValuesFromCore.memory || '',
              questionRewrite: res?.questionRewrite || promptFieldValuesFromCore.questionRewrite || '',
              questionDecomposition:
                res?.questionDecomposition || promptFieldValuesFromCore.questionDecomposition || '',
              singleSummary: res?.singleSummary || promptFieldValuesFromCore.singleSummary || '',
              multipleSummary: res?.multipleSummary || promptFieldValuesFromCore.multipleSummary || '',
              comprehensiveAnswer: res?.comprehensiveAnswer || promptFieldValuesFromCore.comprehensiveAnswer || '',
              customPromptTabs:
                customPromptTabsFromCore.length > 0
                  ? customPromptTabsFromCore
                  : prologueRoleJson?.customPromptTabs || [],
              customPromptValues:
                Object.keys(customPromptValuesFromCore).length > 0
                  ? customPromptValuesFromCore
                  : prologueRoleJson?.customPromptValues || {},
            });

            // 解析核心能力列表（coreCompetencies）用于回显和保存
            let coreCompetenciesParsed = [];
            try {
              if (typeof coreCompetenciesRaw === 'string') {
                coreCompetenciesParsed = JSON.parse(coreCompetenciesRaw || '[]') || [];
              } else if (Array.isArray(coreCompetenciesRaw)) {
                coreCompetenciesParsed = coreCompetenciesRaw;
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('parse coreCompetencies error', e);
              coreCompetenciesParsed = [];
            }
            // 存到本地 state，提供给 ConfigForm 做回显
            setCoreCompetenciesState(coreCompetenciesParsed);
            // 解析高级配置（advancedSettings）用于回显
            let advancedSettingsParsed = [];
            try {
              if (typeof advancedSettingsRaw === 'string') {
                advancedSettingsParsed = JSON.parse(advancedSettingsRaw || '[]') || [];
              } else if (Array.isArray(advancedSettingsRaw)) {
                advancedSettingsParsed = advancedSettingsRaw;
              }
            } catch (e) {
              console.error('parse advancedSettings error', e);
              advancedSettingsParsed = [];
            }
            // 设置标题
            if (resourceName) {
              setTitle(resourceName);
            }
            form.setFieldsValue({
              resourceName,
              resourceDesc,
              descText,
              prompt,
              abilityDesc: abilityDescJson,
              role: roleJson,
              tags,
              homeType: myHomeType,
              agentHomeUrl,
              agentSseUrlOri,
              agentWebUrlOri,
              authType: myAuthType,
              appKey: authParams?.appKey,
              secret: authParams?.secret,
              integrationType,
              terminal: terminal || undefined,
              catalogId: catalogId === -1 ? undefined : catalogId,
              ownerType: detailOwnerType || ownerType,
              agentType: detailAgentType || routeAgentType || agentType,
              advancedSettings: advancedSettingsParsed,
              // 为受控的必填项提供初始值以回显
              coreAbility: res?.ability || '',
              abilityBoundary: res?.constraints || '',
              exampleQuestions: res?.faqs || '',
              // 为工作规范五项提供初始值以回显
              processingFlow: res?.processingFlow || '',
              personalityDimensions: res?.personalityDimensions || '',
              wordPreferences: res?.wordPreferences || '',
              sentenceAndTone: res?.sentenceAndTone || '',
              bundledSkills: parseBundledSkills(res?.skills || res?.bundledSkills || prologueRoleJson?.bundledSkills),
              agent: promptFieldValuesFromCore.agent || effectiveWorkStandard,
              soul: promptFieldValuesFromCore.soul || '',
              tools: res?.toolStandard || promptFieldValuesFromCore.tools || '',
              memory: res?.memoryStandard || promptFieldValuesFromCore.memory || '',
              workStandard: effectiveWorkStandard,
              corePersonaDefinition:
                res?.corePersonaDefinition || res?.personalityDefinition || DEFAULT_PERSONALITY_DEFINITION,
              toolStandard: res?.toolStandard || promptFieldValuesFromCore.tools || '',
              memoryStandard: res?.memoryStandard || promptFieldValuesFromCore.memory || '',
              questionRewrite: res?.questionRewrite || promptFieldValuesFromCore.questionRewrite || '',
              questionDecomposition:
                res?.questionDecomposition || promptFieldValuesFromCore.questionDecomposition || '',
              singleSummary: res?.singleSummary || promptFieldValuesFromCore.singleSummary || '',
              multipleSummary: res?.multipleSummary || promptFieldValuesFromCore.multipleSummary || '',
              comprehensiveAnswer: res?.comprehensiveAnswer || promptFieldValuesFromCore.comprehensiveAnswer || '',
              customPromptTabs:
                customPromptTabsFromCore.length > 0
                  ? customPromptTabsFromCore
                  : prologueRoleJson?.customPromptTabs || [],
              customPromptValues:
                Object.keys(customPromptValuesFromCore).length > 0
                  ? customPromptValuesFromCore
                  : prologueRoleJson?.customPromptValues || {},
            });

            setManagementAddresses(urlList ?? []);

            // 处理配置记忆数据回显
            if (memoryConfigList && Array.isArray(memoryConfigList) && memoryConfigList.length > 0) {
              const memoryRulesData = memoryConfigList.map((item) => ({
                id: item.templateId,
                ruleName: item.ruleName,
                ruleContent: item.ruleContent,
                templateId: item.templateId,
                icon: 'icon-zhishiku2',
              }));
              setMemoryRules(memoryRulesData);
            } else {
              setMemoryRules([]);
            }

            // 配置机器人回显
            try {
              const inferFirstChannel = () => {
                try {
                  const parsed =
                    typeof robotChannelConfigListRaw === 'string'
                      ? JSON.parse(robotChannelConfigListRaw)
                      : robotChannelConfigListRaw;
                  return Array.isArray(parsed) ? parsed?.[0]?.channel : undefined;
                } catch {
                  return undefined;
                }
              };

              const inferredChannel = inferFirstChannel() || 'DINGTALK';

              let robotList: any[] = [];

              // 新格式：machineChannel 为数组
              // 数组：[{"channel":"DingTalk","clientId":"...","clientSecret":"...","robotCode":"...","appId":"..."}, {...}]
              if (typeof machineChannelRaw === 'string' && machineChannelRaw) {
                const parsed = JSON.parse(machineChannelRaw);
                if (Array.isArray(parsed)) {
                  robotList = parsed;
                } else if (parsed && typeof parsed === 'object') {
                  const hasMachineChannelKeys =
                    Object.prototype.hasOwnProperty.call(parsed, 'clientId') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'clientSecret') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'robotCode') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'AICardId') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'appId') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'appSecret') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'verificationToken') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'encryptKey') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'botId') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'secret') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'agentId') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'corpId') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'corpSecret') ||
                    false;

                  if (hasMachineChannelKeys) {
                    robotList = [
                      {
                        channel: parsed?.channel ?? inferredChannel,
                        clientId: parsed?.clientId ?? '',
                        clientSecret: parsed?.clientSecret ?? '',
                        robotCode: parsed?.robotCode ?? '',
                        AICardId: parsed?.AICardId ?? '',
                        appId: parsed?.appId ?? '',
                        appSecret: parsed?.appSecret ?? '',
                        verificationToken: parsed?.verificationToken ?? '',
                        encryptKey: parsed?.encryptKey ?? '',
                        botId: parsed?.botId ?? '',
                        secret: parsed?.secret ?? '',
                        agentId: parsed?.agentId ?? '',
                        corpId: parsed?.corpId ?? '',
                        corpSecret: parsed?.corpSecret ?? '',
                      },
                    ];
                  }
                }
              } else if (machineChannelRaw && typeof machineChannelRaw === 'object') {
                if (Array.isArray(machineChannelRaw)) {
                  robotList = machineChannelRaw;
                } else {
                  const hasMachineChannelKeys =
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'clientId') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'clientSecret') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'robotCode') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'AICardId') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'appId') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'appSecret') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'verificationToken') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'encryptKey') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'botId') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'secret') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'agentId') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'corpId') ||
                    Object.prototype.hasOwnProperty.call(machineChannelRaw, 'corpSecret') ||
                    false;

                  if (hasMachineChannelKeys) {
                    robotList = [
                      {
                        channel: machineChannelRaw?.channel ?? inferredChannel,
                        clientId: machineChannelRaw?.clientId ?? '',
                        clientSecret: machineChannelRaw?.clientSecret ?? '',
                        robotCode: machineChannelRaw?.robotCode ?? '',
                        AICardId: machineChannelRaw?.AICardId ?? '',
                        appId: machineChannelRaw?.appId ?? '',
                        appSecret: machineChannelRaw?.appSecret ?? '',
                        verificationToken: machineChannelRaw?.verificationToken ?? '',
                        encryptKey: machineChannelRaw?.encryptKey ?? '',
                        botId: machineChannelRaw?.botId ?? '',
                        secret: machineChannelRaw?.secret ?? '',
                        agentId: machineChannelRaw?.agentId ?? '',
                        corpId: machineChannelRaw?.corpId ?? '',
                        corpSecret: machineChannelRaw?.corpSecret ?? '',
                      },
                    ];
                  }
                }
              }

              // 新格式要求必须有渠道（channel），不再兼容 robotChannelConfigList 旧字段
              if (Array.isArray(robotList) && robotList.length > 0) {
                setRobotConfigs(robotList.map((item) => normalizeRobotConfig(item)).filter((it) => it.channel));
              } else {
                setRobotConfigs([]);
              }
            } catch (e) {
              console.error('parse robotChannelConfigList error', e);
              setRobotConfigs([]);
            }

            if (detailAgentType) {
              setDetailAgentType(detailAgentType);
            }
            if (createType) {
              setDetailCreateType(createType);
            }

            if (type === 'reload') {
              setUpdateTime(dayjs().format('HH:mm:ss'));
            }
            resultDataRef.current = { ...res, appId: agentId };
            setResourceStatus(res?.resourceStatus);
            prologueRef.current = prologueTemp;
            const relResourceSkills = (relResourceList || [])
              .filter((it) => ['AGENT', 'TOOLKIT', 'TOOL', 'MCP'].includes(it.grantResourceType || it.resourceBizType))
              .map(skillHandler);
            const relToolSkills = (Array.isArray(relTools) ? relTools : [])
              .filter(Boolean)
              .map((toolCode) => ({
                resourceId: toolCode,
                resourceName: toolCode === '*' ? '全部工具' : toolCode,
                grantResourceType: 'TOOLKIT',
                description: '',
                relTools: toolCode,
              }))
              .filter((tool) => !relResourceSkills.some((skill) => `${skill.resourceId}` === `${tool.resourceId}`));

            if (relResourceSkills.length > 0 || relToolSkills.length > 0) {
              setSelectedTools([...relResourceSkills, ...relToolSkills]);
            }
            if (relResourceList?.length > 0) {
              setKnowledgeBases(
                knowledgeBases.map((it) => ({
                  ...it,
                  items: relResourceList
                    .filter((i) => (i.grantResourceType || i.resourceBizType) === it.id)
                    .map((rel) => ({
                      ...rel,
                      grantResourceType: rel.grantResourceType || rel.resourceBizType || it.id,
                      description: rel.description ?? rel.resourceDesc ?? rel.remark ?? '',
                    })),
                }))
              );
            }
            callback?.(prologueTemp);
          } catch (error) {
            console.error(error);
          }
        },
      });
    },
    [dispatch, form, resultDataRef, prologueRef, knowledgeBases, agentId]
  );

  const fetchDefaultTemplate = useCallback(async () => {
    const applyTemplate = (templates = []) => {
      const templateConfig = getDigitalEmployeeTemplate(templates, effectiveOwnerType, effectiveAgentType || agentType);
      const nextMaxLength = getDigitalEmployeeTemplateMaxLength(
        templates,
        effectiveOwnerType,
        effectiveAgentType || agentType
      );
      setPromptFieldMaxLength(nextMaxLength);
      const relSkills = Array.isArray(templateConfig?.relSkills) ? templateConfig.relSkills : [];
      const relTools = Array.isArray(templateConfig?.relTools) ? templateConfig.relTools : [];

      if (relSkills.length > 0) {
        form.setFieldsValue({ bundledSkills: relSkills });

        let roleObj = {};
        const roleStr = form.getFieldValue('role') || '{}';
        try {
          roleObj = JSON.parse(roleStr || '{}');
        } catch {
          roleObj = {};
        }
        roleObj.bundledSkills = relSkills;
        form.setFieldsValue({ role: JSON.stringify(roleObj) });
      }

      const defaultSkills = [];
      relTools.forEach((toolCode) => {
        defaultSkills.push({
          resourceId: toolCode,
          resourceName: toolCode === '*' ? '全部工具' : toolCode,
          grantResourceType: 'TOOLKIT',
          description: '',
          relTools: toolCode,
        });
      });

      if (defaultSkills.length > 0) {
        setSelectedTools((prev) => [...prev, ...defaultSkills]);
      }
    };

    try {
      const res = await getDcSystemConfig({ paramCode: 'TEMPLATE_DIGITAL_EMPLOYEE' });
      const templates = parseDigitalEmployeeTemplates(res?.paramValue || res);
      applyTemplate(templates);
    } catch (error) {
      console.error('fetchDefaultTemplate error', error);
      applyTemplate();
    }
  }, [agentType, effectiveAgentType, effectiveOwnerType, form]);

  useEffect(() => {
    let cancelled = false;

    const fetchPromptFieldMaxLength = async () => {
      try {
        const res = await getDcSystemConfig({ paramCode: 'TEMPLATE_DIGITAL_EMPLOYEE' });
        if (cancelled) return;
        const templates = parseDigitalEmployeeTemplates(res?.paramValue || res);
        const nextMaxLength = getDigitalEmployeeTemplateMaxLength(
          templates,
          effectiveOwnerType,
          effectiveAgentType || agentType
        );
        setPromptFieldMaxLength(nextMaxLength);
      } catch {
        if (!cancelled) {
          setPromptFieldMaxLength(DIGITAL_EMPLOYEE_TEXT_FIELD_MAX_LENGTH);
        }
      }
    };

    fetchPromptFieldMaxLength();
    return () => {
      cancelled = true;
    };
  }, [agentType, effectiveAgentType, effectiveOwnerType]);

  useEffect(() => {
    if (agentId) {
      getCompositeAppInfo(undefined, (prologue) => {
        // 获取模型下拉列表、设置配置默认值
        dispatch({
          type: 'employeeMgr/getModelList',
          payload: { tagId: '3' },
          success: (res) => {
            if (!prologue?.modelInfo) {
              setModelName(res?.[0]?.modelName ?? '');
              prologueRef.current.modelInfo = {
                model: res?.[0]?.modelName,
                modelId: res?.[0]?.modelId,
                history: 6,
                temperature: 0.1,
                maxToken: 2000,
              };
            }
            setModelList(res || []);
          },
        });
      });
    } else {
      dispatch({
        type: 'employeeMgr/getModelList',
        payload: { tagId: '3' },
        success: (res) => {
          setModelName(res?.[0]?.modelName ?? '');
          prologueRef.current = {
            modelInfo: {
              model: res?.[0]?.modelName,
              modelId: res?.[0]?.modelId,
              history: 6,
              temperature: 0.1,
              maxToken: 2000,
            },
          };
          setModelList(res || []);
        },
      });

      fetchDefaultTemplate();
    }
  }, [agentId, fetchDefaultTemplate]);

  // 校验核心能力名称必填（依赖 ConfigForm 同步到表单的 coreCompetencies）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const validateCoreCompetencies = () => {
    const list = form.getFieldValue('coreCompetencies') || [];
    const hasEmptyName = list.some((item) => !item?.coreCompetency || !item.coreCompetency.trim());
    if (hasEmptyName) {
      message.error(intl.formatMessage({ id: 'employeeDetail.coreCompetencyNameRequired' }));
      return false;
    }
    return true;
  };

  const updateResource = useCallback(
    debounce(async (params, _isFrontAccess = isFrontAccess) => {
      // 先做核心能力名称校验
      // if (!validateCoreCompetencies()) return;
      let res;
      try {
        res = await form.validateFields();
      } catch (e) {
        // 表单未通过校验时不再抛出未捕获异常，直接中断保存
        return;
      }
      if (res) {
        setSubmitLoading(true);
        const {
          resourceName,
          resourceDesc,
          descText,
          agentWebUrlOri,
          prompt,
          role,
          tags = [],
          homeType,
          agentHomeUrl,
          agentSseUrlOri,
          authType,
          integrationType,
          terminal,
          catalogId,
          ownerType: formOwnerType,
          advancedSettings = [],
        } = res;
        const queryData = omit(resultDataRef.current || {}, ['roleAttributes', 'relPrompt', 'workStandard']);
        const param = {};

        set(queryData, 'avatar', avatar);
        set(queryData, 'resourceName', resourceName);
        set(queryData, 'resourceDesc', resourceDesc);
        set(param, 'homeType', homeType);
        set(param, 'agentHomeUrl', agentHomeUrl);
        set(param, 'agentSseUrlOri', agentSseUrlOri);
        set(param, 'agentWebUrlOri', agentWebUrlOri);
        set(param, 'authType', authType);
        set(
          param,
          'agentAdminUrlOriList',
          JSON.stringify({
            urlList: managementAddresses,
          })
        );
        if (tags.length > 0) {
          set(queryData, 'tags', JSON.stringify(tags));
        }
        const prologue = prologueRef.current || {};

        set(prologue, 'descText', descText);
        set(prologue, 'role', role);

        set(
          prologue,
          'openingQuestion',
          JSON.stringify((params?.questionList ?? questionList)?.map((it) => it.infoTitle))
        );

        set(prologue, 'modelId', prologue?.modelInfo?.modelId);

        const relResourceInfoList = [];
        const relIds = [];
        const relTools = [];
        selectedTools.forEach((it) => {
          if (it.relTools) {
            relTools.push(it.relTools);
          } else {
            relIds.push(`${it.resourceId}`);
          }

          if (['VIEW', 'OBJECT'].includes(it.grantResourceType)) {
            const p = {
              relId: `${it.resourceId}`,
              activeResourceIds: [],
            };
            if (Array.isArray(it.myRelResourceInfo)) {
              p.activeResourceIds = it.myRelResourceInfo
                .filter((it) => it.checkedStatus)
                .map((it) => `${it.resourceId}`);
            } else if (Array.isArray(it.activeResourceIds)) {
              p.activeResourceIds = it.activeResourceIds;
            }

            relResourceInfoList.push(p);
          }
        });
        selectedOntologyResources.forEach((it) => {
          if (it?.resourceId !== undefined && it.resourceId !== null && it.resourceId !== '') {
            relIds.push(`${it.resourceId}`);
          }
        });
        knowledgeBases.forEach((it) => {
          it.items.forEach((i) => {
            relIds.push(`${i.resourceId}`);
          });
        });

        set(param, 'relResourceInfoList', relResourceInfoList);
        set(param, 'createType', effectiveDigitalType);
        if (relTools.length > 0) {
          set(param, 'relTools', relTools);
        }
        set(queryData, 'recommendPrompt.prompt', prompt);
        set(queryData, 'integrationType', integrationType || 'NONE');
        set(param, 'agentDevType', agentDevType.current || 'byai');
        set(param, 'agentType', effectiveAgentType);
        set(param, 'prologue', JSON.stringify(prologue));

        // 从表单中解析新增的7个字段（abilityDesc: ability/constraints/faqs； role: 其余四项）
        let abilityDescJson = {};
        try {
          abilityDescJson = JSON.parse(form.getFieldValue('abilityDesc') || '{}');
        } catch {}
        let roleJson = {};
        try {
          roleJson = JSON.parse(form.getFieldValue('role') || '{}');
        } catch {}
        const currentCorePersonaDefinition = getPromptDefinitionWithFormValues(
          form.getFieldValue('corePersonaDefinition') ||
            roleJson.corePersonaDefinition ||
            roleJson.personalityDefinition ||
            '',
          form
        );
        roleJson.corePersonaDefinition = currentCorePersonaDefinition;
        roleJson.personalityDefinition = currentCorePersonaDefinition;
        form.setFieldsValue({
          role: JSON.stringify(roleJson),
          corePersonaDefinition: currentCorePersonaDefinition,
        });

        // 从表单中读取核心能力列表（结构化）
        const coreCompetencies = form.getFieldValue('coreCompetencies') || [];
        const currentResourceId = queryData.resourceId || agentId;
        const bundledSkills = Array.isArray(roleJson.bundledSkills) ? parseBundledSkills(roleJson.bundledSkills) : [];
        bundledSkills.forEach((skill) => {
          const skillResourceId = skill?.resourceId || skill?.skillId || skill?.id;
          if (skillResourceId) {
            relIds.push(`${skillResourceId}`);
          }
        });
        set(param, 'relIds', Array.from(new Set(relIds)));

        // 创建/更新使用新接口：扁平化参数 + 新增字段
        const flattened = {
          ...queryData,
          ...param,
          // 扁平化：不再传 param
          // 新增字段：
          ability: abilityDescJson.ability || '',
          constraints: abilityDescJson.constraints || '',
          faqs: abilityDescJson.faqs || '',
          processingFlow: roleJson.processingFlow || '',
          personalityDimensions: roleJson.personalityDimensions || '',
          wordPreferences: roleJson.wordPreferences || '',
          sentenceAndTone: roleJson.sentenceAndTone || '',
          skills: bundledSkills,
          relSkills: bundledSkills,
          corePersonaDefinition: roleJson.corePersonaDefinition || roleJson.personalityDefinition || '',
          toolStandard: roleJson.toolStandard || '',
          memoryStandard: roleJson.memoryStandard || '',
          questionRewrite: roleJson.questionRewrite || '',
          questionDecomposition: roleJson.questionDecomposition || '',
          singleSummary: roleJson.singleSummary || '',
          multipleSummary: roleJson.multipleSummary || '',
          comprehensiveAnswer: roleJson.comprehensiveAnswer || '',
          // 核心能力列表（结构化）
          // 接口期望字符串，这里统一转成 JSON 字符串
          coreCompetencies: Array.isArray(coreCompetencies) ? JSON.stringify(coreCompetencies) : JSON.stringify([]),
          // 数字员工查询终端类型
          terminal: terminal || undefined,
          // 数字员工目录分类，对应员工市场分类 tab
          catalogId: catalogId ?? undefined,
          // 归属类型
          ownerType: formOwnerType || effectiveOwnerType,
          // 高级配置（数组 JSON 字符串）
          advancedSettings: JSON.stringify(Array.isArray(advancedSettings) ? advancedSettings : []),
          // 配置记忆列表
          memoryConfigList: memoryRules.map((rule) => ({
            ruleName: rule.ruleName,
            ruleContent: rule.ruleContent,
            templateId: rule.templateId,
          })),
          // 后端字段 machineChannel 期望（示例）：
          // 多渠道：
          // 钉钉 [{"channel":"DingTalk","clientId":"...","clientSecret":"...","robotCode":"...","AICardId":"..."}]
          // 飞书 [{"channel":"Feishu","appId":"...","appSecret":"...","verificationToken":"...","encryptKey":"..."}]
          machineChannel: JSON.stringify(
            (() => {
              if (!Array.isArray(robotConfigs) || robotConfigs.length === 0) {
                return [];
              }
              return robotConfigs;
            })()
          ),
        };
        const overLengthField = getOverLengthDigitalEmployeeField(flattened, isEN, promptFieldMaxLength);
        if (overLengthField) {
          const fieldName = (overLengthField.labelText || intl.formatMessage({ id: overLengthField.labelId })).replace(
            /[:：]\s*$/,
            ''
          );
          message.error(
            intl.formatMessage(
              { id: 'employeeDetail.fieldMaxLength' },
              {
                field: fieldName,
                max: overLengthField.maxLength,
                current: overLengthField.length,
              }
            )
          );
          setSubmitLoading(false);
          setAuditLoading(false);
          return;
        }

        dispatch({
          type: currentResourceId ? 'employeeMgr/updateResource' : 'employeeMgr/createDigitalEmployee',
          payload: currentResourceId
            ? {
                // 编辑：新版接口，参数扁平化并包含新增字段
                ...flattened,
                resourceId: currentResourceId,
                systemCode: effectiveDigitalType === 'FROM_MANUALLY' ? 'BYAI' : systemCode,
                resourceBizType: 'DIG_EMPLOYEE',
                isFrontAccess: _isFrontAccess,
              }
            : {
                // 创建：新版接口，参数扁平化并包含新增字段
                ...flattened,
                systemCode: effectiveDigitalType === 'FROM_MANUALLY' ? 'BYAI' : systemCode,
                resourceBizType: 'DIG_EMPLOYEE',
                isFrontAccess: _isFrontAccess,
              },
          success: async (resp, data) => {
            const savedResourceId = resp?.resourceId || resp?.id || currentResourceId || resp;
            const savedData = resp && typeof resp === 'object' ? resp : {};

            if (savedResourceId) {
              resultDataRef.current = {
                ...queryData,
                ...savedData,
                appId: savedResourceId,
                resourceId: savedResourceId,
              };
            }

            dispatch({
              type: 'employees/updateEmployee',
              payload: {
                employee: agentHandler({
                  ...(currentResourceId ? savedData : data),
                  resourceId: savedResourceId,
                  id: `${savedResourceId || ''}`,
                }),
              },
            });

            EventEmitter?.emit('digitalEmployees-refresh-list', { refresh: true });
            // history.back();

            setSubmitLoading(false);
            setAuditLoading(false);
            setIsConfigChanged(false);
            const savedOntologyResources = selectedOntologyResources
              .map((item) => normalizeOntologyResourceForEdit(item, effectiveOwnerType))
              .filter(isOntologyResource);
            setSelectedOntologyResources(savedOntologyResources);
            setSavedRelOntology(savedOntologyResources);
            setOntologyResourcesDirty(false);

            setUpdateTime(dayjs().format('HH:mm:ss'));

            if (!currentResourceId && savedResourceId) {
              const url = `${PREVIEW_HOST}iframes/employee?canCleanSession=1&agentId=${savedResourceId}`;
              setAgentId(savedResourceId);
              setDebugPage(url);
            }

            setSubmitLoading(false);
            setAuditLoading(false);
            // 刷新调试页面
            if (iframeRef.current) {
              // eslint-disable-next-line no-self-assign
              iframeRef.current.src = iframeRef.current.src;
            }
          },
          fail: (errResp) => {
            setSubmitLoading(false);
            setAuditLoading(false);
            try {
              const issues = Array.isArray(errResp?.issues) ? errResp.issues : [];
              // key 与表单字段的映射关系
              const keyToFieldMap = {
                ability: 'coreAbility',
                constraints: 'abilityBoundary',
                faqs: 'exampleQuestions',
              };
              setIssues(issues);

              // 如果 issues 为空，清空所有错误提示
              if (issues.length === 0) {
                setAuditErrors({});
              } else {
                // issues 不为空时，根据 compliance 设置错误提示
                const errors = {};
                issues.forEach((it) => {
                  const fieldName = keyToFieldMap[it.key];
                  if (fieldName && it.compliance === false) {
                    errors[fieldName] = it.reason || intl.formatMessage({ id: 'employeeDetail.notCompliant' });
                  }
                });
                setAuditErrors(errors);
              }
            } catch {}
          },
        });
        // 展示合规校验全屏 Loading（在 effects 内会先进行合规校验）
        setAuditLoading(true);
      }
    }, 400),
    [
      dispatch,
      resultDataRef,
      prologueRef,
      form,
      questionList,
      selectedTools,
      selectedOntologyResources,
      knowledgeBases,
      avatar,
      managementAddresses,
      memoryRules,
      robotConfigs,
      agentId,
      uuid,
      effectiveDigitalType,
      effectiveAgentType,
      effectiveOwnerType,
      systemCode,
      ownerType,
      EventEmitter,
      intl,
      isFrontAccess,
      auditErrors,
      promptFieldMaxLength,
    ]
  );

  const showBaseList = useCallback(
    (type: string) => {
      setBaseListType(type);
      baseListAction?.handleShow('add');
    },
    [baseListAction]
  );

  const onValuesChange = useCallback(() => {
    setIsConfigChanged(true);
  }, []);

  const handleOntologyResourceSelect = useCallback(
    (resources = []) => {
      const nextResources = resources.map((item) => normalizeOntologyResourceForEdit(item, effectiveOwnerType));
      setSelectedOntologyResources(nextResources);
      setSavedRelOntology(nextResources);
      setOntologyResourcesDirty(true);
      setOntologyDrawerOpen(false);
      setIsConfigChanged(true);
    },
    [effectiveOwnerType]
  );

  // 顶部
  const renderHeader = (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          style={{ width: 48, height: 48, paddingRight: 16 }}
          onClick={() => {
            // 规范化：去掉 routerBase（如 /manager）前缀，保证是应用内相对路径
            if (prevRoutePath) {
              sessionStorage.removeItem('EmployeeDetail_prevRoute');
              history.replace(prevRoutePath);
              return;
            }

            history.replace('/digitalEmployees');
          }}
          className={styles.backButton}
        />
        <Space>
          <div
            style={{
              height: '40px',
              width: '40px',
              borderRadius: '50%',
              overflow: 'hidden',
            }}
          >
            <Image src={getAvatarUrl(avatar)} width="100%" />
          </div>
          <div className={styles.title}>
            <Tooltip title={title}>
              <span className={styles.titleName}>{title}</span>
            </Tooltip>
          </div>
        </Space>
      </div>
      {!showOperation && (
        <div className={styles.headerMiddle}>
          <div className={styles.navTabs}>
            {showConfig && (
              <div
                className={classnames(styles.navTab, {
                  [styles.active]: activeTab === 'config',
                })}
                onClick={() => setActiveTab('config')}
              >
                {intl.formatMessage({ id: 'employeeDetail.config' })}
              </div>
            )}
            {showLog && (
              <div
                className={classnames(styles.navTab, {
                  [styles.active]: activeTab === 'log',
                })}
                onClick={() => setActiveTab('log')}
              >
                {intl.formatMessage({ id: 'employeeDetail.log' })}
              </div>
            )}
            {showManage && managementAddresses.length > 0 && (
              <div
                className={classnames(styles.navTab, {
                  [styles.active]: activeTab === 'manage',
                })}
                onClick={() => setActiveTab('manage')}
              >
                {intl.formatMessage({ id: 'employeeDetail.manage' })}
              </div>
            )}
            {/* {resourceStatus === 2 && (
          <div
                className={classnames(styles.navTab, {
                  [styles.active]: activeTab === 'operation',
                })}
                onClick={() => setActiveTab('operation')}
              >
            {intl.formatMessage({ id: 'employeeDetail.operation' })}
          </div>
            )} */}
          </div>
        </div>
      )}
      <Space className={styles.headerRight}>
        {activeTab === 'config' && !readOnly && (
          <>
            {issues.length > 0 && (
              <ExclamationCircleOutlined
                onClick={() => showAuditConfirm(issues, true)}
                style={{ color: '#CF1322', fontSize: '20px' }}
              />
            )}
            <Button
              type="primary"
              onClick={() => updateResource()}
              loading={
                submitLoading ||
                loading?.effects['employeeMgr/createDigitalEmployee'] ||
                loading?.effects['employeeMgr/updateResource']
              }
            >
              {intl.formatMessage({ id: 'employeeDetail.save' })}
            </Button>
          </>
        )}
        {/* {agentId && !readOnly && !isFrontAccess && !showOperation && (
          <Button
            type="primary"
            onClick={() =>
              modalAction.handleShow('edit', {
                ...resultDataRef.current,
              })
            }
          >
            {intl.formatMessage({ id: 'common.publish' })}
          </Button>
        )} */}
      </Space>
    </div>
  );

  const renderChat = (
    <div className={styles.preViewChat}>
      <Space>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            overflow: 'hidden',
          }}
        >
          <Image src={getAvatarUrl(avatar)} width="100%" />
        </div>
        <span className={styles.beyondTitle}>{agentName}</span>
        <span className={styles.beyondTag}>
          <span>{intl.formatMessage({ id: 'employeeDetail.digitalEmployee' })}</span>
        </span>
      </Space>
      <div className={styles.ask}>{ask}</div>
      <div className={styles.actionsBar}>
        <Space>
          <AntdIcon
            title={intl.formatMessage({ id: 'common.play' })}
            type="icon-a-Volume-noticeshengyin-da"
            className={styles.actionsBarItem}
          />
          <AntdIcon
            title={intl.formatMessage({ id: 'common.copy' })}
            type="icon-a-Copyfuzhi"
            className={styles.actionsBarItem}
          />
          <AntdIcon
            title={intl.formatMessage({ id: 'common.regenerate' })}
            type="icon-a-Refreshshuaxin1"
            className={styles.actionsBarItem}
          />
          <div className={styles.actionsBarItem}>
            <AntdIcon type="icon-a-Share-twofenxiang21" style={{ fontSize: 20 }} />
            <span style={{ fontSize: 14 }}>{intl.formatMessage({ id: 'common.share' })}</span>
          </div>
          <Tooltip title={intl.formatMessage({ id: 'common.more' })}>
            <EllipsisOutlined className={styles.actionsBarItem} />
          </Tooltip>
        </Space>
        <Divider type="vertical" />
        <Space>
          <AntdIcon
            title={intl.formatMessage({ id: 'common.thumbsUp' })}
            type="icon-a-Thumbs-upzan"
            className={styles.actionsBarItem}
          />
          <AntdIcon
            title={intl.formatMessage({ id: 'common.thumbsDown' })}
            type="icon-a-Thumbs-downcai"
            className={styles.actionsBarItem}
          />
        </Space>
      </div>
      <div className={styles.questionTips}>
        {questionList.map((item, idx) => (
          <span key={idx}>
            <Button className={styles.bubleButton}>
              {item.infoTitle}
              <ArrowRightOutlined />
            </Button>
          </span>
        ))}
      </div>

      <div className={styles.queryInput}>
        <div className={styles.inputWrapper}>
          <textarea
            disabled
            placeholder={intl.formatMessage({
              id: 'employeeDetail.inputPlaceholder',
            })}
          />
        </div>
        <div className={styles.tools}>
          <Button
            type="primary"
            icon={<AntdIcon type="icon-fasong-jiantou" style={{ fontSize: 24 }} />}
            shape="circle"
            className={styles.sendBtn}
            disabled
          />
        </div>
        <div className={styles.debugBtn}>
          <Button
            type="default"
            loading={
              submitLoading ||
              loading?.effects['employeeMgr/createDigitalEmployee'] ||
              loading?.effects['employeeMgr/updateResource']
            }
            onClick={() => updateResource()}
          >
            {intl.formatMessage({ id: 'employeeDetail.debug' })}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={classnames(styles.container, 'ub ub-ver')}>
      {renderHeader}

      <div className={classnames(styles.content, 'ub-f1')}>
        {activeTab === 'config' && (
          <>
            {/* 左侧 */}
            <div className={classnames(styles.contentLeft, 'ub ub-ver')}>
              <ConfigForm
                agentId={agentId}
                form={form}
                questionList={questionList}
                setQuestionList={setQuestionList}
                digitalType={effectiveDigitalType}
                employeeType={effectiveAgentType}
                agentType={effectiveAgentType}
                onValuesChange={onValuesChange}
                showBaseList={showBaseList}
                updateResource={noop}
                updateCompositeAppInfo={null}
                selectedTools={selectedTools}
                setSelectedTools={setSelectedTools}
                knowledgeBases={knowledgeBases}
                setKnowledgeBases={setKnowledgeBases}
                tagOptions={tagOptions}
                setTagOptions={setTagOptions}
                managementAddresses={managementAddresses}
                setManagementAddresses={setManagementAddresses}
                memoryRules={memoryRules}
                setMemoryRules={setMemoryRules}
                robotConfigs={robotConfigs}
                setRobotConfigs={setRobotConfigs}
                isReadOnly={readOnly}
                updateTime={updateTime}
                modelName={modelName}
                modelList={modelList}
                lastAvatar={lastAvatar}
                avatar={avatar}
                resultDataRef={resultDataRef}
                prologueRef={prologueRef}
                setModelName={setModelName}
                setAvatar={setAvatar}
                setRefineModalOpen={setRefineModalOpen}
                auditErrors={auditErrors}
                terminalTypeList={terminalTypeList}
                initialCoreCompetencies={coreCompetenciesState}
                ownerType={effectiveOwnerType}
                savedRelOntology={savedRelOntology}
                ontologyResourcesDirty={ontologyResourcesDirty}
                onOpenOntologyDrawer={() => setOntologyDrawerOpen(true)}
              />
            </div>

            {/* 右侧 */}
            <div
              className={styles.contentRight}
              style={effectiveDigitalType === 'FROM_SANDBOX' ? { display: 'none' } : undefined}
            >
              <div className={styles.preViewTitle}>
                {intl.formatMessage({ id: 'employeeDetail.dialoguePreview' })}
                {isConfigChanged && (
                  <span className={styles.debugTip}>{intl.formatMessage({ id: 'employeeDetail.debugTip' })}</span>
                )}
              </div>
              {!debugPage && renderChat}
              {!!debugPage && (
                <iframe
                  title="debugPage"
                  ref={iframeRef}
                  src={debugPage}
                  className={styles.preViewIframe}
                  allow="camera;microphone"
                />
              )}
            </div>
          </>
        )}

        {activeTab === 'log' && (
          <Log
            agentId={agentId}
            title={title}
            agentName={agentName}
            projectList={projectList}
            accessTerminalList={accessTerminalList}
            contentFeedbackType={contentFeedbackType}
            agentType={agentTypeFormValue}
            onSelectLog={(record) => {
              setLog(record);
            }}
          />
        )}

        {activeTab === 'analysis' && <div className={styles.analysisContent} />}
        {activeTab === 'manage' && <Manage pages={managementAddresses} />}
        {activeTab === 'operation' && (
          <Operation
            agentId={agentId}
            agentName={agentName}
            agentData={resultDataRef.current}
            knowledgeBases={knowledgeBases}
            skills={selectedTools}
          />
        )}
      </div>
      {auditLoading && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(45, 52, 67, 0.45)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin size="large" />
          <div
            style={{
              marginTop: 16,
              color: '#fff',
              fontSize: 16,
              lineHeight: '24px',
              maxWidth: 700,
              padding: '0 16px',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
            }}
          >
            {intl.formatMessage({ id: 'employeeDetail.auditLoading' })}
          </div>
        </div>
      )}
      {modalState?.open && (
        <PublishModal
          {...modalState}
          onCancel={modalAction.onCancel}
          reload={() => {
            if (window.parent !== window) {
              window.parent.postMessage(
                {
                  type: 'close',
                  uuid,
                },
                '*'
              );
            } else {
              history.replace('/resource/digitalEmployee');
            }
          }}
        />
      )}
      {baseListState?.open && (
        <BaseListModal
          {...baseListState}
          onCancel={baseListAction?.onCancel}
          appId={agentId}
          digitalType={baseListType}
          agentType={effectiveAgentType}
          reload={() => getCompositeAppInfo('reload')}
          skills={selectedTools}
          knowledgeBases={knowledgeBases}
          handleUpdateItem={(item) => {
            if (baseListType === '005') {
              setSelectedTools((prev) => {
                const targetItem = prev.find((it) => it.resourceId === item.resourceId);
                if (targetItem) {
                  Object.assign(targetItem, item);
                }

                return [...prev];
              });
            } else {
              setKnowledgeBases((prev) => {
                const targetItem = prev.find((it) => it.resourceId === item.resourceId);
                if (targetItem) {
                  Object.assign(targetItem, item);
                }

                return [...prev];
              });
            }
          }}
          handleSelect={(item) => {
            if (baseListType === '005') {
              setSelectedTools((pre) => [...pre, item]);
            } else if (baseListType === '006') {
              const knowledgeItem = {
                ...item,
                grantResourceType: item.grantResourceType || item.resourceBizType,
                description: item.description ?? item.resourceDesc ?? item.remark ?? '',
              };
              setKnowledgeBases(
                knowledgeBases.map((it) => ({
                  ...it,
                  items: knowledgeItem.grantResourceType === it.id ? [...it.items, knowledgeItem] : it.items,
                }))
              );
            }
          }}
          handleRemove={(item) => {
            if (baseListType === '005') {
              setSelectedTools(selectedTools.filter((it) => it.resourceId !== item.resourceId));
            } else if (baseListType === '006') {
              setKnowledgeBases(
                knowledgeBases.map((it) => ({
                  ...it,
                  items: it.items.filter((i) => i.resourceId !== item.resourceId),
                }))
              );
            }
          }}
        />
      )}
      <OntologyResourceSelectorDrawer
        open={ontologyDrawerOpen}
        ownerType={effectiveOwnerType}
        selectedResources={selectedOntologyResources}
        onCancel={() => setOntologyDrawerOpen(false)}
        onOk={handleOntologyResourceSelect}
      />
      <RefineModal
        visible={refineModalOpen}
        form={form}
        questionList={questionList}
        skills={selectedTools}
        knowledgeBases={knowledgeBases}
        agentType={effectiveAgentType}
        resourceId={agentId}
        modelCode={modelName}
        onOk={(formValue, myQuestionList) => {
          setQuestionList(myQuestionList);
          form.setFieldsValue(formValue);
          // 同步一键完善生成的核心能力到外层状态，用于 ConfigForm 回显
          if (formValue.coreCompetencies) {
            setCoreCompetenciesState(formValue.coreCompetencies || []);
          }

          setRefineModalOpen(false);
        }}
        onCancel={() => {
          setRefineModalOpen(false);
        }}
      />
      <LogInfoDrawer onClose={() => setLog(undefined)} log={log} />
    </div>
  );
};

export default connect(({ loading }) => ({
  loading,
}))(EmployeeDetail);
