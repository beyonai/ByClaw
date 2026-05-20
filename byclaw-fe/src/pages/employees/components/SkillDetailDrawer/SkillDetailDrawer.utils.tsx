/* eslint-disable max-len,@typescript-eslint/no-non-null-assertion */
import React from 'react';
import { TableColumnType, Typography } from 'antd';
import { getIntl } from '@umijs/max';

export type RenderItemText = {
  type: 'text';
  children: React.ReactNode;
};

export type RenderItemTags = {
  type: 'tags';
  children: string[];
};

export type RenderItemTab1 = {
  type: 'tab1';
  children: {
    label: string;
    subLabel?: React.ReactNode;
    children: React.ReactNode;
  }[];
};

export type RenderItemTab2 = {
  type: 'tab2';
  children: {
    label: string;
    children: React.ReactNode;
  }[];
};

export type RenderItemTable = {
  type: 'table';
  columns: TableColumnType<any>[];
  dataSource: any[];
  tableType?: 'tools';
};

export type RenderItemButton = {
  type: 'button';
  label?: string;
  children: React.ReactNode;
  url?: string;
};

export type RenderItemEmpty = {
  type: 'empty';
};

export type RenderItem = {
  label?: string;
  url?: string;

  resourceSourcePkId?: string;
  resourceBizType?: string;
  resourceId?: string;
} & (
  | RenderItemText
  | RenderItemTags
  | RenderItemTab1
  | RenderItemTab2
  | RenderItemTable
  | RenderItemButton
  | RenderItemEmpty
);

const getResourceStatusText = (status?: number) => {
  const intl = getIntl();
  if (status === 2) return intl.formatMessage({ id: 'resourceStatus.published' });
  if (status === 3) return intl.formatMessage({ id: 'resourceStatus.unpublished' });
  if (status === 0) return intl.formatMessage({ id: 'resourceStatus.draft' });
  if (status === 1 || status === 4) return intl.formatMessage({ id: 'resourceStatus.reviewing' });
  if (status === 5) return intl.formatMessage({ id: 'resourceStatus.notPassed' });
  return '';
};

/**
 * 递归解析 schema 中的 properties，生成树形结构
 * @param properties - schema 的 properties 对象
 * @param parentPath - 父级路径，用于生成唯一 key
 * @param required - 必填字段数组
 * @returns 树形结构的数据数组
 */
export const parsePropertiesRecursive = (properties: any, parentPath: string = '', required: string[] = []): any[] => {
  if (!properties || typeof properties !== 'object') {
    return [];
  }

  return Object.entries(properties).map(([key, val]: [string, any]) => {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;
    const item: any = {
      key: currentPath,
      name: key,
      type: val.type || '-',
      description: val.description || '',
      default: val.default !== undefined ? String(val.default) : '',
      required: required.includes(key),
    };

    // 如果当前项有 properties，说明是对象类型，需要递归处理子节点
    if (val.properties && typeof val.properties === 'object') {
      const childRequired = Array.isArray(val.required) ? val.required : [];
      item.children = parsePropertiesRecursive(val.properties, currentPath, childRequired);
    } else if (val.type === 'array' && val.items?.properties && typeof val.items.properties === 'object') {
      // 如果当前项是 array 类型，且 items 有 properties，也需要处理
      const childRequired = Array.isArray(val.items.required) ? val.items.required : [];
      item.children = parsePropertiesRecursive(val.items.properties, `${currentPath}[]`, childRequired);
    }

    return item;
  });
};

export const parseSchema = (schema: string) => {
  let json: any = {};
  try {
    json = JSON.parse(schema) || {};
  } catch (error) {
    console.warn(error);
  }

  // 如果 schema 有 properties，使用递归解析生成树形结构
  if (json.properties) {
    const required = Array.isArray(json.required) ? json.required : [];
    return parsePropertiesRecursive(json.properties, '', required);
  }

  // 兼容旧格式：如果没有 properties，直接返回扁平结构
  return Object.entries(json).map(([key, val]: any) => ({
    key,
    ...(typeof val === 'object' ? val : { val }),
  }));
};

