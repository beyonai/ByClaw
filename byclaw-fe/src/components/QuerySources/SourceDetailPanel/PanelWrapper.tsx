/**
 * SourceDetailPanel 组件
 * 详情Panel，用于查看搜索结果详情或预览知识来源
 */

import React from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { motion, AnimatePresence } from 'motion/react';
import styles from './index.less';

interface PanelWrapperProps {
  isOpen: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  afterClose?: () => void;
}

const PanelWrapper: React.FC<PanelWrapperProps> = (props) => {
  const { isOpen, title, onClose, children, afterClose } = props;

  const renderHeader = () => {
    return (
      <div className={styles.panelHeader}>
        <div className={styles.breadcrumb}>
          <span className={styles.breadcrumbTitle}>{title}</span>
          {/* <RightOutlined className={styles.breadcrumbSeparator} />
          <span className={styles.breadcrumbCurrent}>{title}</span> */}
        </div>
        <Button type="text" className={styles.closeButton} icon={<CloseOutlined />} onClick={onClose} />
      </div>
    );
  };

  return (
    <AnimatePresence onExitComplete={afterClose}>
      {isOpen && (
        <>
          {/* 遮罩层动画 - 白色半透明背景 */}
          <motion.div
            className={styles.mask}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
          {/* 内容层动画 - 占满整个区域，淡入效果 */}
          <motion.div
            className={styles.detailPanel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.3,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
          >
            {renderHeader()}
            <div className={styles.panelBody}>{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PanelWrapper;
