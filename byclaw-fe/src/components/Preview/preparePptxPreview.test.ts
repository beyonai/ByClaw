import JSZip from 'jszip';
import { preparePptxPreview } from './preparePptxPreview';

const namespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const masterType = 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';

const prefixManifest = (xml: string, prefix: string) =>
  xml
    .replace(`xmlns="${namespace}"`, `xmlns:${prefix}="${namespace}"`)
    .replace(/<(\/?)(Types|Default|Override)(?=[\s/>])/g, `<$1${prefix}:$2`);

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

async function createPrefixedPresentation(referenced: boolean) {
  const zip = await JSZip.loadAsync(await createPresentation(true, referenced));
  zip.file('[Content_Types].xml', prefixManifest(await zip.file('[Content_Types].xml')!.async('string'), 'ns0'));
  const relationshipName = 'ppt/slideLayouts/_rels/slideLayout1.xml.rels';
  zip.file(
    relationshipName,
    (await zip.file(relationshipName)!.async('string'))
      .replace(`xmlns="${relationshipsNamespace}"`, `xmlns:ns0="${relationshipsNamespace}"`)
      .replace(/<(\/?)(Relationships|Relationship)(?=[\s/>])/g, '<$1ns0:$2')
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('preparePptxPreview', () => {
  it.each([
    ['ns0', true, false],
    ['pkg', false, true],
    ['package', true, true],
  ])(
    'normalizes package XML names for prefix %s (manifest=%s, relationships=%s)',
    async (prefix, manifestPrefix, relsPrefix) => {
      const zip = await JSZip.loadAsync(await createPresentation(false));
      if (manifestPrefix) {
        const manifest = await zip.file('[Content_Types].xml')!.async('string');
        zip.file('[Content_Types].xml', prefixManifest(manifest, String(prefix)));
      }
      const relationshipName = 'ppt/slides/_rels/slide1.xml.rels';
      const qualifier = relsPrefix ? `${prefix}:` : '';
      zip.file(
        relationshipName,
        `<${qualifier}Relationships xmlns${
          relsPrefix ? `:${prefix}` : ''
        }="${relationshipsNamespace}" xmlns:custom="urn:custom">
        <${qualifier}Relationship Id="rId1" Type="slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <${qualifier}Relationship Id="rId2" Type="hyperlink" Target="https://example.test/?a=1&amp;b=2" TargetMode="External" custom:note="kept"/>
        <custom:Relationship custom:id="extension"/>
      </${qualifier}Relationships>`
      );
      // 真实生成的 PPTX 可能只有文件条目，没有显式目录条目。
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) delete zip.files[entry.name];
      }
      const source = await zip.generateAsync({ type: 'arraybuffer' });
      const originalBytes = new Uint8Array(source).slice();
      const preview = await preparePptxPreview(source);
      expect(await preparePptxPreview(preview)).toBe(preview);
      const prepared = await JSZip.loadAsync(preview);
      const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
      const manifest = parse(await prepared.file('[Content_Types].xml')!.async('string'));
      expect(manifest.documentElement.tagName).toBe('Types');
      expect(manifest.getElementsByTagName('Override')[0].getAttribute('PartName')).toBe(
        '/ppt/slideMasters/slideMaster1.xml'
      );
      expect(manifest.getElementsByTagName('Default')[0].getAttribute('ContentType')).toBe('application/xml');
      expect(manifest.documentElement.namespaceURI).toBe(namespace);

      const relationships = parse(await prepared.file(relationshipName)!.async('string'));
      expect(relationships.documentElement.tagName).toBe('Relationships');
      expect(relationships.documentElement.namespaceURI).toBe(relationshipsNamespace);
      const entries = Array.from(relationships.getElementsByTagName('Relationship'));
      expect(entries.map((entry) => [entry.getAttribute('Id'), entry.getAttribute('Target')])).toEqual([
        ['rId1', '../slideLayouts/slideLayout1.xml'],
        ['rId2', 'https://example.test/?a=1&b=2'],
      ]);
      expect(entries[1].getAttribute('TargetMode')).toBe('External');
      expect(entries[1].getAttributeNS('urn:custom', 'note')).toBe('kept');
      expect(relationships.getElementsByTagNameNS('urn:custom', 'Relationship')).toHaveLength(1);
      expect(Object.keys(prepared.files)).toEqual(Object.keys(zip.files));
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name === '[Content_Types].xml' || entry.name === relationshipName) continue;
        expect(await prepared.file(entry.name)!.async('uint8array')).toEqual(await entry.async('uint8array'));
      }
      expect(new Uint8Array(source)).toEqual(originalBytes);
    }
  );

  it.each([
    `<Types xmlns="${namespace}" xmlns:pkg="${namespace}"><pkg:Default Extension="xml" ContentType="application/xml"/></Types>`,
    `<pkg:Types xmlns:pkg="${namespace}"><Default xmlns="${namespace}" Extension="xml" ContentType="application/xml"/></pkg:Types>`,
    `<Types xmlns="${namespace}" xmlns:pkg="${namespace}"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  ])('normalizes mixed or redundant namespace prefixes: %s', async (xml) => {
    const zip = await JSZip.loadAsync(await createPresentation(false));
    zip.file('[Content_Types].xml', xml);
    const prepared = await JSZip.loadAsync(await preparePptxPreview(await zip.generateAsync({ type: 'arraybuffer' })));
    const manifest = new DOMParser().parseFromString(
      await prepared.file('[Content_Types].xml')!.async('string'),
      'application/xml'
    );
    expect(manifest.documentElement.tagName).toBe('Types');
    expect(manifest.getElementsByTagName('Default')[0].namespaceURI).toBe(namespace);
  });

  it('removes an unreferenced missing master from a prefixed manifest', async () => {
    const prepared = await JSZip.loadAsync(await preparePptxPreview(await createPrefixedPresentation(false)));
    const manifest = await prepared.file('[Content_Types].xml')!.async('string');
    expect(manifest).not.toContain('slideMaster2.xml');
    expect(manifest).toContain('slideMaster1.xml');
  });

  it('rejects a missing master referenced by a prefixed relationship file', async () => {
    await expect(preparePptxPreview(await createPrefixedPresentation(true))).rejects.toThrow(
      'Missing referenced PPTX slide master'
    );
  });

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
