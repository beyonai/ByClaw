import { DownOutlined, EyeInvisibleOutlined, EyeOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Form, Input, InputNumber, Select, Slider, Space, Switch } from 'antd';
import React, { useMemo } from 'react';
import { trim } from 'lodash';
import { useIntl } from '@umijs/max';
import { getByParamGroupCode } from '@/pages/manager/service/System';
import ModelFormSection from './ModelFormSection';
import {
  tokenMarks,
  CONTEXT_TOKENS_CONFIG,
  MIN_CONTEXT_TOKENS,
  MIN_MAX_TOKENS,
  MODEL_PROTOCOL_OPTIONS,
  THINKING_CAPABILITY_OPTIONS,
  THINKING_COMPAT_FORMAT_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  getApiEndpointPlaceholder,
} from './modelFormUtils';
import styles from './ModelFormModal.module.less';
import {
  getImageGenerationProvider,
  getImageGenerationProviderByProtocol,
  IMAGE_GENERATION_PROVIDER_OPTIONS,
} from './imageGenerationProviders';
import VolcengineImageFields from './VolcengineImageFields';
import { isVolcengineImage, SEEDREAM_MODEL_PRESETS } from './volcengineImageConfig';
import { findModelFormPreset, getModelPresetLimits, MODEL_FORM_PRESETS } from './modelFormPresets';
import ModelPresetPicker from './ModelPresetPicker';

import {
  catalogProtocolOptions,
  providerParamGroup,
  registerProviderCatalog,
  ProviderLabel,
} from './mediaProviderCatalog';

const { TextArea } = Input;

type Option = { label: string; value: string };

type Props = {
  simplified?: boolean;
  canAutofill?: boolean;
  onPresetSelect?: (presetId: string) => void;
  presetId?: string;
  form: any;
  modalTitle: string;
  currentDisplayName?: string;
  currentModelType?: string;
  currentProviderName?: string;
  currentContextTokens?: number;
  currentSystems?: string[];
  currentAbilities?: string[];
  systemOptions: Option[];
  abilityOptions: Option[];
  modelTypeOptions: Option[];
  statusOptions: Option[];
  tokenVisible: boolean;
  setTokenVisible: React.Dispatch<React.SetStateAction<boolean>>;
  isSectionOpen: (key: string) => boolean;
  toggleSection: (key: string) => void;
  onValuesChange: (changedValues: any, allValues: any) => void;
};

const ApiTokenComp = (props: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  tokenVisible: boolean;
  setTokenVisible: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const { id, value, onChange, tokenVisible, setTokenVisible } = props;

  const intl = useIntl();

  return (
    <Space.Compact className={styles.apiTokenWrap}>
      <Input
        id={id}
        type={tokenVisible ? 'text' : 'password'}
        placeholder={intl.formatMessage({ id: 'modelMgr.modal.apiTokenPlaceholder' })}
        className={styles.apiTokenInput}
        value={value}
        onChange={(e) => {
          onChange?.(trim(e.target.value));
        }}
        disabled={!tokenVisible}
      />
      <Button type="default" onClick={() => setTokenVisible((v) => !v)}>
        <span className={styles.clickable}>
          {tokenVisible ? (
            <Space size={4}>
              <EyeInvisibleOutlined />
              {intl.formatMessage({ id: 'modelMgr.modal.hide' })}
            </Space>
          ) : (
            <Space size={4}>
              <EyeOutlined />
              {intl.formatMessage({ id: 'modelMgr.modal.view' })}
            </Space>
          )}
        </span>
      </Button>
    </Space.Compact>
  );
};

