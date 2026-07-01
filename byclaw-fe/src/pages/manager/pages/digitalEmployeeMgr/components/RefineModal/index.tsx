// @ts-nocheck
import React, { useRef, useEffect, useState } from 'react';
import { Modal, Form, Button, Spin, message } from 'antd';
import classNames from 'classnames';
import { customAlphabet } from 'nanoid';
import { getLocale, useIntl } from '@umijs/max';

import { getssoToken, getSessionKey, getToken, ssotokenKey, tokenKey } from '@/utils/auth';
import { generateSignature } from '@/utils/signature';
import MyForm from './Form';
import styles from './index.module.less';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6);

const ALL_SECTIONS = ['desc', 'abilities', 'tags', 'persona', 'greeting', 'questions'];
const WORK_PROMPT_KEY = 'agent';
const PERSONA_PROMPT_KEY = 'soul';
const TOOL_PROMPT_KEY = 'tools';
const STREAM_FIELD_LABELS = {
  agentDescription: '角色描述',
  characterDescription: '角色定义',
  openingRemark: '开场白',
  commonQuestions: '常见问题',
  agentTags: '标签',
  corePersonaDefinition: '核心提示词',
  coreCompetencies: '核心能力',
  faqs: '问题示例',
  roleAttributes: '角色属性',
  processingFlow: '处理流程',
  personalityDimensions: '性格维度',
  wordPreferences: '用词偏好',
  sentenceAndTone: '句式语气',
  routingDescription: '路由描述',
  acceptBoundary: '适用边界',
  rejectBoundary: '拒绝边界',
  recommendedResources: '建议资源',
  generationNotes: '生成说明',
};

const normalizePromptKey = (key?: string, item: any = {}) => {
  const candidates = [key, item?.name, item?.nameEn].filter(Boolean);
  if (candidates.some((value) => ['agent', '工作规范', 'Work Specification'].includes(value))) return WORK_PROMPT_KEY;
  if (
    candidates.some((value) =>
      ['persona', 'soul', 'corePersonaDefinition', '人格定义', 'Persona', 'Personality Definition'].includes(value)
    )
  ) {
    return PERSONA_PROMPT_KEY;
  }
  if (candidates.some((value) => ['tool', 'tools', '工具规范', 'Tool Specification'].includes(value)))
    return TOOL_PROMPT_KEY;
  if (candidates.some((value) => ['memory', '记忆规范', 'Memory Specification'].includes(value))) return 'memory';
  return key;
};

const parseJsonRecursively = (value: any, maxDepth = 5): any => {
  if (maxDepth <= 0 || typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parseJsonRecursively(parsed, maxDepth - 1) : parsed;
  } catch {
    return value;
  }
};

const stripJsonFence = (value: string) => {
  const matched = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return matched ? matched[1].trim() : value.trim();
};

const extractJsonObjectText = (value: string) => {
  const trimmed = stripJsonFence(value || '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
};

const normalizeFieldValue = (value: any) => {
  const parsed = parseJsonRecursively(value);
  if (parsed === null || parsed === undefined) return '';
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
};

const normalizeGeneratedFieldMap = (payload: any) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};

  return Object.entries(payload).reduce((acc, [field, value]) => {
    if (field !== 'contextSummary') {
      acc[field] = normalizeFieldValue(value);
    }
    return acc;
  }, {});
};

const parseFieldsFromStreamText = (value: string) => {
  if (!value?.trim()) return {};

  try {
    const parsed = JSON.parse(extractJsonObjectText(value));
    return normalizeGeneratedFieldMap(parsed);
  } catch (e) {
    console.warn('parse meta prompt full stream text fallback failed', e);
    return {};
  }
};

const parsePromptConfigList = (value: any) => {
  const parsed = parseJsonRecursively(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (!item) return item;
      return {
        ...item,
        normalizedKey: normalizePromptKey(item.key, item),
      };
    })
    .filter((item) => item?.key);
};

const getPromptItemText = (item: any) => {
  const value = parseJsonRecursively(item?.value ?? '');
  return typeof value === 'string' ? value : JSON.stringify(value);
};

const toPersistPromptItem = (item: any) => {
  if (!item || typeof item !== 'object') return item;
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'normalizedKey'));
};