export const getMCPToolsRenderConfig = (
  resp: any,
  resourceId?: string,
  setMCPTestItem?: (record: any) => void
): RenderItem[] => {
  const intl = getIntl();
  const tools = Array.isArray(resp) ? resp : resp?.tools;

  if (!Array.isArray(tools) || !tools.length) {
    return [];
  }

  return [
    {
      type: 'table',
      label: intl.formatMessage({ id: 'skillDetail.toolList' }),
      tableType: 'tools',
      columns: [
        { dataIndex: 'name', title: intl.formatMessage({ id: 'skillDetail.toolName' }) },
        {
          dataIndex: 'description',
          title: intl.formatMessage({ id: 'skillDetail.toolDescription' }),
          width: '50%',
          render: (text: React.ReactNode) => {
            return (
              <Typography.Paragraph ellipsis={{ rows: 2, tooltip: text ?? '-' }}>{text ?? '-'}</Typography.Paragraph>
            );
          },
        },
        {
          dataIndex: 'statusText',
          title: intl.formatMessage({ id: 'common.status' }),
          width: 90,
          align: 'center',
          render: (text: React.ReactNode) => text ?? '-',
        },
        {
          title: intl.formatMessage({ id: 'common.operation' }),
          width: 90,
          align: 'center',
          render: (_: any, record: any) => (
            <a
              onClick={() => {
                setMCPTestItem?.(record);
              }}
            >
              {intl.formatMessage({ id: 'skillDetail.test' })}
            </a>
          ),
        },
      ],
      dataSource: tools.map((tool: any, index: number) => ({
        ...tool,
        key: tool.name ?? tool.resourceId ?? index,
        resourceId: resourceId ?? tool.resourceId,
        resourceBizType: tool.resourceBizType,
        resourceSourcePkId: tool.resourceSourcePkId,
        createTime: tool.createTime,
        createUserName: tool.createUserName,
        name: tool.resourceName ?? tool.toolName ?? tool.name ?? '-',
        description: tool.resourceDesc ?? tool.desc ?? tool.description ?? '-',
        status: tool.resourceStatus,
        statusText: getResourceStatusText(tool.resourceStatus) || '-',
      })),
    },
  ];
};

