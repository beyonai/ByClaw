import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * iconfont 文件名处理工具
 * 统一管理 iconfont.js 的 hash 计算和文件名生成逻辑
 */

/**
 * 计算文件的 MD5 hash（取前 8 位）
 * @param filePath 文件路径
 * @returns hash 字符串，如果文件不存在或计算失败返回空字符串
 */
export function calculateFileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return '';
  }

  try {
    const fileContent = fs.readFileSync(filePath);
    const hash = crypto.createHash('md5').update(fileContent).digest('hex').slice(0, 8);
    return hash;
  } catch (error) {
    console.warn(`[iconfont-utils] 计算 hash 失败: ${filePath}`, error);
    return '';
  }
}

/**
 * 获取 iconfont.js 的完整文件路径
 * @param cwd 项目根目录路径
 * @returns iconfont.js 的完整路径
 */
export function getIconfontFilePath(cwd: string): string {
  return path.join(cwd, 'public/js/iconfont.js');
}

/**
 * 获取 iconfont 的文件名（开发环境返回原文件名，生产环境返回带 hash 的文件名）
 * @param cwd 项目根目录路径
 * @returns 文件名，例如 'iconfont.js' 或 'iconfont.a1b2c3d4.js'
 */
export function getIconfontFileName(cwd: string): string {
  const isDev = process.env.NODE_ENV === 'development';

  // 开发环境直接返回原文件名
  if (isDev) {
    return 'iconfont.js';
  }

  // 生产环境计算 hash
  const iconfontPath = getIconfontFilePath(cwd);
  const hash = calculateFileHash(iconfontPath);

  if (!hash) {
    // hash 计算失败时返回默认文件名
    return 'iconfont.js';
  }

  return `iconfont.${hash}.js`;
}
