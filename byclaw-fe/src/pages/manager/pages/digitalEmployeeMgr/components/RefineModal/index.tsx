// @ts-nocheck
import React, { useRef, useEffect, useState } from 'react';
import { Modal, Form, Button, Spin } from 'antd';
import classNames from 'classnames';
import { customAlphabet } from 'nanoid';
import { useIntl } from '@umijs/max';

import { POST } from '@/service/common/request';
import MyForm from './Form';
import styles from './index.module.less';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6);

const ALL_SECTIONS = ['desc', 'abilities', 'tags', 'persona', 'greeting', 'questions'];
const WORK_PROMPT_KEY = 'agent';
const PERSONA_PROMPT_KEY = 'soul';
const TOOL_PROMPT_KEY = 'tools';

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

const normalizeFieldValue = (value: any) => {
  const parsed = parseJsonRecursively(value);
  if (parsed === null || parsed === undefined) return '';
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
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

const RefineModal = ({ visible, onOk, onCancel, form, questionList, skills = [], knowledgeBases = [] }) => {
  const intl = useIntl();
  const [myForm] = Form.useForm();

  const [myQuestionList, setMyQuestionList] = useState([]);
  const [tags, setTags] = useState([]);
  const [coreAbilities, setCoreAbilities] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedSections, setSelectedSections] = useState(new Set(ALL_SECTIONS));
  const [generatedPromptConfigs, setGeneratedPromptConfigs] = useState<any[]>([]);
  // 避免卸载后继续 setState
  const mountedRef = useRef(false);
  const timerRef = useRef(null);
  const hasGeneratedRef = useRef(false);

  const customAlphabetRef = useRef(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6));

  const handleOk = async () => {
    try {
      const values = await myForm.validateFields();
      const has = (key) => selectedSections.has(key);

      const result = {};

      const currentPromptConfigs = parsePromptConfigList(form.getFieldValue('corePersonaDefinition'));
      const promptConfigs = mergePromptConfigs(currentPromptConfigs, generatedPromptConfigs);
      const personaText = values?.corePersonaDefinition || '';

      if (has('desc')) result.resourceDesc = values.resourceDesc;
      if (has('persona')) {
        if (promptConfigs.length) {
          const nextPromptConfigs = promptConfigs.map((item) => ({
            ...item,
            value: isPersonaPrompt(item) ? personaText : getPromptItemText(item),
          }));
          const hasPersonaPrompt = nextPromptConfigs.some(isPersonaPrompt);
          if (!hasPersonaPrompt) {
            nextPromptConfigs.push({
              name: intl.formatMessage({ id: 'employeeDetail.personalityDefinition', defaultMessage: '人格定义' }),
              key: PERSONA_PROMPT_KEY,
              normalizedKey: PERSONA_PROMPT_KEY,
              value: personaText,
            });
          }
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
      if (promptConfigs.length) {
        promptConfigs.forEach((item) => {
          if (item?.key) {
            roleObj[item.key] =
              has('persona') && isPersonaPrompt(item) ? personaText : result[item.key] || getPromptItemText(item);
          }
        });
      }
      if (promptConfigs.length && has('persona')) {
        roleObj[PERSONA_PROMPT_KEY] = personaText;
      }
      const workPrompt = promptConfigs.find((item) => (item.normalizedKey || item.key) === WORK_PROMPT_KEY);
      const toolPrompt = promptConfigs.find((item) => (item.normalizedKey || item.key) === TOOL_PROMPT_KEY);
      if (workPrompt) {
        roleObj.workStandard = roleObj[workPrompt.key] || roleObj.workStandard || '';
      }
      if (toolPrompt) {
        roleObj.toolStandard = roleObj[toolPrompt.key] || roleObj.toolStandard || '';
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
    parsedCoreAbilities = parseListLike(coreCompetencies).map((item, index) => ({
      id: nanoid(),
      name: item?.coreCompetency || item?.name || '',
      description: item?.description || '',
      icon: abilityIcons[index % abilityIcons.length].type,
      color: abilityColors[index % abilityColors.length].value,
      expanded: true,
      acceptBoundary: Array.isArray(item?.acceptBoundary) ? item.acceptBoundary : [],
      rejectBoundary: Array.isArray(item?.rejectBoundary) ? item.rejectBoundary : [],
      example: Array.isArray(item?.example) ? item.example : [],
    }));

    setCoreAbilities(parsedCoreAbilities);

    const promptConfigs = parsePromptConfigList(corePersonaDefinition);
    setGeneratedPromptConfigs(promptConfigs);

    myForm.setFieldsValue({
      resourceDesc: agentDescription,
      role: characterDescription,
      corePersonaDefinition: extractPersonaDefinitionText(corePersonaDefinition),
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

  const onRegenerate = (formValue, questionListValue) => {
    const { resourceName, resourceDesc, descText, role } = formValue;
    if (!mountedRef.current) return;

    setIsLoading(true);
    setGeneratedPromptConfigs([]);

    const outerFormValues = form.getFieldsValue();
    const {
      abilityBoundary,
      exampleQuestions,
      roleAttributes,
      processingFlow,
      personalityDimensions,
      wordPreferences,
      sentenceAndTone,
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

    POST<Record<string, any>>('/byaiService/meta/prompt/v3/digitalmploy', body)
      .then((data) => {
        if (!mountedRef.current) return;
        const fields = Object.fromEntries(
          Object.entries(data || {})
            .filter(([key]) => key !== 'contextSummary')
            .map(([key, value]) => [key, normalizeFieldValue(value)])
        );
        hasGeneratedRef.current = true;
        applyAllFields(fields);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setIsLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    if (visible && !hasGeneratedRef.current) {
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
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [form, visible, questionList]);

  return (
    <Modal
      className={styles.refineModal}
      title={intl.formatMessage({ id: 'refineModal.title' })}
      open={visible}
      onCancel={() => {
        onCancel();
        setIsLoading(false);
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
              onCancel();
              setIsLoading(false);
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