export const getSchemaRenderConfig = (config: any) => {
  const intl = getIntl();
  const items: RenderItem[] = [];
  // 如果 param 为 null、不存在、字符串'null'或空对象，返回空占位符
  if (
    !config.param ||
    config.param === null ||
    config.param === 'null' ||
    (typeof config.param === 'object' && Object.keys(config.param).length === 0)
  ) {
    items.push({
      type: 'empty',
    });
    return items;
  }
  if (config.param) {
    if (config.param.url) {
      items.push({
        type: 'text',
        label: intl.formatMessage({ id: 'skillDetail.type' }),
        children: 'HTTP',
      });
      // 如果有请求方式，在类型和URL之前显示
      if (config.param.method && config.param.method.trim()) {
        items.push({
          type: 'text',
          label: intl.formatMessage({ id: 'skillDetail.requestMethod' }),
          children: config.param.method.trim(),
        });
      }
      items.push({
        type: 'text',
        label: 'URL',
        children: config.param.url,
      });
      if (config.systemCode === 'BOT') {
        items.push({
          type: 'button',
          label: 'botUrl',
          children: intl.formatMessage({ id: 'skillDetail.serviceProvider' }),
          url: config.param.url,
        });
      }
    }
    if (config.param.mcpServerUrl) {
      items.push({
        type: 'text',
        label: intl.formatMessage({ id: 'skillDetail.type' }),
        children: config.param.mcpTransferType,
      });
      items.push({
        type: 'text',
        label: 'URL',
        children: config.param.mcpServerUrl,
      });
      if (config.systemCode === 'BOT') {
        items.push({
          type: 'button',
          label: 'botUrl',
          children: intl.formatMessage({ id: 'skillDetail.serviceProvider' }),
          url: config.param.mcpServerUrl,
        });
      }
    }
    if (config.param.agentSseUrl) {
      items.push({
        type: 'text',
        label: intl.formatMessage({ id: 'skillDetail.type' }),
        children: intl.formatMessage({ id: 'skillDetail.streamableHttp' }),
      });
      items.push({
        type: 'text',
        label: 'URL',
        children: config.param.agentSseUrl,
      });
      if (config.systemCode === 'BOT') {
        items.push({
          type: 'button',
          label: 'botUrl',
          children: intl.formatMessage({ id: 'skillDetail.serviceProvider' }),
          url: config.param.agentSseUrl,
        });
      }
    }
    if (config.param.mcpHeader && config.param.mcpHeader !== 'null') {
      const data = parseSchema(config.param.mcpHeader);
      items.push({
        type: 'table',
        label: intl.formatMessage({ id: 'skillDetail.headerParams' }),
        columns: [
          { dataIndex: 'key', title: 'Key' },
          { dataIndex: 'val', title: intl.formatMessage({ id: 'skillDetail.fillInstruction' }) },
        ],
        dataSource: data,
      });
    }

    if (config.tags) {
      let tags: string[] = [];
      try {
        tags = JSON.parse(config.tags);
      } catch (error) {
        tags = config.tags.split(',');
      }
      items.push({
        type: 'tags',
        label: intl.formatMessage({ id: 'common.tags' }),
        children: tags,
      });
    }

    // 合并 inputSchema、pathSchema、querySchema 到输入参数表格
    const inputSchemas: Array<{ schema: string; method: string }> = [];
    if (config.param.inputSchema && config.param.inputSchema !== 'null') {
      inputSchemas.push({ schema: config.param.inputSchema, method: 'body' });
    }
    if (config.param.pathSchema && config.param.pathSchema !== 'null') {
      inputSchemas.push({ schema: config.param.pathSchema, method: 'path' });
    }
    if (config.param.querySchema && config.param.querySchema !== 'null') {
      inputSchemas.push({ schema: config.param.querySchema, method: 'query' });
    }

    if (inputSchemas.length > 0) {
      // 递归为所有节点（包括子节点）添加 method 字段
      const addMethodToNodes = (nodes: any[], method: string): any[] => {
        return nodes.map((item) => ({
          ...item,
          method,
          children: item.children ? addMethodToNodes(item.children, method) : undefined,
        }));
      };

      // 合并所有 schema 数据，并添加传入方法字段和是否必填字段
      const allInputData: any[] = [];
      inputSchemas.forEach(({ schema, method }) => {
        const data = parseSchema(schema);
        // 递归为所有节点添加 method 字段
        const dataWithMethod = addMethodToNodes(data, method);
        allInputData.push(...dataWithMethod);
      });

      items.push({
        type: 'table',
        label: intl.formatMessage({ id: 'skillDetail.inputParams' }),
        columns: [
          { dataIndex: 'name', title: intl.formatMessage({ id: 'skillDetail.paramName' }) },
          {
            dataIndex: 'description',
            title: intl.formatMessage({ id: 'skillDetail.paramDescription' }),
            render: (text: React.ReactNode) => (
              <Typography.Paragraph ellipsis={{ rows: 1 }}>{text}</Typography.Paragraph>
            ),
          },
          {
            dataIndex: 'type',
            title: intl.formatMessage({ id: 'skillDetail.paramType' }),
            width: 80,
            render: (text: React.ReactNode) => text ?? '-',
          },
          {
            dataIndex: 'method',
            title: intl.formatMessage({ id: 'skillDetail.passMethod' }),
            width: 80,
            render: (text: React.ReactNode) => text ?? '-',
          },
          {
            dataIndex: 'required',
            title: intl.formatMessage({ id: 'skillDetail.required' }),
            width: 80,
            render: (required: boolean) =>
              required ? intl.formatMessage({ id: 'common.yes' }) : intl.formatMessage({ id: 'common.no' }),
          },
        ],
        dataSource: allInputData,
      });
    }

    if (config.param.outputSchema && config.param.outputSchema !== 'null') {
      const data = parseSchema(config.param.outputSchema);
      items.push({
        type: 'table',
        label: intl.formatMessage({ id: 'skillDetail.outputParams' }),
        columns: [
          { dataIndex: 'name', title: intl.formatMessage({ id: 'skillDetail.paramName' }) },
          {
            dataIndex: 'description',
            title: intl.formatMessage({ id: 'skillDetail.paramDescription' }),
            render: (text: React.ReactNode) => (
              <Typography.Paragraph ellipsis={{ rows: 1 }}>{text ?? '-'}</Typography.Paragraph>
            ),
          },
          {
            dataIndex: 'type',
            title: intl.formatMessage({ id: 'skillDetail.paramType' }),
            render: (text: React.ReactNode) => text ?? '-',
          },
        ],
        dataSource: data,
      });
    }

    if (Array.isArray(config.param.tools) && config.param.tools.length) {
      const tools = config.param.tools.map((tool: any, index: number) => ({
        key: tool.resourceId ?? index,
        resourceId: tool.resourceId,
        resourceBizType: tool.resourceBizType,
        resourceSourcePkId: tool.resourceSourcePkId,
        createTime: tool.createTime,
        createUserName: tool.createUserName,
        name: tool.resourceName ?? tool.toolName ?? '-',
        description: tool.resourceDesc ?? tool.desc ?? '-',
        status: tool.resourceStatus,
        statusText: getResourceStatusText(tool.resourceStatus),
      }));

      items.push({
        type: 'table',
        label: intl.formatMessage({ id: 'skillDetail.toolList' }),
        tableType: 'tools',
        columns: [
          { dataIndex: 'name', title: intl.formatMessage({ id: 'skillDetail.toolName' }) },
          {
            dataIndex: 'description',
            title: intl.formatMessage({ id: 'skillDetail.toolDescription' }),
            render: (text: React.ReactNode) => (
              <Typography.Paragraph ellipsis={{ rows: 1 }}>{text ?? '-'}</Typography.Paragraph>
            ),
          },
          {
            dataIndex: 'statusText',
            title: intl.formatMessage({ id: 'common.status' }),
            width: 90,
            render: (text: React.ReactNode) => text ?? '-',
          },
        ],
        dataSource: tools,
      });
    }
  }

  return items;
};
