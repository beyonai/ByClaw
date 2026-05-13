import {
  buildResourceListFilterParam,
  getBaseResourceBizTypeList,
  isAllResourceBizTypeSelected,
  normalizeResourceBizTypeList,
} from '../utils';

const ALL_RESOURCE_BIZ_TYPE_VALUES = ['MCP', 'TOOLKIT', 'AGENT'];
const ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES = ['KG_DOC', 'KG_TERM', 'KG_QA'];

describe('components/Resources utils', () => {
  it('treats empty and legacy full selections as all resource biz types', () => {
    expect(isAllResourceBizTypeSelected()).toBe(true);
    expect(isAllResourceBizTypeSelected([])).toBe(true);
    expect(isAllResourceBizTypeSelected(['MCP', 'TOOLKIT', 'AGENT'])).toBe(true);
    expect(isAllResourceBizTypeSelected(['MCP'])).toBe(false);
  });

  it('normalizes all selections to full resource biz type payloads', () => {
    expect(normalizeResourceBizTypeList()).toEqual(ALL_RESOURCE_BIZ_TYPE_VALUES);
    expect(normalizeResourceBizTypeList([])).toEqual(ALL_RESOURCE_BIZ_TYPE_VALUES);
    expect(normalizeResourceBizTypeList(['MCP', 'TOOLKIT', 'AGENT'])).toEqual(ALL_RESOURCE_BIZ_TYPE_VALUES);
    expect(normalizeResourceBizTypeList(['MCP'])).toEqual(['MCP']);
    expect(normalizeResourceBizTypeList([], 'KG_DOC')).toEqual(ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES);
    expect(isAllResourceBizTypeSelected(['KG_DOC', 'KG_TERM', 'KG_QA'], 'KG_DOC')).toBe(true);
  });

  it('sets full resourceBizTypeList for tool resources by default', () => {
    expect(getBaseResourceBizTypeList('TOOL')).toEqual(ALL_RESOURCE_BIZ_TYPE_VALUES);
    expect(getBaseResourceBizTypeList('KG_DOC')).toEqual(['KG_DOC', 'KG_QA', 'KG_TERM']);
  });

  it('removes enterprise scope filters in personal mode and keeps them in enterprise mode', () => {
    expect(
      buildResourceListFilterParam('personal', {
        belong: 'ALL',
        deptBelong: [{ id: 'org_401', orgId: 401 }],
        orgFilters: [{ type: 'ALL' }],
        resourceStatus: '2',
        resourceBizTypeList: ['MCP', 'TOOLKIT', 'AGENT'],
      })
    ).toEqual({
      resourceStatus: '2',
      resourceBizTypeList: ['MCP', 'TOOLKIT', 'AGENT'],
    });

    expect(
      buildResourceListFilterParam('enterprise', {
        belong: 'COMPANY',
        deptBelong: [{ id: 'org_401', orgId: 401 }],
        orgFilters: [{ type: 'ALL' }],
        resourceStatus: '2',
        resourceBizTypeList: ['MCP'],
      })
    ).toEqual({
      belong: 'COMPANY',
      orgFilters: [{ type: 'ALL' }],
      resourceStatus: '2',
      resourceBizTypeList: ['MCP'],
    });
  });
});
