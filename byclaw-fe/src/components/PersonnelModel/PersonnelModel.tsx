import { useCallback, useEffect, useState } from 'react';

import { CloseCircleFilled } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Checkbox, Divider, Empty, message, Modal, Spin } from 'antd';
import classnames from 'classnames';
import { isEmpty, size, isNumber } from 'lodash';

import InfiniteScroll from '../InfiniteScroll';
import CheckboxRender from './CheckboxRender';
import { dataItemTypeMap, leftTypeMap, listTypeMap, searchTypeMap } from './const';
import RightItemRender from './RightItemRender';

import styles from './index.module.less';

const PersonnelModel = (props: any) => {
  const {
    onOk,
    onCancel,
    title,
    dataList,
    itemKey = 'id',
    value, // 默认选中的option
    listType = listTypeMap.org,
    leftType = leftTypeMap.list,
    leftTopRender, // 左侧顶部渲染
    rightBottomRender, // 右侧底部渲染
    isLoading = false,
    confirmLoading = false,
    handleGetList,
    onDrillOrg,
    searchKey = '', // 搜索关键字
    searchType = searchTypeMap.all, // 搜索类型
    handleSearch,
    hasMore = false,
    searchAllEachSize = 3,
    // 禁用成员ids
    disabledIds = [],
    maxSelectCount = Infinity,
    ...restprops
  } = props;

  const intl = useIntl();
  const [selectList, setSelectList] = useState([]);

  useEffect(() => {
    if (value) {
      setSelectList(value);
    }
  }, [value]);

  const onChange = useCallback(
    (vals) => {
      // 过滤掉禁用的选项
      // eslint-disable-next-line no-param-reassign
      vals = vals.filter((item) => !disabledIds.includes(item));

      const oldSelectList = selectList.filter((item) => !dataList.find((i) => i[itemKey] === item[itemKey]));
      const result = vals.map((item) => ({
        [itemKey]: item,
        ...(dataList.find((user) => user[itemKey] === item) || {}),
      }));

      setSelectList([...oldSelectList, ...result]);
    },
    [selectList, dataList, itemKey, disabledIds]
  );

  const renderList = useCallback(() => {
    const isOrg = listType === listTypeMap.org;
    const isPost = listType === listTypeMap.post;
    const isStation = listType === listTypeMap.station;
    const isAgent = listType === listTypeMap.agent;

    let normalList = [];
    let scrollList = [];
    if (isOrg) {
      normalList = dataList?.filter((item) => item.type === dataItemTypeMap.org);
      scrollList = dataList?.filter((item) => item.type === dataItemTypeMap.user);
    } else if (isPost || isAgent) {
      scrollList = dataList;
    } else if (isStation) {
      normalList = dataList;
    }

    return (
      <Checkbox.Group
        id="scrollListWrap"
        onChange={onChange}
        value={[...disabledIds, ...selectList?.map((item) => item[itemKey])]}
        className={styles.scrollListWrap}
      >
        {!isEmpty(normalList) &&
          normalList.map((item) => (
            <CheckboxRender
              key={item[itemKey]}
              item={item}
              itemKey={itemKey}
              onDrillOrg={onDrillOrg}
              disabled={disabledIds.includes(item[itemKey])}
            />
          ))}
        {!isEmpty(scrollList) && (
          <InfiniteScroll
            next={() => {
              handleGetList();
            }}
            hasMore={hasMore}
            loader={
              <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
                <Spin />
              </div>
            }
            dataLength={scrollList.length}
            scrollableTarget="scrollListWrap"
            inverse={false}
            scrollThreshold="50px"
            hasChildren={!isEmpty(scrollList)}
            style={{ overflow: 'visible' }}
          >
            {scrollList.map((item) => (
              <CheckboxRender
                key={item[itemKey]}
                item={item}
                itemKey={itemKey}
                disabled={disabledIds.includes(item[itemKey])}
              />
            ))}
          </InfiniteScroll>
        )}
      </Checkbox.Group>
    );
  }, [listType, selectList, itemKey, dataList, onDrillOrg, onChange, hasMore, handleGetList, disabledIds]);

  const renderSearchList = useCallback(() => {
    if (searchKey === '' || (dataList && !dataList.length)) {
      return (
        <div className="full-width full-height ub ub-ver ub-ac ub-pc">
          {/* <img
            alt="logo"
            src={`${getPublicPath()}image/searchTip.png`}
            style={{ width: 160, height: 160 }}
          /> */}
          <Empty description="" />
          <span className={styles.searchTip}>{intl.formatMessage({ id: 'personnelModel.searchKeywordTip' })}</span>
        </div>
      );
    }
    if (!dataList) {
      return (
        <div className="full-width full-height ub ub-ver ub-ac ub-pc">
          {/* <img
            alt="logo"
            src={`${getPublicPath()}image/emptyBg.png`}
            style={{ width: 160, height: 160 }}
          /> */}
          <Empty description="" />
          <span className={styles.searchTip}>{intl.formatMessage({ id: 'personnelModel.noSearchResult' })}</span>
        </div>
      );
    }

    // 综合搜索列表
    if (searchType === searchTypeMap.all) {
      const {
        [dataItemTypeMap.org]: orgList,
        [dataItemTypeMap.user]: userList,
        [dataItemTypeMap.post]: postList,
        [dataItemTypeMap.station]: stationList,
        [dataItemTypeMap.agent]: agentList,
      } = dataList?.reduce((acc, item) => {
        const { type } = item || {};
        if (dataItemTypeMap[type?.toLowerCase()]) {
          acc[type] = acc[type] || [];
          acc[type].push(item);
        }
        return acc;
      }, {});

      const GroupItem = ({ groupTitle, checkboxList, type }) => {
        if (isEmpty(checkboxList)) return null;

        return (
          <>
            <span className={styles.groupTitle}>{groupTitle}</span>
            {checkboxList?.slice(0, searchAllEachSize)?.map((item) => (
              <CheckboxRender
                key={item[itemKey]}
                item={item}
                itemKey={itemKey}
                isSearch
                disabled={disabledIds.includes(item[itemKey])}
              />
            ))}
            {checkboxList.length > searchAllEachSize && (
              <Button type="link" size="small" onClick={() => handleSearch(type)}>
                {intl.formatMessage({ id: 'personnelModel.viewMore' })}
              </Button>
            )}
            <Divider />
          </>
        );
      };

      return (
        <Checkbox.Group onChange={onChange} value={[...disabledIds, ...selectList?.map((item) => item[itemKey])]}>
          <GroupItem
            groupTitle={intl.formatMessage({ id: 'orgMgr.personalSelect.org' })}
            checkboxList={orgList}
            type={searchTypeMap.org}
          />
          <GroupItem
            groupTitle={intl.formatMessage({
              id: 'orgMgr.personalSelect.user',
            })}
            checkboxList={userList}
            type={searchTypeMap.user}
          />
          <GroupItem
            groupTitle={intl.formatMessage({ id: 'orgMgr.modal.position' })}
            checkboxList={postList}
            type={searchTypeMap.post}
          />
          <GroupItem
            groupTitle={intl.formatMessage({
              id: 'orgMgr.personalSelect.station',
            })}
            checkboxList={stationList}
            type={searchTypeMap.station}
          />
          <GroupItem
            groupTitle={intl.formatMessage({
              id: 'orgMgr.personalSelect.agent',
            })}
            checkboxList={agentList}
            type={searchTypeMap.agent}
          />
        </Checkbox.Group>
      );
    }

    return (
      <InfiniteScroll
        next={() => {
          handleSearch(searchType, true);
        }}
        hasMore={hasMore}
        loader={
          <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
            <Spin />
          </div>
        }
        dataLength={dataList.length}
        scrollableTarget="scrollSearchListWrap"
        inverse={false}
        scrollThreshold="50px"
        hasChildren={!isEmpty(dataList)}
        style={{ overflow: 'visible' }}
      >
        <Checkbox.Group onChange={onChange} value={[...disabledIds, ...selectList?.map((item) => item[itemKey])]}>
          {dataList.map((item) => (
            <CheckboxRender
              key={item[itemKey]}
              item={item}
              itemKey={itemKey}
              isSearch
              disabled={disabledIds.includes(item[itemKey])}
            />
          ))}
        </Checkbox.Group>
      </InfiniteScroll>
    );
  }, [
    searchKey,
    dataList,
    searchType,
    itemKey,
    selectList,
    hasMore,
    searchAllEachSize,
    onChange,
    handleSearch,
    intl,
    disabledIds,
  ]);

  return (
    <Modal
      style={{ borderRadius: '10px' }}
      header={null} // 去除头部
      onCancel={onCancel}
      width={680}
      closable={false}
      styles={{
        content: { padding: '0px' },
      }}
      footer={null}
      {...restprops}
    >
      <div className={styles.content}>
        <div className={styles.left}>
          <div className={styles.header}>{title}</div>
          {leftTopRender?.()}
          <div
            id="scrollSearchListWrap"
            className={classnames(styles.list, {
              [styles.isSearch]: leftType === leftTypeMap.searchList,
            })}
          >
            {isLoading && (
              <div className="ub ub-ac ub-pc full-width full-height">
                <Spin />
              </div>
            )}
            {!isLoading && leftType === leftTypeMap.list && renderList()}
            {!isLoading && leftType === leftTypeMap.searchList && renderSearchList()}
          </div>
        </div>
        <div className={styles.right}>
          {!!maxSelectCount && (
            <div className={styles.header}>
              {intl.formatMessage(
                { id: 'personnelModel.selectedCountWithMax' },
                { count: selectList.length, max: maxSelectCount }
              )}
            </div>
          )}
          <div className={styles.selectedList}>
            {selectList.map((item) => {
              return (
                <div className={styles.listItem} key={item[itemKey]}>
                  <RightItemRender item={item} />
                  {!item.cannotDel && (
                    <div
                      className={styles.close}
                      onClick={() => {
                        setSelectList((pre) => pre.filter((i) => i[itemKey] !== item[itemKey]));
                      }}
                    >
                      <CloseCircleFilled />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {rightBottomRender?.()}
          <div className={styles.btn}>
            <Button onClick={onCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            <Button
              onClick={() => {
                if (isNumber(maxSelectCount) && maxSelectCount !== Infinity && size(selectList) > maxSelectCount) {
                  message.error(intl.formatMessage({ id: 'personnelModel.maxSelectLimit' }, { max: maxSelectCount }));
                  return;
                }

                onOk(selectList);
              }}
              type="primary"
              loading={confirmLoading}
            >
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default PersonnelModel;
