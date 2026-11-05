import JSZip from 'jszip';

const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const slideMasterType = 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';
const xmlnsNamespace = 'http://www.w3.org/2000/xmlns/';

const parseXml = (source: string) => {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error('Invalid PPTX XML');
  }
  return document;
};

// pptx-preview 按 Types / Relationships 等字面名称取节点，不识别合法的 ns0: 前缀。
// 仅规范包元数据中属于指定命名空间的元素，保留属性、外部链接和其他命名空间。
const normalizePackageElementNames = (document: Document, namespace: string) => {
  let changed = false;
  for (const element of Array.from(document.getElementsByTagNameNS(namespace, '*'))) {
    // 去掉此命名空间的别名，否则 XMLSerializer 可能重新给无前缀元素加上别名。
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI === xmlnsNamespace && attribute.prefix === 'xmlns' && attribute.value === namespace) {
        element.removeAttributeNode(attribute);
        changed = true;
      }
    }
    if (!element.prefix) continue;
    const replacement = document.createElementNS(namespace, element.localName);
    for (const attribute of Array.from(element.attributes)) {
      replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
    replacement.setAttributeNS(xmlnsNamespace, 'xmlns', namespace);
    while (element.firstChild) replacement.appendChild(element.firstChild);
    element.parentNode?.replaceChild(replacement, element);
    changed = true;
  }
  return changed;
};

/** 修正预览副本的包元数据兼容性，下载仍使用原文件。 */
export async function preparePptxPreview(source: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(source);
  const manifest = zip.file('[Content_Types].xml');
  if (!manifest) throw new Error('Missing PPTX content types');

  const document = parseXml(await manifest.async('string'));
  const manifestNormalized = normalizePackageElementNames(document, contentTypesNamespace);
  const missingMasters = Array.from(document.getElementsByTagNameNS(contentTypesNamespace, 'Override')).filter(
    (node) =>
      node.getAttribute('ContentType') === slideMasterType &&
      !zip.file((node.getAttribute('PartName') || '').replace(/^\//, ''))
  );
  let changed = manifestNormalized || missingMasters.length > 0;

  // 真实被引用的母版不能删声明掩盖损坏；只兼容生成/合并 PPTX 留下的无引用声明。
  const referencedParts = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.rels')) continue;
    const owner = entry.name.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '');
    const relationships = parseXml(await entry.async('string'));
    if (missingMasters.length) {
      for (const relationship of Array.from(
        relationships.getElementsByTagNameNS(relationshipsNamespace, 'Relationship')
      )) {
        const target = relationship.getAttribute('Target');
        if (!target || relationship.getAttribute('TargetMode') === 'External') continue;
        referencedParts.add(decodeURIComponent(new URL(target, `https://pptx.invalid/${owner}`).pathname));
      }
    }
    if (normalizePackageElementNames(relationships, relationshipsNamespace)) {
      zip.file(entry.name, new XMLSerializer().serializeToString(relationships), { createFolders: false });
      changed = true;
    }
  }

  for (const node of missingMasters) {
    const partName = node.getAttribute('PartName') || '';
    if (!partName || referencedParts.has(partName)) {
      throw new Error('Missing referenced PPTX slide master');
    }
    node.parentNode?.removeChild(node);
  }
  if (!changed) return source;
  if (manifestNormalized || missingMasters.length) {
    zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(document));
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
