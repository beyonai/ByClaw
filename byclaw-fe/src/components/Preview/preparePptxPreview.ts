import JSZip from 'jszip';

const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const slideMasterType = 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';

const parseXml = (source: string) => {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error('Invalid PPTX XML');
  }
  return document;
};

/** 仅修正预览副本中的孤立母版声明，下载仍使用原文件。 */
export async function preparePptxPreview(source: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(source);
  const manifest = zip.file('[Content_Types].xml');
  if (!manifest) throw new Error('Missing PPTX content types');

  const document = parseXml(await manifest.async('string'));
  const missingMasters = Array.from(document.getElementsByTagNameNS(contentTypesNamespace, 'Override')).filter(
    (node) =>
      node.getAttribute('ContentType') === slideMasterType &&
      !zip.file((node.getAttribute('PartName') || '').replace(/^\//, ''))
  );
  if (!missingMasters.length) return source;

  // 真实被引用的母版不能删声明掩盖损坏；只兼容生成/合并 PPTX 留下的无引用声明。
  const referencedParts = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.rels')) continue;
    const owner = entry.name.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '');
    const relationships = parseXml(await entry.async('string'));
    for (const relationship of Array.from(
      relationships.getElementsByTagNameNS(relationshipsNamespace, 'Relationship')
    )) {
      const target = relationship.getAttribute('Target');
      if (!target || relationship.getAttribute('TargetMode') === 'External') continue;
      referencedParts.add(decodeURIComponent(new URL(target, `https://pptx.invalid/${owner}`).pathname));
    }
  }

  for (const node of missingMasters) {
    const partName = node.getAttribute('PartName') || '';
    if (!partName || referencedParts.has(partName)) {
      throw new Error('Missing referenced PPTX slide master');
    }
    node.parentNode?.removeChild(node);
  }
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(document));
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
