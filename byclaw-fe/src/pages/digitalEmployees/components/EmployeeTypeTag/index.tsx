import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import cardStyles from '@/components/Resources/components/ResourceCard/index.module.less';

const EmployeeTypeTag = ({ ownerType, agentType }: { ownerType?: string; agentType?: string }) => {
  const intl = useIntl();
  const isPersonal = ['personal', 'personal_default'].includes(`${ownerType || ''}`.toLowerCase());
  const isGroup = `${agentType || ''}` === '017';
  const messageId = isPersonal
    ? isGroup
      ? 'digitalEmployees.tag.personalGroup'
      : 'digitalEmployees.tag.personalEmployee'
    : isGroup
    ? 'digitalEmployees.tag.enterpriseGroup'
    : 'digitalEmployees.tag.enterpriseEmployee';

  // 复用外部卡片的标签样式和翻译，不带卡片右上角的绝对定位。
  return (
    <span
      className={classnames(cardStyles.tag, {
        [cardStyles.digitalEmployeePersonalTag]: isPersonal,
        [cardStyles.digitalEmployeeEnterpriseTag]: !isPersonal,
      })}
    >
      <span className={cardStyles.tagText}>{intl.formatMessage({ id: messageId })}</span>
    </span>
  );
};

export default EmployeeTypeTag;
