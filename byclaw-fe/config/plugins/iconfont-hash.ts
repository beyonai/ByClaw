import { IApi } from '@umijs/max';
import fs from 'fs';
import path from 'path';
import { getIconfontFileName, getIconfontFilePath } from '../utils/iconfont';

/**
 * iconfont-hash 插件
 * 在构建时计算 iconfont.js 的 hash，并重命名为 iconfont.[hash].js
 * 通过 define 注入文件名到代码中，确保更新后浏览器加载最新文件
 */
export default (api: IApi) => {
  const isDev = process.env.NODE_ENV === 'development';
  const iconfontSourcePath = getIconfontFilePath(api.cwd);

  // 在构建完成后，复制并重命名文件
  api.onBuildComplete(() => {
    if (isDev) {
      return;
    }

    // 使用统一的工具函数获取文件名
    const hashedFileName = getIconfontFileName(api.cwd);

    // 如果获取的是默认文件名（hash 计算失败），则不进行复制
    if (hashedFileName === 'iconfont.js') {
      console.warn('[iconfont-hash] 无法获取 hash 文件名，跳过文件复制');
      return;
    }
    const distPath = api.paths.absOutputPath;
    const distJsDir = path.join(distPath, 'js');
    const distIconfontPath = path.join(distJsDir, hashedFileName);

    // 确保 dist/js 目录存在
    if (!fs.existsSync(distJsDir)) {
      fs.mkdirSync(distJsDir, { recursive: true });
    }

    // 复制文件并重命名
    try {
      fs.copyFileSync(iconfontSourcePath, distIconfontPath);
      console.log(`[iconfont-hash] 文件已复制并重命名: ${hashedFileName}`);

      // 清理旧的 hash 文件（可选，避免堆积）
      const files = fs.readdirSync(distJsDir);
      files.forEach((file) => {
        if (file !== 'iconfont.js' && file.startsWith('iconfont.') && file.endsWith('.js') && file !== hashedFileName) {
          const oldFilePath = path.join(distJsDir, file);
          fs.unlinkSync(oldFilePath);
          console.log(`[iconfont-hash] 已清理旧文件: ${file}`);
        }
      });
    } catch (error) {
      console.error('[iconfont-hash] 复制文件失败:', error);
    }
  });

  // 在开发环境，确保 public/js/iconfont.js 可以被访问
  if (isDev) {
    api.onDevCompileDone(() => {
      if (!fs.existsSync(iconfontSourcePath)) {
        console.warn(`[iconfont-hash] 开发环境警告: ${iconfontSourcePath} 不存在`);
      }
    });
  }
};