const mergePromptConfigs = (baseConfigs: any[] = [], generatedConfigs: any[] = []) => {
  if (!baseConfigs.length) return generatedConfigs;
  if (!generatedConfigs.length) return baseConfigs;

  const generatedMap = new Map(generatedConfigs.map((item) => [item.normalizedKey || item.key, item]));
  const merged = baseConfigs.map((item) => {
    const generated = generatedMap.get(item.normalizedKey || item.key);
    if (!generated) return item;
    return {
      ...item,
      value: getPromptItemText(generated),
    };
  });

  generatedConfigs.forEach((item) => {
    if (
      !baseConfigs.some((baseItem) => (baseItem.normalizedKey || baseItem.key) === (item.normalizedKey || item.key))
    ) {
      merged.push(item);
    }
  });

  return merged;
};

const isPersonaPrompt = (item: any) =>
  item?.normalizedKey === PERSONA_PROMPT_KEY ||
  item?.key === PERSONA_PROMPT_KEY ||
  item?.key === 'persona' ||
  item?.key === 'corePersonaDefinition' ||
  item?.name === '人格定义' ||
  item?.nameEn === 'Persona' ||
  item?.nameEn === 'Personality Definition';

const extractPersonaDefinitionText = (value: any) => {
  const promptList = parsePromptConfigList(value);
  if (!promptList.length) return value || '';

  const personaItem = promptList.find(isPersonaPrompt);
  return personaItem ? getPromptItemText(personaItem) : '';
};

const isWorkPrompt = (item: any) =>
  item?.normalizedKey === WORK_PROMPT_KEY ||
  item?.key === WORK_PROMPT_KEY ||
  item?.name === '工作规范' ||
  item?.nameEn === 'Work Standard';

const isToolPrompt = (item: any) =>
  item?.normalizedKey === TOOL_PROMPT_KEY ||
  item?.key === TOOL_PROMPT_KEY ||
  item?.name === '工具规范' ||
  item?.nameEn === 'Tool Standard';

const isMemoryPrompt = (item: any) =>
  item?.normalizedKey === 'memory' ||
  item?.key === 'memory' ||
  item?.name === '记忆规范' ||
  item?.nameEn === 'Memory Standard';

const getPromptTextByMatcher = (value: any, matcher: (item: any) => boolean) => {
  const promptList = parsePromptConfigList(value);
  const item = promptList.find(matcher);
  return item ? getPromptItemText(item) : '';
};

const buildPromptItem = (name: string, key: string, value: string, nameEn?: string) => ({
  name,
  nameEn,
  key,
  normalizedKey: normalizePromptKey(key, { name, nameEn }),
  value,
});

const mergePromptTextFields = (
  promptConfigs: any[],
  values: {
    personaText?: string;
    workStandardText?: string;
    toolStandardText?: string;
    memoryStandardText?: string;
  },
  intl: any
) => {
  const ensuredConfigs = [...promptConfigs];
  const ensureItem = (matcher: (item: any) => boolean, item: any) => {
    if (!ensuredConfigs.some(matcher) && item.value) {
      ensuredConfigs.push(item);
    }
  };

  ensureItem(
    isPersonaPrompt,
    buildPromptItem(
      intl.formatMessage({ id: 'employeeDetail.personalityDefinition', defaultMessage: '人格定义' }),
      PERSONA_PROMPT_KEY,
      values.personaText || '',
      'Persona'
    )
  );
  ensureItem(
    isWorkPrompt,
    buildPromptItem('工作规范', WORK_PROMPT_KEY, values.workStandardText || '', 'Work Standard')
  );
  ensureItem(
    isToolPrompt,
    buildPromptItem('工具规范', TOOL_PROMPT_KEY, values.toolStandardText || '', 'Tool Standard')
  );
  ensureItem(isMemoryPrompt, buildPromptItem('记忆规范', 'memory', values.memoryStandardText || '', 'Memory Standard'));

  return ensuredConfigs.map((item) => {
    if (isPersonaPrompt(item)) return { ...item, value: values.personaText || '' };
    if (isWorkPrompt(item)) return { ...item, value: values.workStandardText || '' };
    if (isToolPrompt(item)) return { ...item, value: values.toolStandardText || '' };
    if (isMemoryPrompt(item)) return { ...item, value: values.memoryStandardText || '' };
    return item;
  });
};

