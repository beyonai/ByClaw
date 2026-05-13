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

const RefineModal = ({ visible, onOk, onCancel, form, questionList, skills = [], knowledgeBases = [] }) => {
  const intl = useIntl();
  const [myForm] = Form.useForm();

  const [myQuestionList, setMyQuestionList] = useState([]);
  const [tags, setTags] = useState([]);
  const [coreAbilities, setCoreAbilities] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  // 避免卸载后继续 setState
  const mountedRef = useRef(false);
  const timerRef = useRef(null);

  const customAlphabetRef = useRef(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6));

  const handleOk = async () => {
    try {
      const values = await myForm.validateFields();
      const coreCompetencies = coreAbilities.map((item) => ({
        coreCompetency: item.name,
        description: item.description,
        acceptBoundary: Array.isArray(item.acceptBoundary) ? item.acceptBoundary : [],
        rejectBoundary: Array.isArray(item.rejectBoundary) ? item.rejectBoundary : [],
        example: Array.isArray(item.example) ? item.example : [],
      }));

      // 将弹窗内的能力与规范字段同步为外层所需 JSON 字段
      const abilityDescObj = {
        ability: '',
        constraints: '', // 不再使用单个 constraints 字段
        faqs: '', // 不再使用单个 faqs 字段
      };
      const roleObj = {
        roleAttributes: values?.roleAttributes || '',
        processingFlow: values?.processingFlow || '',
        personalityDimensions: values?.personalityDimensions || '',
        wordPreferences: values?.wordPreferences || '',
        sentenceAndTone: values?.sentenceAndTone || '',
        corePersonaDefinition: values?.corePersonaDefinition || '',
      };
      onOk(
        {
          ...values,
          corePersonaDefinition: values?.corePersonaDefinition || '',
          coreAbility: '',
          coreCompetencies,
          abilityDesc: JSON.stringify(abilityDescObj),
          role: JSON.stringify(roleObj),
        },
        myQuestionList
      );
    } catch (e) {
      console.error(e);
    }
  };

  const onRegenerate = (formValue, questionListValue) => {
    const { resourceName, resourceDesc, descText, role } = formValue;
    if (!mountedRef.current) return;
    setIsLoading(true);

    // 从外层表单获取能力描述和工作规范相关字段
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

    // 构建 relIds：从 skills 和 knowledgeBases 中提取 resourceId
    const relIds = [];
    skills.forEach((it) => {
      relIds.push(`${it.resourceId}`);
    });
    knowledgeBases.forEach((it) => {
      it.items.forEach((i) => {
        relIds.push(`${i.resourceId}`);
      });
    });

    const payload = {
      agentName: resourceName,
      agentDescription: resourceDesc,
      characterDescription: role,
      openingRemark: descText,
      commonQuestions: questionListValue.map((i) => i.infoContent).join('\n'),
      // 能力描述相关字段
      constraints: abilityBoundary || '',
      faqs: exampleQuestions || '',
      // 工作规范相关字段
      roleAttributes: roleAttributes || '',
      processingFlow: processingFlow || '',
      personalityDimensions: personalityDimensions || '',
      wordPreferences: wordPreferences || '',
      sentenceAndTone: sentenceAndTone || '',
      // 关联资源ID列表
      relIds,
      OptimizeTypeEnum: '', //  "AGENT_NAME",  "AGENT_DESCRIPTION",  "CHARACTER_DESCRIPTION",   "OPENING_REMARKS",  "COMMON_PROBLEM",  "RECOMMENDED_QUESTION"
    };

    POST('/byaiService/digitalEmployeeController/v2/generate', {
      ...payload,
    })
      .then((data) => {
        console.log('data', data);
        if (!mountedRef.current) return;

        const {
          agentDescription,
          characterDescription,
          commonQuestions,
          openingRemark,
          agentTags,
          // 新增字段（与外层一致，后端逐步支持）
          constraints,
          faqs,
          roleAttributes,
          processingFlow,
          personalityDimensions,
          wordPreferences,
          sentenceAndTone,
          coreCompetencies, // 结构化核心能力列表
          corePersonaDefinition,
        } = data || {};
        let arr = [];
        try {
          const [, test] = (agentTags || '').match(/.*(\[.*\]).*/);
          // eslint-disable-next-line no-eval
          arr = eval(test ?? '[]');
        } catch (error) {
          try {
            arr = JSON.parse(agentTags ?? '[]');
          } catch (error) {
            arr = [];
          }
        }

        const tagList = arr.map((it) => ({
          label: it,
          value: it,
        }));
        // 解析可能为代码块 JSON/数组/换行文本 → 统一为多行字符串
        const parseListLike = (v) => {
          if (Array.isArray(v)) return v;
          if (typeof v === 'string') {
            const m = v.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            const content = m ? m[1] : v;
            try {
              const arr = JSON.parse(content);
              if (Array.isArray(arr)) return arr;
            } catch (e) {
              // 解析失败，继续后续处理
            }
            return content
              .split(/\n+/)
              .map((s) => s.trim())
              .filter(Boolean);
          }
          return [];
        };
        const normalizeText = (v) => parseListLike(v).join('\n');

        // 处理 coreCompetencies 回显
        let parsedCoreAbilities = [];
        // 能力图标和颜色选项（与外层保持一致）
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
        if (coreCompetencies && Array.isArray(JSON.parse(coreCompetencies))) {
          parsedCoreAbilities = JSON.parse(coreCompetencies ?? '[]').map((item, index) => ({
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
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _constraintsText = normalizeText(constraints);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _faqsText = normalizeText(faqs);
        }

        setCoreAbilities(parsedCoreAbilities);

        myForm.setFieldsValue({
          resourceDesc: agentDescription,
          role: characterDescription,
          corePersonaDefinition,
          descText: openingRemark,
          tags: tagList?.map((it) => it.value),
          // 工作规范（可能后端暂未返回，先做兜底）
          roleAttributes: normalizeText(roleAttributes),
          processingFlow: normalizeText(processingFlow),
          personalityDimensions: normalizeText(personalityDimensions),
          wordPreferences: normalizeText(wordPreferences),
          sentenceAndTone: normalizeText(sentenceAndTone),
        });
        if (!mountedRef.current) return;
        setTags(tagList);
        // 兼容 commonQuestions 为代码块 JSON / 数组 / 换行字符串
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
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setIsLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    if (visible) {
      const v = form.getFieldsValue();
      myForm.setFieldsValue(v);
      setMyQuestionList(questionList);

      // 使用 setTimeout 确保在表单值更新后再获取
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
      loading={isLoading}
      destroyOnHidden
      centered
      maskClosable={false}
    >
      <div className={styles.refineModalContent}>
        {isLoading && <Spin spinning />}
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
