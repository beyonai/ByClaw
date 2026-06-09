import React from 'react';

jest.mock('antd', () => ({
  Typography: {
    Paragraph: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

jest.mock('@umijs/max', () => ({
  getIntl: jest.fn(() => ({
    formatMessage: ({ id }: { id: string }) => id,
  })),
}));

import {
  getMCPToolsRenderConfig,
  isByclawCodeAgentResource,
  parsePropertiesRecursive,
  parseSchema,
} from '@/pages/employees/components/SkillDetailDrawer/SkillDetailDrawer.utils';

describe('manager/components/SkillDetailDrawer/SkillDetailDrawer.utils', () => {
  describe('isByclawCodeAgentResource', () => {
    it('matches BYCLAW_CODE agent resources case-insensitively', () => {
      expect(isByclawCodeAgentResource({ resourceBizType: 'AGENT', systemCode: 'BYCLAW_CODE' })).toBe(true);
      expect(isByclawCodeAgentResource({ resourceBizType: 'AGENT', systemCode: 'byclaw_code' })).toBe(true);
    });

    it('does not match other resource types or system codes', () => {
      expect(isByclawCodeAgentResource({ resourceBizType: 'TOOL', systemCode: 'BYCLAW_CODE' })).toBe(false);
      expect(isByclawCodeAgentResource({ resourceBizType: 'AGENT', systemCode: 'BYAI' })).toBe(false);
    });
  });

  describe('parsePropertiesRecursive', () => {
    it('parses nested object properties recursively', () => {
      expect(
        parsePropertiesRecursive(
          {
            profile: {
              type: 'object',
              description: 'profile',
              properties: {
                name: { type: 'string', description: 'user name', default: 'alice' },
              },
              required: ['name'],
            },
          },
          '',
          ['profile']
        )
      ).toEqual([
        {
          key: 'profile',
          name: 'profile',
          type: 'object',
          description: 'profile',
          default: '',
          required: true,
          children: [
            {
              key: 'profile.name',
              name: 'name',
              type: 'string',
              description: 'user name',
              default: 'alice',
              required: true,
            },
          ],
        },
      ]);
    });

    it('parses array item properties recursively', () => {
      expect(
        parsePropertiesRecursive({
          items: {
            type: 'array',
            items: {
              properties: {
                code: { type: 'string' },
              },
              required: ['code'],
            },
          },
        })
      ).toEqual([
        {
          key: 'items',
          name: 'items',
          type: 'array',
          description: '',
          default: '',
          required: false,
          children: [
            {
              key: 'items[].code',
              name: 'code',
              type: 'string',
              description: '',
              default: '',
              required: true,
            },
          ],
        },
      ]);
    });

    it('returns an empty array for invalid properties input', () => {
      expect(parsePropertiesRecursive(null as any)).toEqual([]);
    });
  });

  describe('parseSchema', () => {
    it('parses JSON schema with properties and required fields', () => {
      expect(
        parseSchema(
          JSON.stringify({
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'user name' },
            },
          })
        )
      ).toEqual([
        {
          key: 'name',
          name: 'name',
          type: 'string',
          description: 'user name',
          default: '',
          required: true,
        },
      ]);
    });

    it('falls back to the legacy flat structure when properties are absent', () => {
      expect(parseSchema(JSON.stringify({ token: 'abc', config: { enabled: true } }))).toEqual([
        { key: 'token', val: 'abc' },
        { key: 'config', enabled: true },
      ]);
    });

    it('returns an empty array for invalid JSON', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      expect(parseSchema('{invalid json')).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('getMCPToolsRenderConfig', () => {
    it('wraps MCP tool list response as a table RenderItem', () => {
      expect(
        getMCPToolsRenderConfig(
          {
            tools: [
              {
                name: 'get-current-date',
                description: '获取当前日期',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
            ],
          },
          'mcp-resource-id'
        )
      ).toMatchObject([
        {
          type: 'table',
          label: 'skillDetail.toolList',
          tableType: 'mcp',
          dataSource: [
            {
              key: 'get-current-date',
              resourceId: 'mcp-resource-id',
              name: 'get-current-date',
              description: '获取当前日期',
              inputSchema: {
                type: 'object',
                properties: {},
              },
              statusText: '-',
            },
          ],
        },
      ]);
    });
  });
});
