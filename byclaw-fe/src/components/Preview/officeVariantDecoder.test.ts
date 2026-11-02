import JSZip from 'jszip';
import { prepareOfficeVariant } from './officeVariantDecoder';
import {
  OFFICE_VARIANTS,
  OFFICE_MAIN_CONTENT_TYPES,
  OFFICE_MAIN_PARTS,
  MAX_OFFICE_METADATA_BYTES,
  type OfficeVariantType,
} from './officeVariantTypes';
import { MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

const typesNs = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
function fixture(type: OfficeVariantType) {
  const base = OFFICE_VARIANTS[type];
  const main = OFFICE_MAIN_PARTS[base];
  const root = {
    docx: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文 report</w:t></w:r></w:p></w:body></w:document>',
    xlsx: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
    pptx: '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>',
  }[base];
  return new JSZip()
    .file(
      '[Content_Types].xml',
      `<Types xmlns="${typesNs}"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="${OFFICE_MAIN_CONTENT_TYPES[type]}"/></Types>`
    )
    .file(
      '_rels/.rels',
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`
    )
    .file(main, root);
}

describe('Office variant preview copies', () => {
  it.each(Object.keys(OFFICE_VARIANTS) as OfficeVariantType[])(
    'normalizes %s only after validating its actual package type',
    async (type) => {
      const original = await fixture(type).generateAsync({ type: 'arraybuffer' });
      const before = new Uint8Array(original).slice();
      const copy = await JSZip.loadAsync(await prepareOfficeVariant(original, type));
      expect(await copy.file('[Content_Types].xml')!.async('string')).toContain(
        OFFICE_MAIN_CONTENT_TYPES[OFFICE_VARIANTS[type]]
      );
      expect(copy.file(OFFICE_MAIN_PARTS[OFFICE_VARIANTS[type]])).not.toBeNull();
      expect(new Uint8Array(original)).toEqual(before);
      const source = await JSZip.loadAsync(original);
      expect(await source.file('[Content_Types].xml')!.async('string')).toContain(OFFICE_MAIN_CONTENT_TYPES[type]);
    }
  );

  it('removes VBA, ActiveX, embedded objects and external relationships from the copy', async () => {
    const zip = fixture('docm');
    zip
      .file('word/vbaProject.bin', 'macro')
      .file('word/activeX/a.bin', 'active')
      .file('word/embeddings/a.bin', 'object');
    zip.file('word/media/picture.png', new Uint8Array([1, 2, 3]));
    zip.file(
      'word/_rels/document.xml.rels',
      `<Relationships xmlns="${relNs}">
      <Relationship Id="macro" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>
      <Relationship Id="external" Type="image" TargetMode="External" Target="https://example.com/tracker.png"/>
      <Relationship Id="object" Type="oleObject" Target="embeddings/a.bin"/>
      <Relationship Id="local" Type="image" Target="media/picture.png"/>
    </Relationships>`
    );
    const copy = await JSZip.loadAsync(
      await prepareOfficeVariant(await zip.generateAsync({ type: 'arraybuffer' }), 'docm')
    );
    expect(copy.file('word/vbaProject.bin')).toBeNull();
    expect(copy.file('word/activeX/a.bin')).toBeNull();
    expect(copy.file('word/embeddings/a.bin')).toBeNull();
    expect(await copy.file('word/media/picture.png')!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]));
    const relationships = await copy.file('word/_rels/document.xml.rels')!.async('string');
    expect(relationships).not.toMatch(/macro|https:|oleObject/);
    expect(relationships).toContain('media/picture.png');
  });

  it('rejects renamed ordinary documents, missing roots and malformed main XML', async () => {
    const renamed = await fixture('dotx').generateAsync({ type: 'arraybuffer' });
    await expect(prepareOfficeVariant(renamed, 'docm')).rejects.toMatchObject({ code: 'invalid' });
    const missing = fixture('docm').remove('word/document.xml');
    await expect(
      prepareOfficeVariant(await missing.generateAsync({ type: 'arraybuffer' }), 'docm')
    ).rejects.toMatchObject({ code: 'invalid' });
    const malformed = fixture('docm').file('word/document.xml', '<root>');
    await expect(
      prepareOfficeVariant(await malformed.generateAsync({ type: 'arraybuffer' }), 'docm')
    ).rejects.toMatchObject({ code: 'invalid' });
    const redirected = fixture('docm').file('_rels/.rels', `<Relationships xmlns="${relNs}"/>`);
    await expect(
      prepareOfficeVariant(await redirected.generateAsync({ type: 'arraybuffer' }), 'docm')
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects DTD, path normalization and symlinks', async () => {
    const dtd = fixture('docm').file('[Content_Types].xml', `<!DOCTYPE Types><Types xmlns="${typesNs}"/>`);
    await expect(prepareOfficeVariant(await dtd.generateAsync({ type: 'arraybuffer' }), 'docm')).rejects.toMatchObject({
      code: 'unsupported',
    });
    const traversal = fixture('docm').file('../bad.xml', 'bad');
    await expect(
      prepareOfficeVariant(await traversal.generateAsync({ type: 'arraybuffer' }), 'docm')
    ).rejects.toMatchObject({ code: 'invalid' });
    const symlink = fixture('docm').file('link', 'word/document.xml', { unixPermissions: 0xa1ff });
    await expect(
      prepareOfficeVariant(await symlink.generateAsync({ type: 'arraybuffer', platform: 'UNIX' }), 'docm')
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('limits compressed input and actual expanded metadata', async () => {
    await expect(prepareOfficeVariant(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1), 'docm')).rejects.toMatchObject({
      code: 'limit',
    });
    const zip = fixture('docm').file('[Content_Types].xml', 'x'.repeat(MAX_OFFICE_METADATA_BYTES + 1));
    await expect(
      prepareOfficeVariant(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }), 'docm')
    ).rejects.toMatchObject({ code: 'limit' });
  });
});
