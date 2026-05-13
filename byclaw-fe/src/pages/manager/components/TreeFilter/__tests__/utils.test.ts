import { buildCatalogTreeData, buildTreeData } from '../utils';

describe('manager/components/TreeFilter/utils', () => {
  it('builds tree data with custom field mapping and transforms', () => {
    const result = buildTreeData(
      [
        { id: 1, parentId: -1, label: 'Root' },
        { id: 2, parentId: 1, label: 'Child' },
      ],
      {
        idField: 'id',
        parentIdField: 'parentId',
        labelField: 'label',
        keyTransform: (id: number) => `node-${id}`,
        labelTransform: (label: string) => label.toUpperCase(),
      }
    );

    expect(result).toEqual([
      {
        key: 'node-1',
        label: 'ROOT',
        keypath: 'node-1',
        children: [
          {
            key: 'node-2',
            label: 'CHILD',
            keypath: 'node-1,node-2',
          },
        ],
      },
    ]);
  });

  it('treats nodes with missing parents as roots', () => {
    expect(
      buildTreeData([{ id: 2, parentId: 99, label: 'Orphan' }], {
        idField: 'id',
        parentIdField: 'parentId',
        labelField: 'label',
      })
    ).toEqual([
      {
        key: '2',
        label: 'Orphan',
        keypath: '2',
      },
    ]);
  });

  it('builds catalog tree data with default catalog mapping', () => {
    expect(
      buildCatalogTreeData([
        { catalogId: 1, catalogName: 'Root', pcatalogId: -1, catalogPath: '/1' },
        { catalogId: 2, catalogName: 'Child', pcatalogId: 1, catalogPath: '/1/2' },
      ])
    ).toEqual([
      {
        key: '1',
        label: 'Root',
        keypath: '1',
        children: [
          {
            key: '2',
            label: 'Child',
            keypath: '1,2',
          },
        ],
      },
    ]);
  });
});
