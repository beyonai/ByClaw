jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('antd', () => ({
  Form: { useForm: () => [{}] },
  Input: () => null,
  message: { error: jest.fn(), success: jest.fn() },
  Modal: () => null,
  Select: () => null,
  Upload: { Dragger: () => null },
}));
jest.mock('@/pages/manager/service/resources', () => ({}));
jest.mock('@/service/file', () => ({}));
const mockNormalizeSkillGroupCover = jest.fn();
jest.mock('../coverProcessor', () => ({
  normalizeSkillGroupCover: (...args: unknown[]) => mockNormalizeSkillGroupCover(...args),
}));

import { getCoverPreviewUrl, prepareSkillGroupCover } from '..';

describe('SkillGroupCreateModal cover preview', () => {
  const createObjectURL = jest.fn(() => 'blob:skill-group-cover');

  beforeEach(() => {
    createObjectURL.mockClear();
    mockNormalizeSkillGroupCover.mockReset();
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
  });

  it('creates a local preview URL for the selected cover image', () => {
    const file = new File(['cover'], 'knowledge-collaboration.png', { type: 'image/png' });

    expect(getCoverPreviewUrl(file)).toBe('blob:skill-group-cover');
    expect(createObjectURL).toHaveBeenCalledWith(file);
  });

  it('does not create a preview URL when no cover image is selected', () => {
    expect(getCoverPreviewUrl()).toBe('');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('prepares the normalized 3:4 file for both preview and upload', async () => {
    const source = new File(['source'], 'source.jpg', { type: 'image/jpeg' });
    const normalized = new File(['normalized'], 'source-3x4.png', { type: 'image/png' });
    mockNormalizeSkillGroupCover.mockResolvedValue(normalized);

    await expect(prepareSkillGroupCover(source)).resolves.toEqual({
      file: normalized,
      previewUrl: 'blob:skill-group-cover',
    });
    expect(mockNormalizeSkillGroupCover).toHaveBeenCalledWith(source);
    expect(createObjectURL).toHaveBeenCalledWith(normalized);
  });
});
