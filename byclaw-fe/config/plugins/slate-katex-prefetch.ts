import { IApi } from '@umijs/max';
import { injectSlateKatexPrefetchToHtmlFiles } from '../utils/slateKatexPrefetch';

export default (api: IApi) => {
  const isDev = process.env.NODE_ENV === 'development';

  api.onBuildHtmlComplete(() => {
    if (isDev) {
      return;
    }

    const changedFiles = injectSlateKatexPrefetchToHtmlFiles(
      api.paths.absOutputPath,
      (api.userConfig.publicPath as string | undefined) || '/'
    );

    if (changedFiles.length === 0) {
      console.warn('[slate-katex-prefetch] 未找到 etag hash 产物或可写入的 HTML，跳过 prefetch 注入');
      return;
    }

    console.log(`[slate-katex-prefetch] 已注入 prefetch: ${changedFiles.length} 个 HTML 文件`);
  });
};
