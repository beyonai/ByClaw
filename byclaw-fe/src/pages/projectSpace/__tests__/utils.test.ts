import { getProjectTagMeta } from '../utils';

describe('getProjectTagMeta', () => {
  it('uses only normal, development, and operation project tags', () => {
    expect(getProjectTagMeta('normal')).toEqual({
      classSuffix: 'Normal',
      messageId: 'projectSpace.scene.normal',
    });
    expect(getProjectTagMeta('default')).toEqual({
      classSuffix: 'Normal',
      messageId: 'projectSpace.scene.normal',
    });
    expect(getProjectTagMeta({ projectType: 'normal', sharedFlag: true })).toEqual({
      classSuffix: 'Normal',
      messageId: 'projectSpace.scene.normal',
    });
    expect(getProjectTagMeta('develop')).toEqual({
      classSuffix: 'Development',
      messageId: 'projectSpace.scene.development',
    });
    expect(getProjectTagMeta('operation')).toEqual({
      classSuffix: 'Operation',
      messageId: 'projectSpace.scene.operation',
    });
  });
});
