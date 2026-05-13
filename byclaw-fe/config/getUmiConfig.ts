import md5 from 'md5';
import { getIconfontFileName } from './utils/iconfont';

const constantAssetNames = [
  {
    // 首页一定会用到的资源
    key: 'slate-katex',
    name: `etag.${md5('slate-katex').slice(0, 8)}`,
    // test: /[\\/](\.pnpm[\\/](katex@0\.16\.|slate@0\.117\.|slate-react@0\.117\.|slate-history@0\.113\.|slate-dom@0\.117\.|lodash@|react-activation@)|node_modules[\\/](?!(\.pnpm)))(katex|slate|slate-react|slate-history|slate-dom|lodash|react-activation)[\\/]/,
    test: /[\\/]node_modules[\\/](katex|slate|slate-react|slate-history|slate-dom)[\\/]/,
  },
];

export default function getUmiConfig(publicPath: string, cwd?: string) {
  const currentCwd = cwd || process.cwd();
  const iconfontFileName = getIconfontFileName(currentCwd);

  return {
    define: {
      ICONFONT_FILE_NAME: iconfontFileName,
    },
    links: constantAssetNames.map(item => ({
      href: `${publicPath}${item.name}.js`,
      rel: 'prefetch',
    })).concat([{
      href: `${publicPath}js/${iconfontFileName}`,
      rel: 'prefetch',
    }, {
      // LCP 图片：preload + fetchpriority=high，满足 Lighthouse LCP 发现与优先级要求（img 上已有 fetchPriority="high"）
      rel: 'preload',
      href: `${publicPath}beyond/assistant.png`,
      as: 'image',
      fetchpriority: 'high',
    } as { href: string; rel: string; as?: string; fetchpriority?: string }]),
    cacheGroups: constantAssetNames.reduce((acc: Record<string, any>, item) => {
      acc[item.key] = {
        name: item.name,
        test: item.test,
        priority: 20,
        reuseExistingChunk: true,
      };
      return acc;
    }, {}),
  };
}
