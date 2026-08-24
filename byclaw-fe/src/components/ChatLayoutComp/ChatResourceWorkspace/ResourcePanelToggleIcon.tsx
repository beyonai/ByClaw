import type { SVGProps } from 'react';

// 会话资源入口使用与设计稿一致的左右分栏轮廓，避免复用文件夹图标造成“打开目录”的歧义。
const ResourcePanelToggleIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <rect x="3.5" y="5" width="17" height="14" rx="4" stroke="currentColor" strokeWidth="1.8" />
    <path d="M15 5.5V18.5" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export default ResourcePanelToggleIcon;
