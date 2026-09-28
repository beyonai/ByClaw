import JSZip from 'jszip';
import { downloadSkillZip } from '@/pages/manager/service/resources';
import { buildSkillBundle, expandSkillImportFiles, fetchSkillPackage } from '../skillExport';

jest.mock('@/pages/manager/service/resources', () => ({ downloadSkillZip: jest.fn() }));

const readBytes = (file: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

beforeEach(() => jest.resetAllMocks());

it('round trips multiple ZIPs with their original names, binary attachments and executable permissions', async () => {
  const source = new JSZip();
  source.file('SKILL.md', '---\nname: demo\n---\nBody');
  source.file('scripts/run.sh', '#!/bin/sh\necho ok', { unixPermissions: 0o100755 });
  source.file('assets/binary.dat', new Uint8Array([0, 255, 34, 128]));
  const blob = await source.generateAsync({ type: 'blob', platform: 'UNIX' });
  (downloadSkillZip as jest.Mock).mockResolvedValue({ file: blob, fileName: 'original-code.zip' });
  const bundle = await buildSkillBundle([{ resourceId: '1' }, { resourceId: '2' }]);
  const files = await expandSkillImportFiles([new File([bundle], 'skills.zip')]);
  expect(files.map((file) => file.name)).toEqual(['original-code.zip', 'original-code.zip']);
  expect(new Uint8Array(await readBytes(files[0]))).toEqual(new Uint8Array(await readBytes(blob)));
  const restored = await JSZip.loadAsync(files[1]);
  expect(restored.file('scripts/run.sh')?.unixPermissions).toBe(0o100755);
  expect(await restored.file('assets/binary.dat')?.async('uint8array')).toEqual(new Uint8Array([0, 255, 34, 128]));
});

it('keeps an ordinary single skill ZIP unchanged', async () => {
  const zip = new JSZip().file('demo/SKILL.md', 'description: Demo');
  const file = new File([await zip.generateAsync({ type: 'blob' })], 'demo.zip');
  expect(await expandSkillImportFiles([file])).toEqual([file]);
});

it('routes workspace skills through the active employee and built-in skills through skillId', async () => {
  (downloadSkillZip as jest.Mock).mockResolvedValue({ file: new Blob(['zip']), fileName: 'demo.zip' });
  await fetchSkillPackage({ resourceId: '12', skillType: 'inner' });
  expect(downloadSkillZip).toHaveBeenLastCalledWith({ skillId: '12' });
  await fetchSkillPackage(
    { resourceBizType: 'SKILL', resourceBacked: false, skillPath: '/workspace/skills/demo' },
    '7'
  );
  expect(downloadSkillZip).toHaveBeenLastCalledWith({ skillPath: '/workspace/skills/demo', resourceId: '7' });
});

it('does not return a partial export when one package fails', async () => {
  (downloadSkillZip as jest.Mock)
    .mockResolvedValueOnce({ file: new Blob(['zip']), fileName: 'a.zip' })
    .mockRejectedValueOnce(new Error('unavailable'));
  await expect(buildSkillBundle([{ resourceId: '1' }, { resourceId: '2' }])).rejects.toThrow('unavailable');
});

it('rejects a manifest referencing a missing package', async () => {
  const zip = new JSZip().file(
    'byclaw-skills.json',
    JSON.stringify({
      format: 'byclaw-skill-packages-v1',
      packages: [{ path: 'packages/0.zip', fileName: 'demo.zip' }],
    })
  );
  await expect(
    expandSkillImportFiles([new File([await zip.generateAsync({ type: 'blob' })], 'skills.zip')])
  ).rejects.toThrow('resource.skillExport.invalidBundle');
});