const stripListMarker = (value: any) =>
  String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)、]|[（(]?\d+[）)])\s*/, '')
    .trim();

const splitAbilityText = (value: any, index: number) => {
  const text = stripListMarker(value);
  const matched = text.match(/^([^：:；;。]{2,16})[：:]\s*([\s\S]+)$/);
  if (matched) {
    return {
      name: matched[1].trim(),
      description: matched[2].trim(),
    };
  }

  return {
    name: text.length > 12 ? text.slice(0, 12) : text || `能力${index + 1}`,
    description: text,
  };
};

const parseListLike = (value: any) => {
  const parsed = parseJsonRecursively(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return Object.values(parsed);
  if (typeof parsed !== 'string') return [];

  const content = stripJsonFence(parsed);
  const reparsed = parseJsonRecursively(content);
  if (Array.isArray(reparsed)) return reparsed;
  if (reparsed && typeof reparsed === 'object') return Object.values(reparsed);

  return content
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const extractWorkPromptAbilities = (corePersonaDefinition: any) => {
  const promptConfigs = parsePromptConfigList(corePersonaDefinition);
  const workPrompt = promptConfigs.find(isWorkPrompt);
  if (!workPrompt) return [];

  return parseListLike(getPromptItemText(workPrompt))
    .map(stripListMarker)
    .filter(Boolean)
    .filter((line) => !/^#+\s*/.test(line))
    .slice(0, 5)
    .map((line, index) => splitAbilityText(line, index));
};

const parseSseBlock = (block: string) => {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];

  lines.forEach((line) => {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  });

  return {
    event,
    data: dataLines.join('\n'),
  };
};

const previewStreamValue = (value: any) => {
  const text = normalizeFieldValue(value);
  if (!text) return '';
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 80)}...` : singleLine;
};

const RefineModal = ({
  visible,
  onOk,
  onCancel,
  form,
  questionList,
  skills = [],
  knowledgeBases = [],
  agentType,
  resourceId,
  modelCode,
}) => {
  const intl = useIntl();
  const [myForm] = Form.useForm();

  const [myQuestionList, setMyQuestionList] = useState([]);
  const [tags, setTags] = useState([]);
  const [coreAbilities, setCoreAbilities] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedSections, setSelectedSections] = useState(new Set(ALL_SECTIONS));
  const [generatedPromptConfigs, setGeneratedPromptConfigs] = useState<any[]>([]);
  const [streamingFields, setStreamingFields] = useState<Record<string, string>>({});
  const [streamingTextLength, setStreamingTextLength] = useState(0);
  // 避免卸载后继续 setState
  const mountedRef = useRef(false);
  const timerRef = useRef(null);
  const hasGeneratedRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const generatedContextKeyRef = useRef('');

  const customAlphabetRef = useRef(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6));

  const getGenerationContextKey = () =>
    JSON.stringify({
      resourceId: resourceId || form.getFieldValue('resourceId') || '',
      resourceName: form.getFieldValue('resourceName') || '',
      agentType: agentType || form.getFieldValue('agentType') || '',
      modelCode: modelCode || form.getFieldValue('modelCode') || '',
    });

  const stopStreaming = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsLoading(false);
  };

  const handleOk = async () => {
    try {
      const values = await myForm.validateFields();
      const has = (key) => selectedSections.has(key);

      const result = {};

      const currentPromptConfigs = parsePromptConfigList(form.getFieldValue('corePersonaDefinition'));
      const promptConfigs = mergePromptConfigs(currentPromptConfigs, generatedPromptConfigs);
      const personaText = values?.corePersonaDefinition || '';
      const workStandardText = values?.workStandard || '';
      const toolStandardText = values?.toolStandard || '';
      const memoryStandardText = values?.memoryStandard || '';
      let nextPromptConfigs = promptConfigs;

      if (has('desc')) result.resourceDesc = values.resourceDesc;
      if (has('persona')) {
        nextPromptConfigs = mergePromptTextFields(
          promptConfigs,
          {
            personaText,
            workStandardText,
            toolStandardText,
            memoryStandardText,
          },
          intl
        );
        if (nextPromptConfigs.length) {
          result.corePersonaDefinition = JSON.stringify(nextPromptConfigs.map(toPersistPromptItem));
          nextPromptConfigs.forEach((item) => {
            if (item?.key) {
              result[item.key] = getPromptItemText(item);
            }
          });
          const workPrompt = nextPromptConfigs.find((item) => (item.normalizedKey || item.key) === WORK_PROMPT_KEY);
          const toolPrompt = nextPromptConfigs.find((item) => (item.normalizedKey || item.key) === TOOL_PROMPT_KEY);
          if (workPrompt) {
            result.workStandard = getPromptItemText(workPrompt);
          }
          if (toolPrompt) {
            result.toolStandard = getPromptItemText(toolPrompt);
          }
          const memoryPrompt = nextPromptConfigs.find(isMemoryPrompt);
          if (memoryPrompt) {
            result.memoryStandard = getPromptItemText(memoryPrompt);
          }
        } else {
          result.corePersonaDefinition = personaText;
        }
      }
      if (has('greeting')) result.descText = values.descText;
      if (has('tags')) result.tags = values.tags;

      if (has('abilities')) {
        result.coreCompetencies = coreAbilities.map((item) => ({
          coreCompetency: item.name,
          description: item.description,
          acceptBoundary: Array.isArray(item.acceptBoundary) ? item.acceptBoundary : [],
          rejectBoundary: Array.isArray(item.rejectBoundary) ? item.rejectBoundary : [],
          example: Array.isArray(item.example) ? item.example : [],
        }));
        result.coreAbility = '';
        result.abilityDesc = JSON.stringify({
          ability: '',
          constraints: '',
          faqs: '',
        });
      }

      let roleObj = {};
      try {
        roleObj = JSON.parse(form.getFieldValue('role') || '{}');
      } catch {
        roleObj = {};
      }

      Object.assign(roleObj, {
        roleAttributes: values?.roleAttributes || '',
        processingFlow: values?.processingFlow || '',
        personalityDimensions: values?.personalityDimensions || '',
        wordPreferences: values?.wordPreferences || '',
        sentenceAndTone: values?.sentenceAndTone || '',
        corePersonaDefinition:
          result.corePersonaDefinition || form.getFieldValue('corePersonaDefinition') || personaText,
        personalityDefinition:
          result.corePersonaDefinition || form.getFieldValue('corePersonaDefinition') || personaText,
      });
      if (nextPromptConfigs.length) {
        nextPromptConfigs.forEach((item) => {
          if (item?.key) {
            roleObj[item.key] = result[item.key] || getPromptItemText(item);
          }
        });
      }
      if (nextPromptConfigs.length && has('persona')) {
        roleObj[PERSONA_PROMPT_KEY] = personaText;
        roleObj[WORK_PROMPT_KEY] = workStandardText;
        roleObj[TOOL_PROMPT_KEY] = toolStandardText;
        roleObj.memory = memoryStandardText;
      }
      const workPrompt = nextPromptConfigs.find(isWorkPrompt);
      const toolPrompt = nextPromptConfigs.find(isToolPrompt);
      const memoryPrompt = nextPromptConfigs.find(isMemoryPrompt);
      if (workPrompt) {
        roleObj.workStandard = roleObj[workPrompt.key] || workStandardText || roleObj.workStandard || '';
      }
      if (toolPrompt) {
        roleObj.toolStandard = roleObj[toolPrompt.key] || toolStandardText || roleObj.toolStandard || '';
      }
      if (memoryPrompt) {
        roleObj.memoryStandard = roleObj[memoryPrompt.key] || memoryStandardText || roleObj.memoryStandard || '';
      }
      result.role = JSON.stringify(roleObj);

      const questionsToPass = has('questions') ? myQuestionList : questionList;
      onOk(result, questionsToPass);
    } catch (e) {
      console.error(e);
    }
  };

  const applyAllFields = (fields: Record<string, any>) => {
    const {
      agentDescription,
      characterDescription,
      commonQuestions,
      openingRemark,
      agentTags,
      roleAttributes,
      processingFlow,
      personalityDimensions,
      wordPreferences,
      sentenceAndTone,
      coreCompetencies,
      corePersonaDefinition,
    } = fields;

    const arr = parseListLike(agentTags);

    const tagList = arr.map((it) => ({
      label: typeof it === 'string' ? it : JSON.stringify(it),
      value: typeof it === 'string' ? it : JSON.stringify(it),
    }));

    const normalizeText = (v) => parseListLike(v).join('\n');
    const promptConfigs = parsePromptConfigList(corePersonaDefinition);

    let parsedCoreAbilities = [];
    const abilityIcons = [
      { type: 'icon-a-List-topliebiao3', label: '列表' },
      { type: 'icon-a-Application-oneyingyong3', label: '立方体' },
      { type: 'icon-a-Asteriskxinghao3', label: '星星' },
      { type: 'icon-a-Circles-sevenyuanquan', label: '圆点' },
      { type: 'icon-a-Circle-threeyuanquan', label: '人物' },
      { type: 'icon-a-Circle-fouryuanquan', label: '工具' },
    ];
    const abilityColors = [
      { value: '#EF7BE3', label: '粉色' },
      { value: '#725CFA', label: '紫色' },
      { value: '#165DFF', label: '蓝色' },
      { value: '#58D764', label: '绿色' },
      { value: '#FF903E', label: '橙色' },
      { value: '#FF5A5A', label: '红色' },
    ];
    const competencyList = parseListLike(coreCompetencies);
    const abilitySource = competencyList.length ? competencyList : extractWorkPromptAbilities(corePersonaDefinition);
    parsedCoreAbilities = abilitySource
      .map((item, index) => {
        const fallback = splitAbilityText(
          typeof item === 'string' ? item : item?.description || item?.desc || item?.content || '',
          index
        );
        return {
          id: nanoid(),
          name:
            item?.coreCompetency ||
            item?.coreAbility ||
            item?.abilityName ||
            item?.ability ||
            item?.name ||
            item?.title ||
            item?.['核心能力'] ||
            item?.['能力名称'] ||
            fallback.name,
          description:
            item?.description ||
            item?.desc ||
            item?.abilityDesc ||
            item?.detail ||
            item?.content ||
            item?.['描述'] ||
            item?.['能力描述'] ||
            fallback.description,
          icon: abilityIcons[index % abilityIcons.length].type,
          color: abilityColors[index % abilityColors.length].value,
          expanded: true,
          acceptBoundary: parseListLike(item?.acceptBoundary),
          rejectBoundary: parseListLike(item?.rejectBoundary),
          example: parseListLike(item?.example),
        };
      })
      .filter((item) => item.name || item.description);

    setCoreAbilities(parsedCoreAbilities);

    setGeneratedPromptConfigs(promptConfigs);

    myForm.setFieldsValue({
      resourceDesc: agentDescription,
      role: characterDescription,
      corePersonaDefinition: extractPersonaDefinitionText(corePersonaDefinition),
      workStandard: getPromptTextByMatcher(corePersonaDefinition, isWorkPrompt),
      toolStandard: getPromptTextByMatcher(corePersonaDefinition, isToolPrompt),
      memoryStandard: getPromptTextByMatcher(corePersonaDefinition, isMemoryPrompt),
      descText: openingRemark,
      tags: tagList?.map((it) => it.value),
      roleAttributes: normalizeText(roleAttributes),
      processingFlow: normalizeText(processingFlow),
      personalityDimensions: normalizeText(personalityDimensions),
      wordPreferences: normalizeText(wordPreferences),
      sentenceAndTone: normalizeText(sentenceAndTone),
    });

    setTags(tagList);
    setSelectedSections(new Set(ALL_SECTIONS));

    const commonQArr = parseListLike(commonQuestions);
    setMyQuestionList(
      commonQArr.map((q) => ({
        infoTitle: q,
        infoContent: q,
        instructCode: q,
        slotSettings: {},
        infoType: 5,
        datasetIdList: [],
        uuid: customAlphabetRef.current(),
      }))
    );
  };

  const onRegenerate = async (formValue, questionListValue) => {
    const { resourceName, resourceDesc, descText, role } = formValue;
    if (!mountedRef.current) return;

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    setIsLoading(true);
    setGeneratedPromptConfigs([]);
    setStreamingFields({});
    setStreamingTextLength(0);

    const outerFormValues = form.getFieldsValue();
    const {
      abilityBoundary,
      exampleQuestions,
      roleAttributes,
      processingFlow,
      personalityDimensions,
      wordPreferences,
      sentenceAndTone,
      corePersonaDefinition,
    } = outerFormValues;

    const relIds = [];
    skills.forEach((it) => {
      relIds.push(`${it.resourceId}`);
    });
    knowledgeBases.forEach((it) => {
      it.items.forEach((i) => {
        relIds.push(`${i.resourceId}`);
      });
    });

    const body = {
      agentName: resourceName,
      agentDescription: resourceDesc,
      characterDescription: role,
      openingRemark: descText,
      commonQuestions: questionListValue.map((i) => i.infoContent).join('\n'),
      agentType: agentType || outerFormValues.agentType || '',
      resourceId: resourceId || outerFormValues.resourceId || undefined,
      modelCode: modelCode || outerFormValues.modelCode || '',
      corePersonaDefinition: corePersonaDefinition || formValue?.corePersonaDefinition || '',
      constraints: abilityBoundary || '',
      faqs: exampleQuestions || '',
      roleAttributes: roleAttributes || '',
      processingFlow: processingFlow || '',
      personalityDimensions: personalityDimensions || '',
      wordPreferences: wordPreferences || '',
      sentenceAndTone: sentenceAndTone || '',
      relIds,
      OptimizeTypeEnum: '',
    };

    try {
      const requestBody = {
        ...body,
        language: getLocale(),
      };
      const signatureHeaders = generateSignature('POST', requestBody);
      let streamError = '';

      const response = await fetch('/byaiService/meta/prompt/v3/digitalmploy/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...signatureHeaders,
          [tokenKey]: getToken() || '',
          [ssotokenKey]: getssoToken() || '',
          'x-session-id': getSessionKey() || '',
          language: getLocale(),
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`stream request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let streamTextBuffer = '';
      const fields: Record<string, string> = {};

      const handleSseBlock = (block: string) => {
        const { event, data } = parseSseBlock(block);
        if (!data || data === '[DONE]' || event === 'done') {
          return;
        }
        if (event === 'error') {
          try {
            const payload = JSON.parse(data);
            streamError = payload?.message || intl.formatMessage({ id: 'refineModal.generateFailed' });
          } catch {
            streamError = intl.formatMessage({ id: 'refineModal.generateFailed' });
          }
          return;
        }
        if (event === 'textDelta') {
          try {
            const payload = JSON.parse(data);
            const value = typeof payload?.value === 'string' ? payload.value : normalizeFieldValue(payload?.value);
            if (value) {
              streamTextBuffer += value;
              if (mountedRef.current) {
                setStreamingTextLength(streamTextBuffer.length);
              }
            }
          } catch (e) {
            console.error('parse meta prompt text stream event error', e);
          }
          return;
        }
        if (event === 'finalFields') {
          try {
            const payload = JSON.parse(data);
            const nextFields = normalizeGeneratedFieldMap(payload);
            Object.assign(fields, nextFields);
            if (mountedRef.current) {
              setStreamingFields((prev) => ({
                ...prev,
                ...nextFields,
              }));
            }
          } catch (e) {
            console.error('parse meta prompt final fields event error', e);
          }
          return;
        }
        if (event !== 'fieldDelta') {
          return;
        }

        try {
          const payload = JSON.parse(data);
          if (!payload?.field || payload.field === 'contextSummary') {
            return;
          }
          const value = normalizeFieldValue(payload.value);
          fields[payload.field] = value;
          if (mountedRef.current) {
            setStreamingFields((prev) => ({
              ...prev,
              [payload.field]: value,
            }));
          }
        } catch (e) {
          console.error('parse meta prompt stream event error', e);
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\n\n|\r\n\r\n/);
        buffer = blocks.pop() || '';
        blocks.forEach((block) => handleSseBlock(block.trim()));
        if (done) {
          break;
        }
      }

      if (buffer.trim()) {
        handleSseBlock(buffer.trim());
      }

      if (!mountedRef.current || abortController.signal.aborted) return;
      if (!fields.agentDescription || !fields.corePersonaDefinition) {
        const fallbackFields = parseFieldsFromStreamText(streamTextBuffer);
        if (Object.keys(fallbackFields).length) {
          Object.assign(fields, fallbackFields);
          setStreamingFields((prev) => ({
            ...prev,
            ...fallbackFields,
          }));
        }
      }
      if (streamError && (!fields.agentDescription || !fields.corePersonaDefinition)) {
        throw new Error(streamError);
      }
      if (!fields.agentDescription || !fields.corePersonaDefinition) {
        throw new Error(intl.formatMessage({ id: 'refineModal.generateIncomplete' }));
      }
      hasGeneratedRef.current = true;
      generatedContextKeyRef.current = getGenerationContextKey();
      applyAllFields(fields);
    } catch (error) {
      if (!abortController.signal.aborted) {
        console.error(error);
        message.error(error?.message || intl.formatMessage({ id: 'refineModal.generateFailed' }));
      }
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      if (mountedRef.current && !abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!visible) {
      mountedRef.current = false;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setStreamingFields({});
      setStreamingTextLength(0);
      setIsLoading(false);
      return;
    }

    mountedRef.current = true;
    const currentContextKey = getGenerationContextKey();
    if (generatedContextKeyRef.current && generatedContextKeyRef.current !== currentContextKey) {
      hasGeneratedRef.current = false;
      generatedContextKeyRef.current = '';
      setGeneratedPromptConfigs([]);
      setCoreAbilities([]);
    }
    if (!hasGeneratedRef.current) {
      const v = form.getFieldsValue();
      myForm.setFieldsValue(v);
      setMyQuestionList(questionList);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        const current = myForm.getFieldsValue();
        onRegenerate(current, questionList);
      }, 0);
    }
    return () => {
      mountedRef.current = false;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible]);

  return (
    <Modal
      className={styles.refineModal}
      title={intl.formatMessage({ id: 'refineModal.title' })}
      open={visible}
      onCancel={() => {
        stopStreaming();
        onCancel();
      }}
      footer={null}
      width={700}
      centered
      maskClosable={false}
    >
      <div className={styles.refineModalContent}>
        {isLoading && (
          <div className={styles.loadingContainer}>
            <Spin />
            <div className={styles.loadingHint}>
              {intl.formatMessage({ id: 'refineModal.generating', defaultMessage: '正在生成配置...' })}
            </div>
            <div className={styles.streamProgress}>
              {intl.formatMessage(
                {
                  id: 'refineModal.streamProgress',
                  defaultMessage: '已接收 {count} 字符，正在分析字段',
                },
                { count: streamingTextLength }
              )}
            </div>
            <div className={styles.streamResultList}>
              {!streamingTextLength && Object.entries(streamingFields).length === 0 && (
                <div className={styles.streamWaiting}>
                  {intl.formatMessage({
                    id: 'refineModal.waitingStream',
                    defaultMessage: '正在连接模型并准备生成结果',
                  })}
                </div>
              )}
              {Object.entries(streamingFields).map(([field, value]) => (
                <div className={styles.streamResultItem} key={field}>
                  <div className={styles.streamResultTitle}>{STREAM_FIELD_LABELS[field] || field}</div>
                  <div className={styles.streamResultText}>{previewStreamValue(value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!isLoading && (
          <div className={classNames(styles.formContainer, 'hideThumb')}>
            <MyForm
              form={myForm}
              questionList={myQuestionList}
              setQuestionList={setMyQuestionList}
              tagsOptions={tags}
              setTagsOptions={setTags}
              coreAbilities={coreAbilities}
              setCoreAbilities={setCoreAbilities}
              selectedSections={selectedSections}
              setSelectedSections={setSelectedSections}
            />
          </div>
        )}
        <div className={styles.footerBtns}>
          <Button
            onClick={() => {
              stopStreaming();
              onCancel();
            }}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button
            onClick={async () => {
              const current = myForm.getFieldsValue();
              onRegenerate(current, questionList);
            }}
            style={{ margin: '0 8px' }}
            loading={isLoading}
          >
            {intl.formatMessage({ id: 'refineModal.regenerate' })}
          </Button>
          {!isLoading && (
            <Button type="primary" onClick={handleOk}>
              {intl.formatMessage({ id: 'common.use' })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default RefineModal;
