/* eslint-disable react/react-in-jsx-scope */
import type { IMessage, NewIMessageListItem } from '@/typescript/message';
import ThinkNewRootTitle from './components/ThinkNewRootTitle';
import ThinkOldRootTitle from './components/ThinkOldRootTitle';

type IProps = {
  messageListItemContent: { substance: string };
  message: IMessage;
  updateMessageListItemContent: (path: string, val: any) => void;

  messageChildren?: NewIMessageListItem[];
  messageIsCollapsed?: boolean;
  messageIconType?: number;
};
export default function ThinkRootTitle(props: IProps) {
  const {
    message,
    messageListItemContent,
    messageChildren,
    messageIsCollapsed,
    messageIconType,
    updateMessageListItemContent,
  } = props;
  const hasChildren = !!messageChildren && Object.keys(messageChildren).length > 0;
  // 根据是否有messageChildren决定渲染哪个子组件,
  // ThinkNewRootTitle是数据层级有变，改成树形结构，方便折叠；
  // ThinkOldRootTitle是数据层级没有变，还是平铺结构，不方便折叠

  return (
    <>
      {hasChildren && (
        <ThinkNewRootTitle
          message={message}
          messageListItemContent={messageListItemContent}
          messageChildren={messageChildren}
          messageIsCollapsed={messageIsCollapsed}
          messageIconType={messageIconType}
          updateMessageListItemContent={updateMessageListItemContent}
        />
      )}
      {!hasChildren && <ThinkOldRootTitle message={message} messageListItemContent={messageListItemContent} />}
    </>
  );
}
