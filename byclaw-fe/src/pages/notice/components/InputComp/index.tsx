// @ts-ignore
import { connect, getIntl } from '@umijs/max';
import classNames from 'classnames';
import { get } from 'lodash';
import { Button, Dropdown } from 'antd';

import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';

import superCtyles from '@/components/QueryInput/index.module.less';
import styles from './index.module.less';

type IState = {
  // enterpriseInformation: boolean;
  deepThink: boolean;
  // connectNet: boolean;
  showMentionPopoverType: '' | '@' | '#';
} & pIState;

type IProps = {
  dispatch?: any;
} & pIProps;

const dropdownItems = [
  {
    key: 'todaySummary',
    label: getIntl().formatMessage({ id: 'notice.inputComp.todaySummary' }),
  },
  {
    key: 'weekSummary',
    label: getIntl().formatMessage({ id: 'notice.inputComp.weekSummary' }),
  },
];

class InputComp extends QueryInputBase<IProps, IState> {
  render() {
    const intl = getIntl();

    return (
      <>
        <div className="ub ub-ac gap8" style={{ marginBottom: '6px' }}>
          <Dropdown
            menu={{
              items: dropdownItems,
              onClick: (e) => {
                const target = dropdownItems.find((item) => item.key === e.key);
                if (target) {
                  this.setState({
                    inputValue: target.label,
                  });
                  this.richInputRef.current?.setText(target.label);
                }
              },
            }}
            placement="top"
          >
            <Button
              shape="round"
              size="small"
              style={{ fontSize: '14px', padding: '0 12px' }}
              icon={<i className={classNames(styles.star)} />}
            >
              {intl.formatMessage({ id: 'notice.inputComp.smartSummary' })}
            </Button>
          </Dropdown>

          <Button
            shape="round"
            size="small"
            style={{ fontSize: '14px', padding: '0 12px' }}
            icon={<i className={classNames(styles.star)} />}
            disabled
          >
            {intl.formatMessage({ id: 'notice.inputComp.smartApproval' })}
          </Button>
        </div>
        <div className={classNames(styles.queryInput)} data-isbottom="true">
          <div className={classNames(superCtyles.inputBlock)} id="guideStep1-1">
            {this.inputUpper()}
            {this.renderInput()}
            {this.inputLower()}
            {this.extendRender()}
          </div>
        </div>
      </>
    );
  }
}

export default connect(
  ({ user }: any) => {
    return {
      userInfo: get(user, 'userInfo'),
    };
  },
  null,
  null,
  { forwardRef: true }
)(InputComp);
