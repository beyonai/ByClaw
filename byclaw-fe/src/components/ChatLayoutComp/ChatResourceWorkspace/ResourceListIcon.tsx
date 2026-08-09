import type { SVGProps } from 'react';

// 预览页签打开后使用列表图标，明确表示按钮用于展开/收起资源列表。
const ResourceListIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export default ResourceListIcon;
