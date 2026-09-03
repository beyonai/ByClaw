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
  });
});
