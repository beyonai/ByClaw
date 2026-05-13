import React, { useState, useEffect } from 'react';
import { DownloadOutlined } from '@ant-design/icons';
import { Modal, Upload, Tabs, Button, message, Form, TreeSelect, Alert, Table } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { parseCurl } from '@/pages/manager/service/DigitalEmployeeMgr';
import { getRuntimeActualUrl } from '@/utils';
import styles from './index.module.less';

import type {
  ResourceImportDiffItem,
  ResourceImportItem,
  ResourceImportResult,
} from '@/pages/manager/service/resources';
import { importResource } from '@/pages/manager/service/resources';

interface ResourceImportProps {
  visible: boolean;
  resourceName: string;
  resourceType: string;
  catalogId: string;
  catalogList: Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>;
  activeTab: string;
  saveTool: (data: any) => Promise<any>;
  onCancel: () => void;
  onSuccess: () => void;
}

const resourceImportTemplateMap: Record<string, { fileName: string }> = {
  KG_DOC: { fileName: 'knowledge-import-template.json' },
  TOOL: { fileName: 'tool-import-template.json' },
  OBJECT: { fileName: 'object-import-template.zip' },
  VIEW: { fileName: 'view-import-template.zip' },
};

const ResourceImport: React.FC<ResourceImportProps> = ({
  visible,
  resourceName,
  resourceType,
  catalogId,
  catalogList,
  activeTab,
  saveTool,
  onCancel,
  onSuccess,
}) => {
  const intl = useIntl();
  const [importLoading, setImportLoading] = useState(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [importTab, setImportTab] = useState('localFile');
  const [curlText, setCurlText] = useState('');
  const [curlPanelLoading, setCurlPanelLoading] = useState(false);
  const [parsedCurlData, setParsedCurlData] = useState<any>({});
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | number | undefined>(catalogId || undefined);
  const [curlForm] = Form.useForm();
  const [currentStep, setCurrentStep] = useState('import'); // 'import' or 'curlConfig'
  const [importResult, setImportResult] = useState<ResourceImportResult | null>(null);
  const [activeDiffItem, setActiveDiffItem] = useState<ResourceImportItem | null>(null);

  const accept = resourceType === 'VIEW' || resourceType === 'OBJECT' ? '.zip' : '.json';
  const templateConfig = resourceImportTemplateMap[resourceType];
  const templateUrl = templateConfig
    ? getRuntimeActualUrl(`/download/resource-import-templates/${templateConfig.fileName}`)
    : '';

  const handleDownloadTemplate = () => {
    if (!templateConfig) {
      return;
    }
    const link = document.createElement('a');
    link.href = templateUrl;
    link.download = templateConfig.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 导入函数
  const importFunc = async (data: FormData) => {
    try {
      // 从FormData中获取文件类型
      const file = data.get('file') as File;
      const fileType = file ? file.name.split('.').pop() || '' : '';
      return await importResource(resourceType, fileType, data);
    } catch (error) {
      // console.log('导入失败:', error);
      // 捕获并提示错误
      message.error(
        `${intl.formatMessage({ id: 'resource.importFailed' })}${
          typeof error === 'string' ? error : intl.formatMessage({ id: 'resource.serverBusyRetry' })
        }`
      );
      throw error; // 重新抛出错误，让调用方知道导入失败
    }
  };

  // 当弹窗关闭时重置状态
  useEffect(() => {
    if (!visible) {
      setLocalFile(null);
      setImportTab('localFile');
      setCurlText('');
      setCurrentStep('import');
      setParsedCurlData({});
      setSelectedCatalogId(catalogId || undefined);
      setImportResult(null);
      setActiveDiffItem(null);
      curlForm.resetFields();
    }
  }, [visible, catalogId, curlForm]);

  const localFileList: any[] = [];
  if (localFile) {
    localFileList.push({
      uid: '-1',
      name: localFile.name,
      status: 'done',
    });
  }

  const isZipSummaryMode =
    currentStep === 'import' && !!importResult && (resourceType === 'VIEW' || resourceType === 'OBJECT');

  const buildRangeText = (items: ResourceImportItem[] = []) =>
    items
      .map((item) => {
        const catalogSuffix = item.catalogName ? `（${item.catalogName}）` : '';
        return `${item.resourceCode}：${item.resourceName}${catalogSuffix}`;
      })
      .join('、');

  const failedItems = (importResult?.items || []).filter((item) => !item.success);
  const isNoPermissionUpdateError = (item: ResourceImportItem) =>
    String(item.message || '').includes('无权限通过导入进行资源更新');

  const handleImportComplete = () => {
    setImportResult(null);
    setActiveDiffItem(null);
    onSuccess();
  };

  const handleImportSubmit = async () => {
    if (isZipSummaryMode) {
      handleImportComplete();
      return;
    }
    if (importTab === 'localFile' && !localFile) {
      message.warning(intl.formatMessage({ id: 'knowledgeCenter.import.uploadFirst' }));
      return;
    }
    setImportLoading(true);
    try {
      if (importTab === 'localFile' && localFile) {
        const formData = new FormData();
        formData.append('file', localFile);
        formData.append('ownerType', activeTab);
        formData.append('catalogId', `${selectedCatalogId || '-1'}`);
        formData.append('type', 'external');
        const importData = (await importFunc(formData)) as ResourceImportResult | undefined;
        if ((resourceType === 'VIEW' || resourceType === 'OBJECT') && importData) {
          setImportResult(importData);
          setActiveDiffItem(null);
          return;
        }
        message.success(intl.formatMessage({ id: 'knowledgeCenter.import.success' }));
        onSuccess();
      } else {
        if (!curlText.trim()) {
          message.warning(intl.formatMessage({ id: 'common.enterCurlCommand' }));
          return;
        }
        const parseResp: any = await parseCurl({ curl: curlText, catalogId: selectedCatalogId || '-1' });
        if (parseResp?.code !== 0) {
          return;
        }
        const parsed = parseResp?.data || {};
        setParsedCurlData(parsed);
        setCurrentStep('curlConfig');
      }
    } finally {
      setImportLoading(false);
    }
  };

  const handleCurlSave = async () => {
    try {
      setCurlPanelLoading(true);
      const values = await curlForm.validateFields();
      const payload = {
        ...parsedCurlData,
        ...values,
        catalogId: selectedCatalogId || '-1',
        method: (values.method || parsedCurlData.method || 'get').toLowerCase(),
        curlRaw: values.curlRaw || parsedCurlData.curlRaw || curlText,
        bodyParams: parsedCurlData.bodyParams || [],
        queryParams: parsedCurlData.queryParams || [],
        pathParams: parsedCurlData.pathParams || [],
        headerParams: parsedCurlData.headerParams || [],
      };
      const saveResp: any = await saveTool({
        ...payload,
      });
      if (saveResp?.code !== 0) {
        return;
      }
      message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
      onSuccess();
    } finally {
      setCurlPanelLoading(false);
    }
  };

  const handleBack = () => {
    setCurrentStep('import');
  };

  const finishText = intl.formatMessage({ id: 'resource.import.finish' });
  const confirmText = intl.formatMessage({ id: 'knowledgeCenter.import.confirm' });
  const saveText = intl.formatMessage({ id: 'common.save' });
  const cancelText = intl.formatMessage({ id: 'common.cancel' });
  const backText = intl.formatMessage({ id: 'common.back' });
  const primaryButtonText = isZipSummaryMode ? finishText : currentStep === 'import' ? confirmText : saveText;
  const secondaryButtonText = isZipSummaryMode ? cancelText : currentStep === 'curlConfig' ? backText : cancelText;
  const secondaryButtonAction = isZipSummaryMode ? onCancel : currentStep === 'curlConfig' ? handleBack : onCancel;
  const failedCount = importResult?.failed || failedItems.length;
  const failedSummaryDescription = failedItems.length
    ? intl.formatMessage({ id: 'resource.import.failedSummary' }, { failedCount })
    : undefined;

  return (
    <Modal
      title={intl.formatMessage({ id: 'common.import' }, { name: resourceName })}
      open={visible}
      centered
      onCancel={onCancel}
      onOk={currentStep === 'import' ? handleImportSubmit : handleCurlSave}
      okText={primaryButtonText}
      cancelText={cancelText}
      confirmLoading={currentStep === 'import' ? importLoading : curlPanelLoading}
      destroyOnHidden
      width={isZipSummaryMode ? 980 : currentStep === 'import' ? 800 : 860}
      footer={[
        <Button key="back" onClick={secondaryButtonAction}>
          {secondaryButtonText}
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={currentStep === 'import' ? importLoading : curlPanelLoading}
          onClick={currentStep === 'import' ? handleImportSubmit : handleCurlSave}
          disabled={
            !isZipSummaryMode &&
            currentStep === 'import' &&
            ((importTab === 'localFile' && !localFile) || (importTab === 'curlImport' && !curlText.trim()))
          }
        >
          {primaryButtonText}
        </Button>,
      ]}
    >
      {isZipSummaryMode ? (
        <div className={styles.summaryContainer}>
          <Alert
            type={failedItems.length ? 'warning' : 'success'}
            showIcon
            message={intl.formatMessage(
              { id: 'resource.import.summary' },
              {
                createdCount: importResult?.createdCount || 0,
                updatedCount: importResult?.updatedCount || 0,
              }
            )}
            description={failedSummaryDescription}
          />
          <div className={styles.rangeBlock}>
            <div className={styles.rangeTitle}>{intl.formatMessage({ id: 'resource.import.createdRange' })}</div>
            <div className={styles.rangeContent}>
              {buildRangeText(importResult?.createdItems) || intl.formatMessage({ id: 'common.noData' })}
            </div>
          </div>
          <div className={styles.rangeBlock}>
            <div className={styles.rangeTitle}>{intl.formatMessage({ id: 'resource.import.updatedRange' })}</div>
            <div className={styles.rangeContent}>
              {(importResult?.updatedItems || []).length ? (
                <div className={styles.updatedList}>
                  {(importResult?.updatedItems || []).map((item) => (
                    <div key={`${item.resourceId || item.resourceCode}`} className={styles.updatedItem}>
                      <span>{`${item.resourceCode}：${item.resourceName}`}</span>
                      {item.diffSummary ? <span className={styles.diffSummary}>{item.diffSummary}</span> : null}
                      {(item.diffDetails || []).length ? (
                        <Button type="link" onClick={() => setActiveDiffItem(item)}>
                          {intl.formatMessage({ id: 'resource.import.viewUpdateDetail' })}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                intl.formatMessage({ id: 'common.noData' })
              )}
            </div>
          </div>
          <div className={styles.rangeBlock}>
            <div className={styles.rangeTitle}>{intl.formatMessage({ id: 'resource.import.failedRange' })}</div>
            <div className={styles.rangeContent}>
              {failedItems.length ? (
                <div className={styles.failedList}>
                  {failedItems.map((item) => (
                    <div key={`${item.resourceCode}-${item.message}`} className={styles.failedItem}>
                      <div className={styles.failedName}>
                        {isNoPermissionUpdateError(item) ? (
                          <span className={styles.failedTag}>
                            {intl.formatMessage({ id: 'resource.import.noPermissionUpdate' })}
                          </span>
                        ) : null}
                        <span>{`${item.resourceCode}：${item.resourceName || '-'}`}</span>
                      </div>
                      <div className={styles.failedReason}>
                        {item.message || intl.formatMessage({ id: 'common.operationFailed' })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                intl.formatMessage({ id: 'common.noData' })
              )}
            </div>
          </div>
          {activeDiffItem ? (
            <div className={styles.diffPanel}>
              <div className={styles.diffPanelTitle}>
                {intl.formatMessage(
                  { id: 'resource.import.updateDetailTitle' },
                  { name: `${activeDiffItem.resourceCode}：${activeDiffItem.resourceName}` }
                )}
              </div>
              <Table<ResourceImportDiffItem>
                size="small"
                pagination={false}
                rowKey={(record, index) => `${record.section}-${record.fieldCode}-${record.changeType}-${index}`}
                dataSource={activeDiffItem.diffDetails || []}
                columns={[
                  {
                    title: intl.formatMessage({ id: 'resource.import.diffSection' }),
                    dataIndex: 'section',
                    key: 'section',
                    width: 120,
                  },
                  {
                    title: intl.formatMessage({ id: 'resource.import.diffField' }),
                    dataIndex: 'fieldName',
                    key: 'fieldName',
                    width: 160,
                    render: (_, record) => record.fieldName || record.fieldCode,
                  },
                  {
                    title: intl.formatMessage({ id: 'resource.import.diffBefore' }),
                    dataIndex: 'beforeValue',
                    key: 'beforeValue',
                    render: (value) => value || '-',
                  },
                  {
                    title: intl.formatMessage({ id: 'resource.import.diffAfter' }),
                    dataIndex: 'afterValue',
                    key: 'afterValue',
                    render: (value) => value || '-',
                  },
                  {
                    title: intl.formatMessage({ id: 'resource.import.diffDescription' }),
                    dataIndex: 'description',
                    key: 'description',
                    width: 180,
                  },
                ]}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <Tabs
          activeKey={importTab}
          onChange={setImportTab}
          tabBarExtraContent={
            <div className={styles.tabExtraContent}>
              {currentStep === 'import' ? (
                <Form layout="inline">
                  <Form.Item
                    label={intl.formatMessage({ id: 'resource.belongField' })}
                    className={styles.formItemNoMargin}
                  >
                    <TreeSelect
                      allowClear
                      treeData={catalogList}
                      value={selectedCatalogId}
                      placeholder={intl.formatMessage({ id: 'resource.belongFieldPlaceholder' })}
                      treeDataSimpleMode={{
                        id: 'catalogId',
                        pId: 'pcatalogId',
                        rootPId: -1,
                      }}
                      fieldNames={{
                        label: 'catalogName',
                        value: 'catalogId',
                      }}
                      showSearch
                      treeNodeFilterProp="catalogName"
                      className={styles.treeSelectMinWidth}
                      onChange={(value) => {
                        setSelectedCatalogId(value);
                      }}
                    />
                  </Form.Item>
                </Form>
              ) : null}
              {templateConfig ? (
                <div className={styles.templateBar}>
                  <Button type="link" size="small" icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
                    {intl.formatMessage({ id: 'resource.import.downloadTemplate' })}
                  </Button>
                </div>
              ) : null}
            </div>
          }
          items={[
            {
              key: 'localFile',
              label: intl.formatMessage({ id: 'common.localFile' }),
              children: (
                <div className={styles.localFileContainer}>
                  <Upload.Dragger
                    accept={accept}
                    maxCount={1}
                    fileList={localFileList}
                    className={styles.uploadDragger}
                    beforeUpload={(file) => {
                      setLocalFile(file as File);
                      return false;
                    }}
                    onRemove={() => {
                      setLocalFile(null);
                    }}
                  >
                    <p>
                      <AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" className={styles.uploadIcon} />
                    </p>
                    <p className={styles.uploadHint}>
                      {`${intl.formatMessage({ id: 'knowledgeCenter.import.dragHint' })}，${intl.formatMessage({
                        id: 'common.supportedFileTypes',
                      })}${accept.slice(1)}`}
                    </p>
                    {/* <br />
                  <p className={styles.uploadFormatHint}>
                    {intl.formatMessage({ id: 'knowledgeCenter.import.formatHint' })}
                  </p>{' '} */}
                  </Upload.Dragger>
                </div>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
};

export default ResourceImport;
