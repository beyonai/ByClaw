// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, List, Button, Space, message } from 'antd';
import { useIntl } from '@umijs/max';
import styles from './ExampleModal.module.less';
import { getDcSystemConfigListByStandType } from '@/pages/manager/service/DigitalEmployeeMgr';

const ExampleModal = ({ open, onClose, onInsert, standType = 'DIGITAL_EMPLOYEE_TEMPLATE' }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);
  const [activeId, setActiveId] = useState();

  const active = useMemo(() => list.find((i) => i.id === activeId), [list, activeId]);

  useEffect(() => {
    if (!open) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await getDcSystemConfigListByStandType({ standType });
        if (res?.code === 0 && Array.isArray(res?.data)) {
          setList(res.data || []);
          setActiveId(res.data?.[0]?.id);
        } else {
          message.error(res?.msg || intl.formatMessage({ id: 'employeeDetail.getTemplateFail' }));
          setList([]);
          setActiveId(undefined);
        }
      } catch (e) {
        message.error(intl.formatMessage({ id: 'employeeDetail.getTemplateFail' }));
        setList([]);
        setActiveId(undefined);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [open, standType]);

  const parseStandCode = (code) => {
    if (!code) return {};
    try {
      return JSON.parse(code);
    } catch {
      return {};
    }
  };

  return (
    <Modal
      title={<span className={styles.modalTitle}>{intl.formatMessage({ id: 'employeeDetail.exampleLibrary' })}</span>}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
          <Button type="primary" onClick={() => onInsert?.(active)}>
            {intl.formatMessage({ id: 'employeeDetail.insertPrompt' })}
          </Button>
        </Space>
      }
      width={880}
      centered
      bodyStyle={{ padding: '0 20px 0 24px', overflow: 'auto' }}
      className={styles.exampleModal}
      destroyOnHidden
      maskClosable
    >
      <div className={styles.container}>
        <div className={styles.leftPane}>
          <List
            dataSource={list}
            loading={loading}
            renderItem={(item) => (
              <List.Item
                className={item.id === activeId ? styles.activeItem : styles.listItem}
                onClick={() => setActiveId(item.id)}
              >
                <div className={styles.itemTitle} title={item.standDisplayValue}>
                  {item.standDisplayValue}
                </div>
                <div className={styles.itemSub} title={item.standDesc}>
                  {item.standDesc}
                </div>
              </List.Item>
            )}
          />
        </div>
        <div className={styles.rightPane}>
          {active ? (
            (() => {
              const data = parseStandCode(active.standCode);

              // 统一解析 coreCompetencies：支持字符串或数组
              let coreCompetencies = [];
              const { coreCompetencies: rawCoreCompetencies } = data;
              if (Array.isArray(rawCoreCompetencies)) {
                coreCompetencies = rawCoreCompetencies;
              } else if (typeof rawCoreCompetencies === 'string') {
                try {
                  const parsed = JSON.parse(rawCoreCompetencies);
                  if (Array.isArray(parsed)) coreCompetencies = parsed;
                } catch {
                  coreCompetencies = [];
                }
              }

              // 旧版字段兜底
              const ability = Array.isArray(data.ability) ? data.ability : data.ability ? [data.ability] : [];
              const faqs = Array.isArray(data.faqs) ? data.faqs : data.faqs ? [data.faqs] : [];

              return (
                <>
                  <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                      {intl.formatMessage({ id: 'employeeDetail.abilityDescription' })}
                    </div>
                    <div className={styles.sectionBody}>
                      {coreCompetencies.length > 0 ? (
                        coreCompetencies.map(
                          ({ coreCompetency, description, acceptBoundary, rejectBoundary, example }, index) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <div key={index} className={styles.block}>
                              <div className={styles.blockTitle}>
                                <span className={styles.tagTitle}>
                                  {intl.formatMessage(
                                    { id: 'employeeDetail.coreAbilityWithIndex' },
                                    { index: index + 1 }
                                  )}
                                </span>
                                <span className={styles.abilityName}>{coreCompetency}</span>
                              </div>
                              <div className={styles.textArea}>{description || ''}</div>

                              {Array.isArray(acceptBoundary) && acceptBoundary.length > 0 && (
                                <div className={styles.subBlock}>
                                  <div className={styles.subBlockTitle}>
                                    {intl.formatMessage({ id: 'employeeDetail.acceptableRange' })}
                                  </div>
                                  <div className={styles.textArea}>{acceptBoundary.join('；')}</div>
                                </div>
                              )}

                              {Array.isArray(rejectBoundary) && rejectBoundary.length > 0 && (
                                <div className={styles.subBlock}>
                                  <div className={styles.subBlockTitle}>
                                    {intl.formatMessage({ id: 'employeeDetail.unacceptableRange' })}
                                  </div>
                                  <div className={styles.textArea}>{rejectBoundary.join('；')}</div>
                                </div>
                              )}

                              {Array.isArray(example) && example.length > 0 && (
                                <div className={styles.subBlock}>
                                  <div className={styles.subBlockTitle}>
                                    {intl.formatMessage({ id: 'employeeDetail.exampleQuestionLabel' })}
                                  </div>
                                  <div className={styles.textArea}>{example.join('；')}</div>
                                </div>
                              )}
                            </div>
                          )
                        )
                      ) : (
                        <>
                          <div className={styles.block}>
                            <div className={styles.blockTitle}>
                              <span className={styles.tagTitle}>
                                {intl.formatMessage({ id: 'employeeDetail.coreAbilityRequired' })}
                              </span>
                            </div>
                            <div className={styles.textArea}>{ability.join('；')}</div>
                          </div>
                          <div className={styles.block}>
                            <div className={styles.blockTitle}>
                              <span className={styles.tagTitle}>
                                {intl.formatMessage({ id: 'employeeDetail.abilityBoundaryRequired' })}
                              </span>
                            </div>
                            <div className={styles.textArea}>{data.constraints || ''}</div>
                          </div>
                          <div className={styles.block}>
                            <div className={styles.blockTitle}>
                              <span className={styles.tagTitle}>
                                {intl.formatMessage({ id: 'employeeDetail.exampleQuestionRequired' })}
                              </span>
                            </div>
                            <div className={styles.textArea}>{faqs.join('；')}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={styles.sectionBox}>
                    <div className={styles.sectionHeader}>
                      {intl.formatMessage({ id: 'employeeDetail.workStandardLabel' })}
                    </div>
                    <div className={styles.sectionBody}>
                      <div className={styles.block}>
                        <div className={styles.blockTitle}>
                          <span className={styles.tagTitle}>
                            {intl.formatMessage({ id: 'employeeDetail.roleAttributes' })}
                          </span>
                        </div>
                        <div className={styles.textArea}>{data.roleAttributes || ''}</div>
                      </div>

                      <div className={styles.block}>
                        <div className={styles.blockTitle}>
                          <span className={styles.tagTitle}>
                            {intl.formatMessage({ id: 'employeeDetail.processingFlow' })}
                          </span>
                        </div>
                        <div className={styles.textArea}>{data.processingFlow || ''}</div>
                      </div>

                      <div className={styles.block}>
                        <div className={styles.blockTitle}>
                          <span className={styles.tagTitle}>
                            {intl.formatMessage({ id: 'employeeDetail.personalityDimensions' })}
                          </span>
                        </div>
                        <div className={styles.textArea}>{data.personalityDimensions || ''}</div>
                      </div>

                      <div className={styles.block}>
                        <div className={styles.blockTitle}>
                          <span className={styles.tagTitle}>
                            {intl.formatMessage({ id: 'employeeDetail.personalityDefinition' })}
                          </span>
                        </div>
                        <div className={styles.textArea}>
                          {data.corePersonaDefinition || data.personalityDefinition || ''}
                        </div>
                      </div>

                      <div className={styles.block}>
                        <div className={styles.blockTitle}>
                          <span className={styles.tagTitle}>
                            {intl.formatMessage({ id: 'employeeDetail.wordPreferences' })}
                          </span>
                        </div>
                        <div className={styles.textArea}>{data.wordPreferences || ''}</div>
                      </div>

                      <div className={styles.block}>
                        <div className={styles.blockTitle}>
                          <span className={styles.tagTitle}>
                            {intl.formatMessage({ id: 'employeeDetail.sentenceAndTone' })}
                          </span>
                        </div>
                        <div className={styles.textArea}>{data.sentenceAndTone || ''}</div>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()
          ) : (
            <div />
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ExampleModal;
