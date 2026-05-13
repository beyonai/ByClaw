import RecallItem from '@/components/MessagesComp/Think/ThinkRewriteQuestion/components/rectifyQuestion/components/RecallItem';
import comStyles from '@/components/MessagesComp/Think/ThinkRewriteQuestion/components/rectifyQuestion/index.less';
import { CloseCircleFilled } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Input, Popconfirm } from 'antd';
import styles from '@/components/MessagesComp/Think/ThinkRewriteQuestion/index.module.less';

export default function RewriteString({
  item,
  handleChange,
  handleDelete,
  showLabel = true,
}: {
  item: {
    name: string;
    selectedName: string;
    list: { mergeName: string }[];
  };
  handleChange: (value: string) => void;
  handleDelete?: () => void;
  showLabel?: boolean;
}) {
  const intl = useIntl();
  // 没有选项，文本输入
  if (!item.list || !item.list.length) {
    return (
      <div className={`${comStyles.conditionItemNotComplete} ${comStyles.tagWrapper}`}>
        <Input
          size="small"
          className={`beyond-tag ${styles.input}`}
          placeholder={item.name}
          onChange={(e) => handleChange(e.target.value)}
        />
        {handleDelete && (
          <Popconfirm title={intl.formatMessage({ id: 'common.deleteTips' })} onConfirm={() => handleDelete()}>
            <span className={comStyles.deleteIcon} onClick={(e) => e.stopPropagation()}>
              <CloseCircleFilled />
            </span>
          </Popconfirm>
        )}
      </div>
    );
  }
  return (
    <RecallItem
      showInitSearch={false}
      showLabel={showLabel}
      item={item}
      mergeName={false}
      handleChoose={handleChange}
      handleDelete={handleDelete}
    />
  );
}
