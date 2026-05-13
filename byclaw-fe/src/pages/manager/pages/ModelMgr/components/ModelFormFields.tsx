import { DownOutlined, EyeInvisibleOutlined, EyeOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Select, Slider, Space, Tag } from 'antd';
import React, { useMemo } from 'react';
import type { IntlShape } from 'react-intl';
import ModelFormSection from './ModelFormSection';
import { tokenMarks, normalizeModelType } from './modelFormUtils';
import styles from './ModelFormModal.module.less';

const { TextArea } = Input;

type Option = { label: string; value: string };

type Props = {
  intl: IntlShape;
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
  isDebugOnly: boolean;
  isSectionOpen: (key: string) => boolean;
  toggleSection: (key: string) => void;
  onValuesChange: (changedValues: any, allValues: any) => void;
};

const ModelFormFields: React.FC<Props> = ({
  intl,
  form,
  modalTitle,
  currentDisplayName,
  currentModelType,
  currentProviderName,
  currentContextTokens,
  currentSystems,
  currentAbilities,
  systemOptions,
  abilityOptions,
  modelTypeOptions,
  statusOptions,
  tokenVisible,
  setTokenVisible,
  isDebugOnly,
  isSectionOpen,
  toggleSection,
  onValuesChange,
}) => {
  const sectionGuideItems = useMemo(
    () => [
      { key: 'basic', icon: <RightOutlined />, label: intl.formatMessage({ id: 'modelMgr.modal.basicConfig' }) },
      {
        key: 'connection',
        icon: <RightOutlined />,
        label: intl.formatMessage({ id: 'modelMgr.modal.connectionSecurity' }),
      },
      { key: 'params', icon: <RightOutlined />, label: intl.formatMessage({ id: 'modelMgr.modal.paramConfig' }) },
      { key: 'tags', icon: <RightOutlined />, label: intl.formatMessage({ id: 'modelMgr.modal.tagConfig' }) },
    ],
    [intl]
  );

  return (
    <div className={styles.left}>
      <div className={styles.modalHero}>
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
      </div>

      <div className={styles.sectionGuide}>
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
      </div>

      <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
        <ModelFormSection
          title={intl.formatMessage({ id: 'modelMgr.modal.basicConfig' })}
          desc={intl.formatMessage({ id: 'modelMgr.modal.basicConfigDesc' })}
          open={isSectionOpen('basic')}
          onToggle={() => toggleSection('basic')}
        >
          <div className={styles.subsectionTitle}>{intl.formatMessage({ id: 'modelMgr.modal.identityGroup' })}</div>
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
              rules={[{ required: true, message: intl.formatMessage({ id: 'modelMgr.modal.modelCodePlaceholder' }) }]}
            >
              <Input placeholder="gpt-4-turbo-preview" maxLength={100} />
            </Form.Item>

            <Form.Item
              label={intl.formatMessage({ id: 'modelMgr.modal.modelType' })}
              name="modelType"
              rules={[{ required: true, message: intl.formatMessage({ id: 'modelMgr.modal.modelTypePlaceholder' }) }]}
            >
              <Select options={modelTypeOptions} />
            </Form.Item>
          </div>
        </ModelFormSection>

        <ModelFormSection
          title={intl.formatMessage({ id: 'modelMgr.modal.connectionSecurity' })}
          desc={intl.formatMessage({ id: 'modelMgr.modal.connectionSecurityDesc' })}
          open={isSectionOpen('connection')}
          onToggle={() => toggleSection('connection')}
        >
          <div className={styles.subsectionTitle}>{intl.formatMessage({ id: 'modelMgr.modal.endpointGroup' })}</div>
          <Form.Item
            label="API Endpoint"
            name="apiEndpoint"
            rules={[{ required: true, message: '请输入 API Endpoint' }]}
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>

          <Form.Item label="API Token" name="apiToken" rules={[{ required: true, message: '请输入 API Token' }]}>
            <Space.Compact style={{ width: '100%' }}>
              <Input type={tokenVisible ? 'text' : 'password'} placeholder="输入 API Token" style={{ flex: 1 }} />
              <Button type="default" onClick={() => setTokenVisible((v) => !v)}>
                <span style={{ cursor: 'pointer', userSelect: 'none' }}>
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
          </Form.Item>

          <div className={styles.subsectionTitle}>{intl.formatMessage({ id: 'modelMgr.modal.authGroup' })}</div>
          <Form.List name="headers">
            {(fields, { add, remove }) => (
              <>
                <div className={styles.hintBlock}>
                  <div className={styles.hintTitle}>Headers</div>
                  <div className={styles.hint}>{intl.formatMessage({ id: 'modelMgr.modal.headersDesc' })}</div>
                </div>
                {fields.map((field) => (
                  <div key={field.key} className={styles.headersRow}>
                    <Form.Item key={`header_key_${field.key}`} name={[field.name, 'key']} rules={[{ required: false }]}>
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
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.connectTimeoutSec' })} name="connectTimeoutSec">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.readTimeoutSec' })} name="readTimeoutSec">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.maxRetries' })} name="maxRetries">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.retryIntervalSec' })} name="retryIntervalSec">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </div>
        </ModelFormSection>

        <ModelFormSection
          title={intl.formatMessage({ id: 'modelMgr.modal.paramConfig' })}
          desc={intl.formatMessage({ id: 'modelMgr.modal.paramConfigDesc' })}
          open={isSectionOpen('params')}
          onToggle={() => toggleSection('params')}
        >
          <Form.Item
            label={intl.formatMessage({ id: 'modelMgr.modal.contextTokens' })}
            required
            tooltip="与列表中的上下文 tokens 一致"
          >
            <div className={styles.tokenRow}>
              <Form.Item
                name="contextTokens"
                noStyle
                rules={[
                  { required: true, message: intl.formatMessage({ id: 'modelMgr.modal.contextTokensPlaceholder' }) },
                ]}
              >
                <InputNumber min={1000} max={200000} step={1000} style={{ width: 140 }} />
              </Form.Item>
              <span className={styles.hint}>tokens</span>
              <div className={styles.sliderWrap}>
                <Form.Item shouldUpdate noStyle>
                  {() => {
                    const v = form.getFieldValue('contextTokens') || 128000;
                    return (
                      <Slider
                        min={1000}
                        max={200000}
                        step={1000}
                        marks={tokenMarks as any}
                        value={v}
                        onChange={(val) => form.setFieldsValue({ contextTokens: val })}
                      />
                    );
                  }}
                </Form.Item>
              </div>
            </div>
          </Form.Item>
          <div className={styles.hintBlock}>
            <div className={styles.hintTitle}>{intl.formatMessage({ id: 'modelMgr.modal.advancedParamTemplate' })}</div>
            <div className={styles.hint}>{intl.formatMessage({ id: 'modelMgr.modal.advancedParamDesc' })}</div>
          </div>
          <div className={styles.grid3}>
            <Form.Item label="Temperature" name="temperature">
              <InputNumber style={{ width: '100%' }} min={0} max={2} step={0.1} />
            </Form.Item>
            <Form.Item label="Top P" name="topP">
              <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} />
            </Form.Item>
            <Form.Item label="Max Tokens" name="maxTokens">
              <InputNumber style={{ width: '100%' }} min={1} />
            </Form.Item>
            <Form.Item label="Frequency Penalty" name="frequencyPenalty">
              <InputNumber style={{ width: '100%' }} min={-2} max={2} step={0.1} />
            </Form.Item>
            <Form.Item label="Presence Penalty" name="presencePenalty">
              <InputNumber style={{ width: '100%' }} min={-2} max={2} step={0.1} />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.provider' })} name="providerName">
              <Select
                placeholder="选择模型提供商"
                options={[
                  { label: 'OpenAI', value: 'OpenAI' },
                  { label: 'Anthropic', value: 'Anthropic' },
                  { label: 'Google', value: 'Google' },
                  { label: 'Meta', value: 'Meta' },
                  { label: 'Microsoft', value: 'Microsoft' },
                  { label: 'NVIDIA', value: 'NVIDIA' },
                  { label: 'Cohere', value: 'Cohere' },
                  { label: 'Mistral AI', value: 'Mistral AI' },
                  { label: '其他', value: '其他' },
                ]}
              />
            </Form.Item>

            <Form.Item label="更多参数" name="extends" style={{ gridColumn: 'span 3' }}>
              <TextArea placeholder="JSON格式的更多参数" rows={4} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </ModelFormSection>

        {!isDebugOnly ? (
          <ModelFormSection
            title={intl.formatMessage({ id: 'modelMgr.modal.tagConfig' })}
            desc={intl.formatMessage({ id: 'modelMgr.modal.tagConfigDesc' })}
            open={isSectionOpen('tags')}
            onToggle={() => toggleSection('tags')}
          >
            <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.systemTags' })} name="systems">
              <Select
                mode="tags"
                allowClear
                placeholder={intl.formatMessage({ id: 'modelMgr.modal.systemTagsPlaceholder' })}
                options={systemOptions}
                tokenSeparators={[',']}
              />
            </Form.Item>

            <div className={styles.grid2}>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.ability' })} name="abilities">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={intl.formatMessage({ id: 'modelMgr.modal.abilityPlaceholder' })}
                  options={abilityOptions}
                />
              </Form.Item>
              <Form.Item label={intl.formatMessage({ id: 'modelMgr.modal.status' })} name="status">
                <Select options={statusOptions} />
              </Form.Item>
            </div>
          </ModelFormSection>
        ) : null}
      </Form>
    </div>
  );
};

export default ModelFormFields;
