import { Breadcrumb } from 'antd';
import styles from './index.module.less';

export type FloderPath = {
  title: string;
  href?: string;
};

type knowledgeBreadcrumbProps = {
  folderPath: FloderPath[];
  handleBreadcrumbClick: (index: number) => void;
};

const KnowledgeBreadcrumb = (props: knowledgeBreadcrumbProps) => {
  const { folderPath, handleBreadcrumbClick } = props;
  return (
    <Breadcrumb separator=">">
      {folderPath.map((path, index) => (
        <Breadcrumb.Item
          key={index}
          onClick={() => handleBreadcrumbClick(index)}
          className={index !== folderPath.length - 1 ? styles.breadcrumbPointerItem : styles.breadcrumbItem} // 添加样式类
        >
          {path.title}
        </Breadcrumb.Item>
      ))}
    </Breadcrumb>
  );
};

export default KnowledgeBreadcrumb;
