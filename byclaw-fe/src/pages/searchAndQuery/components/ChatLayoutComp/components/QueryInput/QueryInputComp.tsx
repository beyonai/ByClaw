/* eslint-disable react/react-in-jsx-scope */
import React from 'react';

import { connect } from '@umijs/max';
import { Space, Select, Avatar } from 'antd';
import classnames from 'classnames';
import { get, isEmpty, pullAllBy, trim, isString, size } from 'lodash';

import CarouselFile from '@/components/MessageList/components/CarouselFile';
import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';
import { chatModeMap } from '@/constants/query';
import { SourceRootIdMap, rootInfoMap } from '@/components/QuerySources/const';
import AntdIcon from '@/components/AntdIcon';
import { getSourceRootIdBySourceTreeNodeType } from '@/components/QuerySources/utils';

import type { UserState } from '@/models/common/user';
import type { KnowledgeSource, SourceTreeNodeType } from '@/components/QuerySources/types';

import queryStyles from '@/components/QueryInput/index.module.less';
import chatStyles from '@/components/QueryInput/Chat/index.module.less';
import styles from './index.module.less';

type IState = {
  SQMode: 'deep_search' | 'instant_search';
  checkedResourceList: KnowledgeSource[];
} & pIState;

type IProps = {
  dispatch?: any;
  userInfo?: UserState;
} & pIProps;

const ON_CHECK_CHANGE_KEY = 'searchAndQueryInput';

const GET_ENABLE_SOURCE_ROOT_IDS_MAP = (SQMode: 'deep_search' | 'instant_search' | 'all') => {
  if (SQMode === 'instant_search') {
    return [SourceRootIdMap.knowledgeBases, SourceRootIdMap.enterpriseKnowledgeBases];
  }

  if (SQMode === 'deep_search') {
    return Object.keys(SourceRootIdMap).map(
      (key) => SourceRootIdMap[key as (typeof SourceRootIdMap)[keyof typeof SourceRootIdMap]]
    );
  }

  return [];
};

class QueryInputChat extends QueryInputBase<IProps, IState> {
  constructor(props: IProps) {
    const superClass = super(props) as any;

    this.state = {
      ...superClass.state,
      SQMode: 'instant_search',
      inputValue: '',
      checkedResourceList: [],
    };

    this.onResourceSelectChange = this.onResourceSelectChange.bind(this);
  }

  componentDidUpdate(
    _prevProps: Readonly<{ dispatch?: any; userInfo?: UserState } & pIProps>,
    prevState: Readonly<Partial<pIState> & { SQMode: 'deep_search' | 'instant_search' } & pIState>
  ): void {
    if (prevState.SQMode !== this.state.SQMode) {
      this.props.globalContext.EventEmitter.emit(
        'querysources-enable-rootid-list',
        GET_ENABLE_SOURCE_ROOT_IDS_MAP(this.state.SQMode)
      );
    }
  }

  componentWillUnmount() {
    super.componentWillUnmount();

    this.props.globalContext.EventEmitter.emit(
      'querysources-enable-rootid-list',
      GET_ENABLE_SOURCE_ROOT_IDS_MAP('all')
    );
    this.props.globalContext.EventEmitter.emit('querysources-unregister-oncheckchange', ON_CHECK_CHANGE_KEY);
  }

  componentDidMount() {
    super.componentDidMount();

    this.props.globalContext.EventEmitter.emit(
      'querysources-enable-rootid-list',
      GET_ENABLE_SOURCE_ROOT_IDS_MAP(this.state.SQMode)
    );
    this.props.globalContext.EventEmitter.emit('querysources-register-oncheckchange', {
      key: ON_CHECK_CHANGE_KEY,
      callback: this.onResourceSelectChange,
    });
  }

  onResourceSelectChange = (list: KnowledgeSource[]) => {
    this.setState((prevState) => ({
      ...prevState,
      checkedResourceList: list,
    }));
  };

  getSendPayload = () => {
    const { inputValue, SQMode, checkedResourceList } = this.state;
    const { myAgentType } = this.props;

    const sendVal = trim(inputValue);

    if (!sendVal) return null;

    const queryPayload: any = {
      queryQuestion: sendVal,
      payload: {
        agentType: myAgentType,
        extParams: {
          mode: SQMode,
          datasetIds: checkedResourceList.map((item) => item.datasetId),
        },
        mode: chatModeMap.searchQuery,
      },
    };

    return queryPayload;
  };

  inputUpper = () => {
    const { fileList } = this.state;

    const items: any[] = [];
    items.push(
      ...(fileList || []).map((file) => {
        return {
          fileItem: file,
          renderFileType: 'file',
        };
      })
    );
    if (isEmpty(items)) return null;

    return (
      <div className={queryStyles.inputUpperBlock}>
        {!isEmpty(items) && (
          <div className={classnames(queryStyles.filesListBlock)}>
            <CarouselFile
              items={items}
              onClose={(fileItem) => {
                this.setState((prevState) => {
                  return {
                    ...prevState,
                    fileList: pullAllBy(prevState.fileList || [], [fileItem?.fileItem], 'uid'),
                  };
                });
              }}
            />
          </div>
        )}
      </div>
    );
  };

  bottomLeftRender = () => {
    const { SQMode, checkedResourceList } = this.state;

    const typeSet = new Set<SourceTreeNodeType>();
    checkedResourceList.forEach((item) => {
      typeSet.add(item.type);
    });

    return (
      <Space>
        <Select
          value={SQMode}
          popupMatchSelectWidth={false}
          popupClassName={chatStyles.chatModePopup}
          placement="bottomRight"
          options={[
            {
              label: '即时搜索',
              value: 'instant_search',
            },
            {
              label: '深度搜索',
              value: 'deep_search',
            },
          ]}
          onSelect={(value) => {
            this.setState({
              SQMode: value,
            });
          }}
        />
        {!!size(checkedResourceList) && (
          <div className={classnames(styles.avatarGroup, 'ub ub-ac gap2')}>
            <Avatar.Group size="small">
              {[...typeSet].map((type) => {
                let IconComp: any = rootInfoMap[getSourceRootIdBySourceTreeNodeType(type)].icon;
                if (isString(IconComp) && IconComp?.startsWith('icon-')) {
                  IconComp = <AntdIcon type={IconComp as string} />;
                } else {
                  IconComp = <IconComp />;
                }
                return <Avatar key={type} icon={IconComp} />;
              })}
            </Avatar.Group>
            <div className={styles.avatarGroupCount}>+{size(checkedResourceList)}</div>
          </div>
        )}
      </Space>
    );
  };

  bottomRightRender = () => {
    return (
      <>
        <Space size="large" className={chatStyles.bottomRight}>
          {this.STTRender()}
        </Space>
      </>
    );
  };

  onSendQuery = () => {
    const payload = this.getSendPayload();

    if (!payload || isEmpty(payload)) return false;

    this.finallySendQuery(payload);

    this.setState((prevState) => ({
      ...prevState,
      inputValue: '',
      fileList: [],
    }));

    return true;
  };

  checkCanSend() {
    const superCanSend = super.checkCanSend();

    return this.state.SQMode === 'instant_search' && superCanSend;
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
)(QueryInputChat);
