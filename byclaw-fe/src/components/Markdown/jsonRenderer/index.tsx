import React, { useState, useMemo } from 'react';
import { Button, Tooltip } from 'antd';
import { DownOutlined, RightOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { copyTextToClipboard } from '@/utils/copy';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';
import classNames from 'classnames';

interface JsonRendererProps {
  data: any;
  level?: number;
  isRoot?: boolean;
  showCopyButton?: boolean;
  isLast?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

interface JsonValueProps {
  value: any;
  level: number;
  showCopyButton?: boolean;
  isLast?: boolean;
  defaultExpanded?: boolean;
}

// JSON值类型检测
const getValueType = (value: any): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'unknown';
};

// 获取类型图标 - 已移除所有图标
const getTypeIcon = () => {
  return null;
};

let JsonArray: React.FC<JsonRendererProps>;
let JsonObject: React.FC<JsonRendererProps>;

// 渲染JSON值
const JsonValue: React.FC<JsonValueProps> = ({ value, level, showCopyButton, defaultExpanded, isLast = false }) => {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const valueType = getValueType(value);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(JSON.stringify(value, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const renderValue = () => {
    switch (valueType) {
      case 'null':
        return <span className={styles.nullValue}>null</span>;
      case 'undefined':
        return <span className={styles.undefinedValue}>undefined</span>;
      case 'boolean':
        return <span className={styles.booleanValue}>{String(value)}</span>;
      case 'number':
        return <span className={styles.numberValue}>{value}</span>;
      case 'string':
        return <span className={styles.stringValue}>&quot;{value}&quot;</span>;
      case 'array':
        return <JsonArray data={value} level={level + 1} isLast={isLast} defaultExpanded={defaultExpanded} />;
      case 'object':
        return <JsonObject data={value} level={level + 1} isLast={isLast} defaultExpanded={defaultExpanded} />;
      default:
        return <span className={styles.unknownValue}>{String(value)}</span>;
    }
  };

  return (
    <div className={styles.jsonValue}>
      {getTypeIcon()}
      {renderValue()}
      {showCopyButton && (
        <Tooltip
          title={
            copied
              ? intl.formatMessage({ id: 'common.copySuccess' })
              : intl.formatMessage({ id: 'jsonRenderer.copyValue' })
          }
        >
          <Button
            type="text"
            size="small"
            icon={copied ? <CheckOutlined /> : <CopyOutlined />}
            onClick={handleCopy}
            className={styles.copyButton}
          />
        </Tooltip>
      )}
    </div>
  );
};

// 渲染JSON对象
JsonObject = ({ data, level = 0, showCopyButton, defaultExpanded }) => {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(!!defaultExpanded); // 默认不展开
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const entries = useMemo(() => Object.entries(data), [data]);
  const hasChildren = entries.length > 0;

  if (!hasChildren) {
    return (
      <div className={styles.jsonObject}>
        <span className={styles.brace}>{'{'}</span>
        <span className={styles.emptyObject}>{intl.formatMessage({ id: 'common.emptyObject' })}</span>
        <span className={styles.brace}>{'}'}</span>
      </div>
    );
  }

  return (
    <div className={styles.jsonObject}>
      <div className={styles.objectHeader}>
        <Button
          type="text"
          size="small"
          icon={expanded ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setExpanded(!expanded)}
          className={styles.expandButton}
        />
        <span className={styles.brace}>{'{'}</span>
        {!expanded && <span className={styles.ellipsis}>...</span>}
        {!expanded && <span className={styles.brace}>{'}'}</span>}
        {/* <span className={styles.objectInfo}>{entries.length} 个属性</span> */}
        {showCopyButton && (
          <Tooltip
            title={
              copied
                ? intl.formatMessage({ id: 'common.copySuccess' })
                : intl.formatMessage({ id: 'jsonRenderer.copyObject' })
            }
          >
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
              className={styles.copyButton}
            />
          </Tooltip>
        )}
      </div>

      {expanded ? (
        <>
          <div className={styles.objectContent}>
            {entries.map(([key, value], index) => (
              <div key={key} className={styles.objectItem}>
                <span className={styles.objectKey}>&quot;{key}&quot;</span>
                <span className={styles.colon}>:</span>
                <JsonValue
                  value={value}
                  level={level}
                  showCopyButton={showCopyButton}
                  isLast={index === entries.length - 1}
                />
              </div>
            ))}
          </div>
          <div className={styles.objectFooter}>
            <span className={styles.brace}>{'}'}</span>
          </div>
        </>
      ) : null}
    </div>
  );
};

// 渲染JSON数组
JsonArray = ({ data, level = 0, showCopyButton, defaultExpanded }) => {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(!!defaultExpanded); // 默认不展开
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const hasChildren = Array.isArray(data) && data.length > 0;

  if (!hasChildren) {
    return (
      <div className={styles.jsonArray}>
        <span className={styles.bracket}>[</span>
        <span className={styles.emptyArray}>{intl.formatMessage({ id: 'common.emptyArray' })}</span>
        <span className={styles.bracket}>]</span>
      </div>
    );
  }

  return (
    <div className={styles.jsonArray}>
      <div className={styles.arrayHeader}>
        <Button
          type="text"
          size="small"
          icon={expanded ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setExpanded(!expanded)}
          className={styles.expandButton}
        />
        <span className={styles.bracket}>[</span>
        {!expanded && <span className={styles.ellipsis}>...</span>}
        {!expanded && <span className={styles.bracket}>]</span>}
        {/* <span className={styles.arrayInfo}>{data.length} 个元素</span> */}
        {showCopyButton && (
          <Tooltip
            title={
              copied
                ? intl.formatMessage({ id: 'common.copySuccess' })
                : intl.formatMessage({ id: 'jsonRenderer.copyArray' })
            }
          >
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
              className={styles.copyButton}
            />
          </Tooltip>
        )}
      </div>

      {expanded ? (
        <>
          <div className={styles.arrayContent}>
            {data.map((item, index) => (
              <div key={index} className={styles.arrayItem}>
                <JsonValue
                  value={item}
                  level={level}
                  showCopyButton={showCopyButton}
                  isLast={index === data.length - 1}
                />
              </div>
            ))}
          </div>
          <div className={styles.arrayFooter}>
            <span className={styles.bracket}>]</span>
          </div>
        </>
      ) : null}
    </div>
  );
};

// 主JSON渲染器组件
const JsonRenderer: React.FC<JsonRendererProps> = ({
  data,
  level = 0,
  isRoot = true,
  showCopyButton,
  isLast = false,
  defaultExpanded,
  className,
}) => {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const valueType = getValueType(data);

  const handleCopyAll = async () => {
    try {
      await copyTextToClipboard(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  if (valueType === 'object') {
    return (
      <div className={classNames(styles.jsonRenderer, className)}>
        {isRoot && (
          <div className={styles.copyAllButton}>
            <Tooltip
              title={
                copied
                  ? intl.formatMessage({ id: 'common.copySuccess' })
                  : intl.formatMessage({ id: 'jsonRenderer.copyAll' })
              }
            >
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={handleCopyAll}
                className={styles.copyAllButton}
              />
            </Tooltip>
          </div>
        )}
        <JsonObject
          data={data}
          level={level}
          isRoot={isRoot}
          defaultExpanded={defaultExpanded}
          showCopyButton={showCopyButton}
        />
      </div>
    );
  }

  if (valueType === 'array') {
    return (
      <div className={classNames(styles.jsonRenderer, className)}>
        {isRoot && (
          <div className={styles.copyAllButton}>
            <Tooltip
              title={
                copied
                  ? intl.formatMessage({ id: 'common.copySuccess' })
                  : intl.formatMessage({ id: 'jsonRenderer.copyAll' })
              }
            >
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={handleCopyAll}
                className={styles.copyAllButton}
              />
            </Tooltip>
          </div>
        )}
        <JsonArray
          data={data}
          level={level}
          isRoot={isRoot}
          defaultExpanded={defaultExpanded}
          showCopyButton={showCopyButton}
        />
      </div>
    );
  }

  return <JsonValue value={data} level={level} isLast={isLast} />;
};

export default JsonRenderer;
