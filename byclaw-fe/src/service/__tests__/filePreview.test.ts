import { POST } from '@/service/common/request';
import { convertLegacyOfficePreview } from '../filePreview';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));

it('uploads a named copy using the authenticated request client and keeps cancellation', async () => {
  const controller = new AbortController();
  const file = new Blob(['original bytes'], { type: 'application/msword' });
  const response = { file: new Blob(['%PDF'], { type: 'application/pdf' }), fileName: 'preview.pdf' };
  (POST as jest.Mock).mockResolvedValue(response);
  await expect(convertLegacyOfficePreview(file, '合同.doc', controller)).resolves.toBe(response);
  const [url, data, config] = (POST as jest.Mock).mock.calls[0];
  expect(url).toBe('/byaiService/file-preview/legacy-office');
  expect((data.get('file') as File).name).toBe('合同.doc');
  expect((data.get('file') as File).size).toBe(file.size);
  expect(config).toEqual(expect.objectContaining({ responseType: 'blob', cancelToken: controller }));
});