const ModelFormFields: React.FC<Props> = ({
  simplified = false,
  canAutofill = false,
  onPresetSelect,
  presetId,
  form,
  // modalTitle,
  // currentDisplayName,
  // currentModelType,
  // currentProviderName,
  // currentContextTokens,
  // currentSystems,
  // currentAbilities,
  systemOptions,
  abilityOptions,
  modelTypeOptions,
  statusOptions,
  tokenVisible,
  setTokenVisible,
  isSectionOpen,
  toggleSection,
  onValuesChange,
}) => {
  const intl = useIntl();
  const currentModelProtocol = Form.useWatch('modelProtocol', form);
  const currentModelType = Form.useWatch('modelType', form);
  const currentModelCode = Form.useWatch('modelCode', form);
  const currentPreset = findModelFormPreset(currentModelCode, presetId);
  const currentApiEndpoint = Form.useWatch('apiEndpoint', form);
  const presetValues = {
    modelCode: currentModelCode,
    modelType: currentModelType,
    modelProtocol: currentModelProtocol,
    apiEndpoint: currentApiEndpoint,
  };
  const presetLimits = simplified ? getModelPresetLimits(presetValues, presetId) : undefined;
  const isVolcengine = isVolcengineImage({ modelType: currentModelType, modelProtocol: currentModelProtocol });
  const reasoningConfig = Form.useWatch('reasoningConfig', form) || {};
  const apiEndpointPlaceholder = useMemo(() => getApiEndpointPlaceholder(currentModelProtocol), [currentModelProtocol]);
  const isLlmModel = `${currentModelType ?? 'LLM'}`.trim().toUpperCase() === 'LLM';
  const isAudioModel = ['ASR', 'TTS'].includes(`${currentModelType || ''}`.toUpperCase());
  const isImageGenerationModel = `${currentModelType ?? 'LLM'}`.trim().toUpperCase() === 'IMAGE_GENERATION';
  let legacyProtocolOptions: Option[] = [...MODEL_PROTOCOL_OPTIONS].filter(
    (item) =>
      item.value !== 'MINIMAX_IMAGE' && (item.value !== 'Volcengine Multimodal' || currentModelType === 'EMBEDDING')
  );
  if (isImageGenerationModel) {
    legacyProtocolOptions = [
      ...IMAGE_GENERATION_PROVIDER_OPTIONS.map((item) => {
        const provider = getImageGenerationProvider(item.value);
        return { label: provider?.label || item.label, value: provider?.modelProtocol || item.value };
      }),
      { label: 'Qwen', value: 'Qwen' },
    ];
  }
  const defaultProviderOptions = useMemo(
    () => [
      { label: 'OpenAI', value: 'OpenAI' },
      { label: 'Anthropic', value: 'Anthropic' },
      { label: 'Qwen', value: 'Qwen' },
      { label: 'DeepSeek', value: 'DeepSeek' },
      { label: 'OpenRouter', value: 'OpenRouter' },
      { label: 'Together', value: 'Together' },
      { label: 'ZAI', value: 'ZAI' },
      { label: 'MINIMAX', value: 'MINIMAX' },
      { label: 'APK', value: 'APK' },
    ],
    []
  );
  const [systemProviderOptions, setSystemProviderOptions] = React.useState<Option[]>(defaultProviderOptions);
  const isEnglish = intl.locale?.toLowerCase().includes('en');

  React.useEffect(() => {
    let cancelled = false;
    const modelType = `${currentModelType || 'LLM'}`.trim().toUpperCase();
    let fallbackOptions: Option[] = [];
    if (modelType === 'IMAGE_GENERATION') fallbackOptions = IMAGE_GENERATION_PROVIDER_OPTIONS;
    else if (['LLM', 'RERANK', 'EMBEDDING'].includes(modelType)) fallbackOptions = defaultProviderOptions;
    setSystemProviderOptions(fallbackOptions);
    const paramGroupCode = providerParamGroup(modelType);
    getByParamGroupCode({ paramGroupCode })
      .then((res: any) => {
        if (cancelled) return;
        const list = res?.data?.byaiSystemConfigLists;
        if (Array.isArray(list)) registerProviderCatalog(modelType, list);
        const options: Option[] = [];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (typeof item?.paramValue !== 'string' || !item.paramValue.trim()) continue;
            options.push({
              label:
                (isEnglish ? item.paramEnName || item.paramName : item.paramName || item.paramEnName) ||
                item.paramValue,
              value: item.paramValue,
            });
          }
        }
        setSystemProviderOptions(options.length ? options : fallbackOptions);
      })
      .catch(() => {
        if (!cancelled) setSystemProviderOptions(fallbackOptions);
      });
    return () => {
      cancelled = true;
    };
  }, [currentModelType, defaultProviderOptions, isEnglish]);

  const typeKey = `${currentModelType || 'LLM'}`.trim().toUpperCase();
  const providerOptions = systemProviderOptions.map((item) => ({
    ...item,
    label: <ProviderLabel type={typeKey} provider={item.value} name={item.label} />,
  }));
  const pluginProtocols = catalogProtocolOptions(typeKey);
  const modelProtocolOptions = pluginProtocols.length ? pluginProtocols : isAudioModel ? [] : legacyProtocolOptions;
  const reasoningEnabled = Boolean(reasoningConfig?.enabled);
  const reasoningCapability = `${reasoningConfig?.capability ?? 'unsupported'}`;
  const thinkingLevelOptions = THINKING_LEVEL_OPTIONS.map((value) => ({ label: value, value }));
  const supportedThinkingLevelOptions = THINKING_LEVEL_OPTIONS.filter((value) => value !== 'off').map((value) => ({
    label: value,
    value,
  }));
  const thinkingCapabilityOptions = THINKING_CAPABILITY_OPTIONS.map((value) => ({
    label: intl.formatMessage({ id: `modelMgr.modal.reasoningCapability.${value}` }),
    value,
  }));
  const thinkingCompatFormatOptions = THINKING_COMPAT_FORMAT_OPTIONS.map((value) => ({
    label: value === 'bailian' ? intl.formatMessage({ id: 'modelMgr.modal.reasoningCompatFormat.bailian' }) : value,
    value,
  }));
  // const sectionGuideItems = useMemo(
  //   () => [
  //     { key: 'basic', icon: <RightOutlined />, label: intl.formatMessage({ id: 'modelMgr.modal.basicConfig' }) },
  //     {
  //       key: 'more',
  //       icon: <RightOutlined />,
  //       label: intl.formatMessage({ id: 'modelMgr.modal.moreConfig' }),
  //     },
  //   ],
  //   [intl]
  // );

  return (
    <div className={styles.left}>
      {/* <div className={styles.modalHero}>
        <div className={styles.modalHeroMain}>
          <div className={styles.modalHeroTitle}>{currentDisplayName || modalTitle}</div>
          <div className={styles.modalHeroDesc}>{intl.formatMessage({ id: 'modelMgr.modal.heroDesc' })}</div>
        </div>
        <div className={styles.modalHeroStats}>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{intl.formatMessage({ id: 'modelMgr.modal.modelType' })}</div>
            <div className={styles.heroStatValue}>{normalizeModelType(currentModelType)}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{intl.formatMessage({ id: 'modelMgr.modal.provider' })}</div>
            <div className={styles.heroStatValue}>{currentProviderName || '-'}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{intl.formatMessage({ id: 'modelMgr.modal.contextTokens' })}</div>
            <div className={styles.heroStatValue}>{currentContextTokens ? `${currentContextTokens}` : '-'}</div>
          </div>
        </div>
        <div className={styles.heroTags}>
          {(Array.isArray(currentSystems) ? currentSystems : []).map((item: string) => (
            <Tag key={`system_${item}`} className={styles.heroTag}>
              {systemOptions.find((opt) => opt.value === item)?.label || item}
            </Tag>
          ))}
          {(Array.isArray(currentAbilities) ? currentAbilities : []).map((item: string) => (
            <Tag key={`ability_${item}`} className={styles.heroTag}>
              {abilityOptions.find((opt) => opt.value === item)?.label || item}
            </Tag>
          ))}
        </div>
      </div> */}

      {/* <div className={styles.sectionGuide}>
        {sectionGuideItems.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={styles.sectionGuideItem}
            onClick={() => toggleSection(item.key)}
          >
            <span className={styles.sectionGuideIndex}>{index + 1}</span>
            <span className={styles.sectionGuideIcon}>{item.icon}</span>
            <span className={styles.sectionGuideLabel}>{item.label}</span>
            <span className={styles.sectionGuideArrow}>
              {isSectionOpen(item.key) ? <DownOutlined /> : <RightOutlined />}
            </span>
          </button>
        ))}
      </div> */}

      <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
        <ModelFormSection
          title={intl.formatMessage({ id: 'modelMgr.modal.basicConfig' })}
          desc={intl.formatMessage({ id: 'modelMgr.modal.basicConfigDesc' })}
          open={isSectionOpen('basic')}
          onToggle={() => toggleSection('basic')}
        >
          {canAutofill ? (
            <>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.quickPreset' })}>
                <ModelPresetPicker onSelect={onPresetSelect} />
              </Form.Item>
              {/* 仅在需要确认实际配置或模板使用限制时展示说明，普通模板不额外占用提示区域。 */}
              {currentModelCode && (!currentPreset || currentPreset.noticeId) ? (
                <div className={styles.hintBlock} role="status">
                  {intl.formatMessage({
                    id: currentPreset?.noticeId || 'modelMgr.modal.unknownModelHint',
                  })}
                </div>
              ) : null}
            </>
          ) : null}
          <div className={styles.grid3}>
            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.displayName' })}
              name="displayName"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'modelMgr.modal.displayNamePlaceholder' }),
                },
              ]}
            >
              <Input placeholder="GPT-4 Turbo" maxLength={50} />
            </Form.Item>

            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.modelCode' })}
              name="modelCode"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'modelMgr.modal.modelCodePlaceholder' }),
                },
              ]}
            >
              {canAutofill ? (
                <AutoComplete
                  options={[...new Set(MODEL_FORM_PRESETS.map((preset) => preset.values.modelCode))]
                    .sort(new Intl.Collator(intl.locale, { numeric: true, sensitivity: 'base' }).compare)
                    .map((value) => ({ value }))}
                  filterOption={(input, option) => `${option?.value}`.toLowerCase().includes(input.toLowerCase())}
                  placeholder={intl.formatMessage({ id: 'modelMgr.modal.modelCodePlaceholder' })}
                >
                  <Input maxLength={100} />
                </AutoComplete>
              ) : isVolcengine ? (
                <AutoComplete
                  options={SEEDREAM_MODEL_PRESETS.map((value) => ({ value }))}
                  placeholder={intl.formatMessage({ id: 'modelMgr.modal.seedreamModelPlaceholder' })}
                >
                  <Input maxLength={100} />
                </AutoComplete>
              ) : (
                <Input
                  placeholder={
                    isImageGenerationModel
                      ? intl.formatMessage({ id: 'modelMgr.modal.modelCodePlaceholder' })
                      : 'gpt-4-turbo-preview'
                  }
                  maxLength={100}
                />
              )}
            </Form.Item>

            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.modelType' })}
              name="modelType"
              rules={[{ required: true, message: intl.formatMessage({ id: 'modelMgr.modal.modelTypePlaceholder' }) }]}
            >
              <Select options={modelTypeOptions} />
            </Form.Item>
          </div>
          {/* 必填凭证直接展示，应用配置集中放在下方可展开的更多基本信息中。 */}
          <Form.Item
            label={intl.formatMessage({ id: 'modelMgr.modal.apiToken' })}
            name="apiToken"
            rules={[{ required: true, message: intl.formatMessage({ id: 'modelMgr.modal.apiTokenRequired' }) }]}
          >
            <ApiTokenComp tokenVisible={tokenVisible} setTokenVisible={setTokenVisible} />
          </Form.Item>
          {/* 可选配置入口用右箭头表示收起、下箭头表示展开，与内容显隐共用状态。 */}
          {simplified ? (
            <Button
              type="link"
              className={styles.basicExtraToggle}
              icon={isSectionOpen('basicExtra') ? <DownOutlined aria-hidden /> : <RightOutlined aria-hidden />}
              onClick={() => toggleSection('basicExtra')}
              aria-expanded={isSectionOpen('basicExtra')}
            >
              {intl.formatMessage({ id: 'modelMgr.modal.moreBasicSettings' })}
            </Button>
          ) : null}
          <div hidden={simplified && !isSectionOpen('basicExtra')}>
            <div className={styles.grid2}>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.ability' })} name="abilities">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={intl.formatMessage({ id: 'modelMgr.modal.abilityPlaceholder' })}
                  options={abilityOptions.filter((item) => item.value !== '1')}
                />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.status' })} name="status">
                <Select options={statusOptions} />
              </Form.Item>
            </div>
            {/* 系统归属属于模型基础信息，与名称、型号和类型集中配置。 */}
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.systemTags' })} name="systems">
              <Select
                mode="tags"
                allowClear
                placeholder={intl.formatMessage({ id: 'modelMgr.modal.systemTagsPlaceholder' })}
                options={systemOptions}
                tokenSeparators={[',']}
              />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.applicabilityScope' })}
              name="applicabilityScope"
            >
              <TextArea
                placeholder={intl.formatMessage({ id: 'modelMgr.modal.applicabilityScopePlaceholder' })}
                rows={3}
              />
            </Form.Item>
          </div>
        </ModelFormSection>

        <ModelFormSection
          title={intl.formatMessage({ id: 'modelMgr.modal.moreConfig' })}
          desc={intl.formatMessage({ id: 'modelMgr.modal.moreConfigDesc' })}
          open={isSectionOpen('more')}
          onToggle={() => toggleSection('more')}
        >
          <div className={styles.subsectionTitle}>{intl.formatMessage({ id: 'modelMgr.modal.endpointGroup' })}</div>
          <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.modelProtocol' })} name="modelProtocol">
            <Select
              allowClear
              placeholder={intl.formatMessage({ id: 'modelMgr.modal.modelProtocolPlaceholder' })}
              options={modelProtocolOptions}
            />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'modelMgr.modal.apiEndpoint' })}
            name="apiEndpoint"
            rules={[{ required: true, message: intl.formatMessage({ id: 'modelMgr.modal.apiEndpointRequired' }) }]}
          >
            <Input placeholder={apiEndpointPlaceholder} />
          </Form.Item>

          <div>
            <div className={styles.subsectionTitle}>{intl.formatMessage({ id: 'modelMgr.modal.authGroup' })}</div>
            <Form.List name="headers">
              {(fields, { add, remove }) => (
                <>
                  <div className={styles.hintBlock}>
                    <div className={styles.hintTitle}>{intl.formatMessage({ id: 'modelMgr.modal.headers' })}</div>
                    <div className={styles.hint}>{intl.formatMessage({ id: 'modelMgr.modal.headersDesc' })}</div>
                  </div>
                  {fields.map((field) => (
                    <div key={field.key} className={styles.headersRow}>
                      <Form.Item
                        key={`header_key_${field.key}`}
                        name={[field.name, 'key']}
                        rules={[{ required: false }]}
                      >
                        <Input placeholder={intl.formatMessage({ id: 'form.input' })} />
                      </Form.Item>
                      <Form.Item
                        key={`header_value_${field.key}`}
                        name={[field.name, 'value']}
                        rules={[{ required: false }]}
                      >
                        <Input placeholder={intl.formatMessage({ id: 'form.input' })} />
                      </Form.Item>
                      <div className={styles.headersAction}>
                        <Button size="small" type="link" onClick={() => remove(field.name)}>
                          {intl.formatMessage({ id: 'common.delete' })}
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className={styles.headersAdd} onClick={() => add({ key: '', value: '' })}>
                    <PlusOutlined />
                    <span>{intl.formatMessage({ id: 'modelMgr.modal.addHeader' })}</span>
                  </div>
                </>
              )}
            </Form.List>

            <div className={styles.grid2}>
              <Form.Item
                label={intl.formatMessage({ id: 'modelMgr.modal.connectTimeoutSec' })}
                name="connectTimeoutSec"
              >
                <InputNumber className={styles.fullWidth} min={0} />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.readTimeoutSec' })} name="readTimeoutSec">
                <InputNumber className={styles.fullWidth} min={0} />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.maxRetries' })} name="maxRetries">
                <InputNumber className={styles.fullWidth} min={0} />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.retryIntervalSec' })} name="retryIntervalSec">
                <InputNumber className={styles.fullWidth} min={0} />
              </Form.Item>
            </div>
          </div>
          <div className={styles.subsectionTitle}>{intl.formatMessage({ id: 'modelMgr.modal.paramConfig' })}</div>
          <div className={styles.hintBlock}>
            {intl.formatMessage({
              id: simplified ? 'modelMgr.modal.automaticParamsHint' : 'modelMgr.modal.paramConfigDesc',
            })}
          </div>
          {!isImageGenerationModel && !isAudioModel ? (
            <>
              <Form.Item
                label={intl.formatMessage({ id: 'modelMgr.modal.contextTokens' })}
                htmlFor="contextTokens"
                required
                tooltip={intl.formatMessage({ id: 'modelMgr.modal.contextTokensTooltip' })}
              >
                <div className={styles.tokenRow}>
                  <Form.Item
                    name="contextTokens"
                    noStyle
                    rules={[
                      {
                        required: true,
                        message: intl.formatMessage({ id: 'modelMgr.modal.contextTokensPlaceholder' }),
                      },
                      {
                        type: 'integer',
                        min: MIN_CONTEXT_TOKENS,
                        message: intl.formatMessage(
                          { id: 'modelMgr.modal.contextTokensMin' },
                          { min: MIN_CONTEXT_TOKENS.toLocaleString() }
                        ),
                      },
                      {
                        type: 'integer',
                        max: presetLimits?.contextTokens,
                        message: intl.formatMessage(
                          { id: 'modelMgr.modal.contextTokensMax' },
                          { max: presetLimits?.contextTokens }
                        ),
                      },
                    ]}
                  >
                    <InputNumber min={MIN_CONTEXT_TOKENS} precision={0} className={styles.tokenInput} />
                  </Form.Item>
                  <span className={styles.hint}>tokens</span>
                  <div className={styles.sliderWrap}>
                    <Form.Item shouldUpdate noStyle>
                      {() => {
                        const v = form.getFieldValue('contextTokens');
                        return (
                          <Slider
                            {...CONTEXT_TOKENS_CONFIG}
                            marks={tokenMarks as any}
                            disabled={!v}
                            value={v || MIN_CONTEXT_TOKENS}
                            onChange={(val) => {
                              form.setFieldsValue({ contextTokens: val });
                              // 滑块也属于手动修改，必须通知自动填充入口保护该值。
                              if (simplified) onValuesChange({ contextTokens: val }, form.getFieldsValue(true));
                            }}
                          />
                        );
                      }}
                    </Form.Item>
                  </div>
                </div>
              </Form.Item>
              <div className={styles.hintBlock}>
                <div className={styles.hintTitle}>
                  {intl.formatMessage({ id: 'modelMgr.modal.advancedParamTemplate' })}
                </div>
                <div className={styles.hint}>{intl.formatMessage({ id: 'modelMgr.modal.advancedParamDesc' })}</div>
              </div>
            </>
          ) : null}
          <div className={styles.grid3}>
            {isImageGenerationModel ? (
              <>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.imagePrompt' })}
                  name="prompt"
                  className={styles.gridColSpan3}
                >
                  <TextArea
                    placeholder={intl.formatMessage({ id: 'modelMgr.modal.imagePromptPlaceholder' })}
                    rows={3}
                  />
                </Form.Item>
                {isVolcengine ? (
                  <VolcengineImageFields modelCode={currentModelCode} />
                ) : ['BAILIAN_IMAGE', 'TOKENHUB_IMAGE'].includes(currentModelProtocol) ? null : (
                  <>
                    <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.aspectRatio' })} name="aspectRatio">
                      <Select
                        options={['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'].map((value) => ({
                          label: value,
                          value,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.imageCount' })} name="imageCount">
                      <InputNumber className={styles.fullWidth} min={1} max={9} precision={0} />
                    </Form.Item>
                    <Form.Item
                      label={intl.formatMessage({ id: 'modelMgr.modal.responseFormat' })}
                      name="responseFormat"
                    >
                      <Select
                        options={[
                          { label: 'URL', value: 'url' },
                          { label: 'Base64', value: 'base64' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      label={intl.formatMessage({ id: 'modelMgr.modal.promptOptimizer' })}
                      name="promptOptimizer"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                  </>
                )}
              </>
            ) : !isAudioModel && (!simplified || isLlmModel) ? (
              <>
                <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.temperature' })} name="temperature">
                  <InputNumber className={styles.fullWidth} min={0} max={2} step={0.1} />
                </Form.Item>
                <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.topP' })} name="topP">
                  <InputNumber className={styles.fullWidth} min={0} max={1} step={0.05} />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.maxTokens' })}
                  name="maxTokens"
                  rules={[
                    {
                      type: 'integer',
                      min: MIN_MAX_TOKENS,
                      message: intl.formatMessage(
                        { id: 'modelMgr.modal.maxTokensMin' },
                        { min: MIN_MAX_TOKENS.toLocaleString() }
                      ),
                    },
                    {
                      type: 'integer',
                      max: presetLimits?.maxTokens,
                      message: intl.formatMessage(
                        { id: 'modelMgr.modal.outputTokensMax' },
                        { max: presetLimits?.maxTokens }
                      ),
                    },
                  ]}
                >
                  <InputNumber className={styles.fullWidth} min={MIN_MAX_TOKENS} precision={0} />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.frequencyPenalty' })}
                  name="frequencyPenalty"
                >
                  <InputNumber className={styles.fullWidth} min={-2} max={2} step={0.1} />
                </Form.Item>
                <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.presencePenalty' })} name="presencePenalty">
                  <InputNumber className={styles.fullWidth} min={-2} max={2} step={0.1} />
                </Form.Item>
              </>
            ) : null}
            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.provider' })}
              name="providerName"
              dependencies={['modelType', 'modelProtocol']}
              extra={intl.formatMessage({
                id: isImageGenerationModel ? 'modelMgr.modal.imageProviderHint' : 'modelMgr.modal.providerOptionalHint',
              })}
              rules={[
                {
                  required: isImageGenerationModel && !getImageGenerationProviderByProtocol(currentModelProtocol),
                  whitespace: true,
                  message: intl.formatMessage({ id: 'modelMgr.modal.imageProviderRequired' }),
                },
              ]}
            >
              <Select
                allowClear
                placeholder={intl.formatMessage({ id: 'modelMgr.modal.providerPlaceholder' })}
                options={providerOptions}
              />
            </Form.Item>
            {isLlmModel ? (
              <>
                <div className={`${styles.hintBlock} ${styles.gridColSpan3}`}>
                  <div className={styles.hintTitle}>{intl.formatMessage({ id: 'modelMgr.modal.reasoningTitle' })}</div>
                  <div className={styles.hint}>{intl.formatMessage({ id: 'modelMgr.modal.reasoningDesc' })}</div>
                </div>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.reasoningEnabled' })}
                  name={['reasoningConfig', 'enabled']}
                  valuePropName="checked"
                >
                  <Switch
                    onChange={(checked) => {
                      // 新增表单由统一变更入口同步 Thinking 默认程度和调试参数。
                      if (simplified) return;
                      if (!checked) {
                        form.setFieldsValue({
                          reasoningConfig: {
                            ...reasoningConfig,
                            enabled: false,
                            defaultLevel: 'off',
                          },
                        });
                        return;
                      }
                      if (reasoningCapability === 'unsupported') {
                        form.setFieldsValue({
                          reasoningConfig: {
                            ...reasoningConfig,
                            enabled: true,
                            capability: 'effort',
                            defaultLevel: 'medium',
                          },
                        });
                      }
                    }}
                  />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.reasoningCapability' })}
                  name={['reasoningConfig', 'capability']}
                >
                  <Select options={thinkingCapabilityOptions} />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.reasoningDefaultLevel' })}
                  name={['reasoningConfig', 'defaultLevel']}
                >
                  <Select disabled={!reasoningEnabled} options={thinkingLevelOptions} />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.reasoningCompatFormat' })}
                  name={['reasoningConfig', 'compatFormat']}
                >
                  <Select disabled={!reasoningEnabled} options={thinkingCompatFormatOptions} />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.reasoningSupportedEfforts' })}
                  name={['reasoningConfig', 'supportedEfforts']}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    disabled={!reasoningEnabled}
                    options={supportedThinkingLevelOptions}
                  />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: 'modelMgr.modal.reasoningEffortMap' })}
                  name="reasoningEffortMapText"
                  className={styles.gridColSpan3}
                >
                  <TextArea
                    disabled={!reasoningEnabled}
                    placeholder='{"minimal":"high","xhigh":"max","max":"max"}'
                    rows={3}
                  />
                </Form.Item>
                {reasoningCapability === 'budget' ? (
                  <>
                    <Form.Item label="minimal budget" name={['reasoningConfig', 'budgets', 'minimal']}>
                      <InputNumber disabled={!reasoningEnabled} className={styles.fullWidth} min={1} />
                    </Form.Item>
                    <Form.Item label="low budget" name={['reasoningConfig', 'budgets', 'low']}>
                      <InputNumber disabled={!reasoningEnabled} className={styles.fullWidth} min={1} />
                    </Form.Item>
                    <Form.Item label="medium budget" name={['reasoningConfig', 'budgets', 'medium']}>
                      <InputNumber disabled={!reasoningEnabled} className={styles.fullWidth} min={1} />
                    </Form.Item>
                    <Form.Item label="high budget" name={['reasoningConfig', 'budgets', 'high']}>
                      <InputNumber disabled={!reasoningEnabled} className={styles.fullWidth} min={1} />
                    </Form.Item>
                    <Form.Item label="max budget" name={['reasoningConfig', 'budgets', 'max']}>
                      <InputNumber disabled={!reasoningEnabled} className={styles.fullWidth} min={1} />
                    </Form.Item>
                  </>
                ) : null}
              </>
            ) : null}
            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.extendParam' })}
              name="extendParam"
              className={styles.gridColSpan3}
            >
              <TextArea
                placeholder={intl.formatMessage({ id: 'modelMgr.modal.extendParamPlaceholder' })}
                rows={4}
                className={styles.fullWidth}
              />
            </Form.Item>
          </div>
        </ModelFormSection>
      </Form>
    </div>
  );
};

export default ModelFormFields;
