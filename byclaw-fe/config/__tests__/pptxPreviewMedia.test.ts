import { readFileSync, realpathSync } from 'fs';
import { createRequire } from 'module';
import JSZip from 'jszip';
import ts from 'typescript';

const transform = require('../loaders/pptx-preview-media');
const packageRequire = createRequire(realpathSync(require.resolve('pptx-preview/package.json')));
const publishedSource = readFileSync(packageRequire.resolve('pptx-preview'), 'utf8');
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const presentationNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="red"/></svg>';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFioAAAAASUVORK5CYII=',
  'base64'
);

function loadPublishedLibrary(source: string) {
  const compiled = ts.transpileModule(source, {
    fileName: 'pptx-preview.js',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(packageRequire, loaded, loaded.exports);
  return loaded.exports as typeof import('pptx-preview');
}

// A complete, content-free slide with both a picture and a background using the same media relationship.
async function createPresentation(filename: string, bytes: string | Buffer) {
  const zip = new JSZip();
  const contentTypePrefix = 'application/vnd.openxmlformats-officedocument.presentationml.';
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${contentTypePrefix}slideMaster+xml"/>
      <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${contentTypePrefix}slideLayout+xml"/>
      <Override PartName="/ppt/slides/slide1.xml" ContentType="${contentTypePrefix}slide+xml"/>
    </Types>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${presentationNamespace}" xmlns:a="${drawingNamespace}">
      <p:sldSz cx="9144000" cy="5143500"/><p:defaultTextStyle/>
    </p:presentation>`
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<p:sldMaster xmlns:p="${presentationNamespace}"><p:cSld><p:spTree/></p:cSld></p:sldMaster>`
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<p:sldLayout xmlns:p="${presentationNamespace}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="${presentationNamespace}" xmlns:a="${drawingNamespace}" xmlns:r="${relationshipsNamespace}">
      <p:cSld>
        <p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:bgPr></p:bg>
        <p:spTree><p:pic>
          <p:nvPicPr><p:cNvPr id="1" name="Fixture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm></p:spPr>
        </p:pic></p:spTree>
      </p:cSld>
    </p:sld>`
  );
  const relationships = (inner: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships(''));
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    relationships(
      `<Relationship Id="rId1" Type="${relationshipsNamespace}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`
    )
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    relationships(
      `<Relationship Id="rId1" Type="${relationshipsNamespace}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
       <Relationship Id="rId2" Type="${relationshipsNamespace}/image" Target="../media/${filename}"/>`
    )
  );
  zip.file(`ppt/media/${filename}`, bytes);
  zip.file('ppt/media/readme.txt', 'Not an image');
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('pptx-preview media compatibility', () => {
  const viewers: Array<ReturnType<typeof import('pptx-preview')['init']>> = [];

  afterEach(() => viewers.splice(0).forEach((viewer) => viewer.destroy()));

  it.each<[string, string | Buffer, string]>([
    ['slide_001.svg', svg, 'image/svg+xml'],
    ['slide_001.SVG', svg, 'image/svg+xml'],
    ['diagram.png', png, 'image/png'],
    ['diagram.PNG', png, 'image/png'],
    ['image1.custom', png, 'image/*'],
  ])('renders picture and background media for %s without changing bytes', async (filename, bytes, mime) => {
    const root = document.createElement('div');
    const viewer = loadPublishedLibrary(transform(publishedSource)).init(root, { width: 720, height: 405 });
    viewers.push(viewer);
    await viewer.preview(await createPresentation(filename, bytes));

    const expected = `data:${mime};base64,${(typeof bytes === 'string' ? Buffer.from(bytes) : bytes).toString(
      'base64'
    )}`;
    expect(viewer.slideCount).toBe(1);
    expect(root.querySelectorAll('.pptx-preview-slide-wrapper')).toHaveLength(1);
    expect(root.querySelector('img')?.getAttribute('src')).toBe(expected);
    expect((root.querySelector('.slide-background') as HTMLElement).style.backgroundImage).toContain(expected);
    expect(Object.keys(viewer.pptx.medias)).toEqual([`ppt/media/${filename}`]);
  });

  it('rejects a changed dependency instead of silently skipping media fixes', () => {
    expect(() => transform('export function init() {}')).toThrow('pptx-preview 1.0.7');
  });

  it('requires review of a new dependency version even when its source still matches', () => {
    try {
      jest.isolateModules(() => {
        jest.doMock('pptx-preview/package.json', () => ({ version: '1.0.8' }));
        const changedVersionTransform = require('../loaders/pptx-preview-media');
        expect(() => changedVersionTransform(publishedSource)).toThrow('version 1.0.8');
      });
    } finally {
      jest.dontMock('pptx-preview/package.json');
    }
  });

  it('rejects duplicate copies of the patch target', () => {
    expect(() => transform(publishedSource + publishedSource)).toThrow('pptx-preview 1.0.7');
  });

  it('rejects partially changed media handling', () => {
    const changedMimeSwitch = publishedSource.replace('case"gif":e="image/gif";break;', 'case"gif":e="image/gif";');
    expect(() => transform(changedMimeSwitch)).toThrow('pptx-preview 1.0.7');
  });
});
