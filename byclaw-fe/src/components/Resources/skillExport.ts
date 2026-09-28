import JSZip from 'jszip';
import { downloadSkillZip } from '@/pages/manager/service/resources';
import { isWorkspaceSkill, type WorkspaceSkillItem } from './workspaceSkill/utils';

const MANIFEST = 'byclaw-skills.json';
const FORMAT = 'byclaw-skill-packages-v1';

export const saveSkillFile = (file: Blob, fileName: string) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 浏览器开始读取下载后再释放，避免大文件下载被提前撤销。
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export const fetchSkillPackage = async (item: WorkspaceSkillItem, digitalEmployeeId?: string | number) => {
  const result = await downloadSkillZip(
    isWorkspaceSkill(item) ? { skillPath: item.skillPath, resourceId: digitalEmployeeId } : { skillId: item.resourceId }
  );
  if (!(result?.file instanceof Blob) || !result.file.size) throw new Error('common.downloadFailed');
  return { file: result.file as Blob, fileName: result.fileName || `${item.resourceCode || item.resourceName}.zip` };
};

/** 保留每个原始 ZIP 的字节和文件名（根目录 SKILL.md 的技能编码依赖文件名）。 */
export const buildSkillBundle = async (items: WorkspaceSkillItem[], digitalEmployeeId?: string | number) => {
  const zip = new JSZip();
  const packages: Array<{ path: string; fileName: string }> = [];
  for (const [index, item] of items.entries()) {
    const { file, fileName } = await fetchSkillPackage(item, digitalEmployeeId);
    const path = `packages/${index}.zip`;
    zip.file(path, file);
    packages.push({ path, fileName });
  }
  zip.file(MANIFEST, JSON.stringify({ format: FORMAT, packages }));
  return zip.generateAsync({ type: 'blob' });
};

/** 批量导出包在上传前还原成原始 ZIP，冲突检查和导入继续共用现有后端契约。 */
export const expandSkillImportFiles = async (files: File[]): Promise<File[]> => {
  const expanded: File[] = [];
  for (const file of files) {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file(MANIFEST);
    if (!manifestFile) {
      expanded.push(file);
      continue;
    }
    const manifest = JSON.parse(await manifestFile.async('string'));
    if (manifest.format !== FORMAT || !Array.isArray(manifest.packages) || !manifest.packages.length) {
      throw new Error('resource.skillExport.invalidBundle');
    }
    for (const item of manifest.packages) {
      const entry = typeof item.path === 'string' ? zip.file(item.path) : null;
      if (!entry || typeof item.fileName !== 'string' || !item.fileName.toLowerCase().endsWith('.zip')) {
        throw new Error('resource.skillExport.invalidBundle');
      }
      expanded.push(
        new File([await entry.async('blob')], item.fileName, {
          type: 'application/zip',
          // 同名且等长的不同技能包也必须保留，不能被上传列表的文件去重吞掉。
          lastModified: file.lastModified + expanded.length,
        })
      );
    }
  }
  return expanded;
};
