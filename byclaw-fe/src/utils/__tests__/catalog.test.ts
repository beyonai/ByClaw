import {
  getLocalizedCatalogName,
  getTopLevelCatalogs,
  normalizeCatalogTree,
  parseCatalogDescription,
} from '../catalog';

describe('catalog utilities', () => {
  it('extracts localized metadata from a JSON catalog description', () => {
    expect(
      parseCatalogDescription('{"catalogName":"销售领域","catalogEnName":"Sales","catalogDesc":"销售资源"}')
    ).toEqual({
      desc: '销售资源',
      enName: 'Sales',
    });
  });

  it('supports legacy short metadata keys', () => {
    expect(parseCatalogDescription('{"desc":"销售资源","enName":"Sales"}')).toEqual({
      desc: '销售资源',
      enName: 'Sales',
    });
  });

  it('keeps plain text and invalid JSON descriptions compatible', () => {
    expect(parseCatalogDescription('销售资源')).toEqual({});
    expect(parseCatalogDescription('{invalid')).toEqual({});
  });

  it('preserves the stored description while exposing parsed display fields', () => {
    const catalogDesc = '{"catalogEnName":"Sales","catalogDesc":"销售资源"}';
    const [catalog] = normalizeCatalogTree([{ catalogId: 55, catalogName: '销售领域', catalogDesc }]);

    expect(catalog.catalogDesc).toBe(catalogDesc);
    expect(catalog.catalogDisplayDesc).toBe('销售资源');
    expect(catalog.catalogEnName).toBe('Sales');
    expect(getTopLevelCatalogs([catalog])).toEqual([
      { catalogId: 55, catalogName: '销售领域', catalogEnName: 'Sales', level: 0 },
    ]);
  });

  it('uses the English name only for English locales and falls back to the configured name', () => {
    const catalog = { catalogName: '销售领域', catalogEnName: 'Sales' };

    expect(getLocalizedCatalogName(catalog, 'en-US')).toBe('Sales');
    expect(getLocalizedCatalogName(catalog, 'zh-CN')).toBe('销售领域');
    expect(getLocalizedCatalogName({ catalogName: '自定义领域' }, 'en-US')).toBe('自定义领域');
  });
});
