import JSZip from 'jszip';
import { preparePptxPreview } from './preparePptxPreview';

const namespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const masterType = 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';

// 复现生成文件的结构：两页共用母版 1，清单却残留不存在的母版 2。
async function createPresentation(orphan = true, referenced = false) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="${namespace}">
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${masterType}"/>
      ${orphan ? `<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="${masterType}"/>` : ''}
    </Types>`
  );
  zip.file('ppt/slideMasters/slideMaster1.xml', '<master/>');
  zip.file('ppt/slides/slide1.xml', '<slide>first</slide>');
  zip.file('ppt/slides/slide2.xml', '<slide>second</slide>');
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="../slideMasters/slideMaster${referenced ? 2 : 1}.xml"/>
    </Relationships>`
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('preparePptxPreview', () => {
  it('removes only the missing unreferenced master declaration and preserves all other parts', async () => {
    const source = await createPresentation();
    const original = await JSZip.loadAsync(source);
    const prepared = await JSZip.loadAsync(await preparePptxPreview(source));
    const manifest = await prepared.file('[Content_Types].xml')!.async('string');

    expect(manifest).not.toContain('slideMaster2.xml');
    expect(manifest).toContain('slideMaster1.xml');
    expect(manifest).toContain('application/xml');
    expect(Object.keys(prepared.files)).toEqual(Object.keys(original.files));
    for (const entry of Object.values(original.files)) {
      if (entry.dir || entry.name === '[Content_Types].xml') continue;
      expect(await prepared.file(entry.name)!.async('string')).toBe(await entry.async('string'));
    }
    expect(await original.file('[Content_Types].xml')!.async('string')).toContain('slideMaster2.xml');
  });

  it('returns the original buffer for a normal presentation', async () => {
    const source = await createPresentation(false);
    expect(await preparePptxPreview(source)).toBe(source);
  });

  it('does not remove a missing master that is actually referenced', async () => {
    await expect(preparePptxPreview(await createPresentation(true, true))).rejects.toThrow(
      'Missing referenced PPTX slide master'
    );
  });

  it('preserves declarations for existing masters even when unreferenced', async () => {
    const zip = await JSZip.loadAsync(await createPresentation());
    zip.file('ppt/slideMasters/slideMaster2.xml', '<master/>');
    const source = await zip.generateAsync({ type: 'arraybuffer' });
    expect(await preparePptxPreview(source)).toBe(source);
  });

  it('rejects invalid archives instead of returning an empty preview', async () => {
    await expect(preparePptxPreview(new ArrayBuffer(16))).rejects.toThrow();
  });
});
