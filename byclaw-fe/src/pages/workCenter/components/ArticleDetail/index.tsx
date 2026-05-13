import { DeleteOutlined, DownloadOutlined, EditOutlined, ShareAltOutlined, StarOutlined } from '@ant-design/icons';
import { Button, message, Modal, Space, Tooltip } from 'antd';
import React from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

interface ArticleDetailProps {
  open: boolean;
  onClose: () => void;
  article: {
    title: string;
    description: string;
    type: string;
  } | null;
}

const ArticleDetail: React.FC<ArticleDetailProps> = ({ open, onClose, article }) => {
  const intl = useIntl();

  if (!article) return null;

  const handleShare = () => {
    message.info(intl.formatMessage({ id: 'workCenter.featureComingSoon' }));
  };

  const handleCollect = () => {
    message.info(intl.formatMessage({ id: 'workCenter.featureComingSoon' }));
  };

  const handleEdit = () => {
    message.info(intl.formatMessage({ id: 'workCenter.featureComingSoon' }));
  };

  const handleDelete = () => {
    message.info(intl.formatMessage({ id: 'workCenter.featureComingSoon' }));
  };

  const handleDownload = () => {
    message.info(intl.formatMessage({ id: 'workCenter.featureComingSoon' }));
  };

  return (
    <Modal
      title={null}
      open={open}
      footer={null}
      onCancel={onClose}
      width={800}
      className={styles.articleDetailModal}
      destroyOnHidden
    >
      <div className={styles.articleContent}>
        <div className={styles.header}>
          <h1 className={styles.title}>{article.title}</h1>
          <Space size={16} className={styles.operations}>
            <Tooltip title={intl.formatMessage({ id: 'common.share' })}>
              <Button type="text" icon={<ShareAltOutlined />} onClick={handleShare} />
            </Tooltip>
            <Tooltip title={intl.formatMessage({ id: 'workCenter.collect.add' })}>
              <Button type="text" icon={<StarOutlined />} onClick={handleCollect} />
            </Tooltip>
            <Tooltip title={intl.formatMessage({ id: 'common.edit' })}>
              <Button type="text" icon={<EditOutlined />} onClick={handleEdit} />
            </Tooltip>
            <Tooltip title={intl.formatMessage({ id: 'common.delete' })}>
              <Button type="text" icon={<DeleteOutlined />} onClick={handleDelete} className={styles.deleteBtn} />
            </Tooltip>
            <Tooltip title={intl.formatMessage({ id: 'common.download' })}>
              <Button type="text" icon={<DownloadOutlined />} onClick={handleDownload} />
            </Tooltip>
          </Space>
        </div>
        <div className={styles.meta}>
          <span className={styles.date}>{intl.formatMessage({ id: 'articleDetail.createTime' })}：2024-03-21</span>
          <span className={styles.author}>{intl.formatMessage({ id: 'articleDetail.author' })}：Beyond AI</span>
        </div>
        <div className={styles.content}>{article.description}</div>
      </div>
    </Modal>
  );
};

export default ArticleDetail;
