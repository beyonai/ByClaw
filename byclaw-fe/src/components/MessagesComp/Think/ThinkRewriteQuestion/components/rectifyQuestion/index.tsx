// tslint:disable:ordered-imports
import React, { forwardRef, useRef, useCallback, useState, useEffect, useMemo, useImperativeHandle } from 'react';
import classNames from 'classnames';
import { get, isEmpty, concat, set, reduce, replace, values, flatten, compact, isString } from 'lodash';
import { Tag, Spin } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import MyIcon from '@/components/AntdIcon';
import { useIntl } from '@umijs/max';

import { POST } from '@/service/common/request';
import { IRecallInfo, IDataDimInfo } from './index.d';
import MyDatepicker from './components/MyDatepicker';
import RecallItem from './components/RecallItem';

import styles from './index.less';
import inputStyles from './inputStyles.less';

type IProps = {
  onshow: boolean;
  setOnshow: (show: boolean) => void;
  knowledgeBaseId: string;
  query: string;
  onSend: (text: string, extParams?: { rewriteConfirm?: boolean; inputValue?: string }) => void;
  useAtomRewrite: boolean;
};

function RectifyQuestion(props: IProps, ref: any) {
  const intl = useIntl();

  const { onshow, setOnshow, knowledgeBaseId, query, onSend, useAtomRewrite } = props;

  const abortController = useRef<AbortController>(undefined);

  const [loading, setLoading] = useState<boolean>(false);
  const [questionRewriteRecord, setQuestionRewriteRecord] = useState({});
  const rewriteConfirmRef = useRef<any>(null);

  const autoChooseTop1 = useCallback((myQuestionRewriteRecord: any) => {
    // 默认选择召回的top1
    compact(flatten(values(get(myQuestionRewriteRecord, 'recallInfo')))).forEach((item) => {
      const { name, list = [], complete } = item || {};

      if (complete) return;

      set(item, 'selectedName', get(list, '0.mergeName', name));
    });

    return myQuestionRewriteRecord;
  }, []);

  const setAtomRewriteResult = useCallback(
    (data: any) => {
      // 处理原子改写返回的数据
      if (useAtomRewrite) {
        // 如果 result 数组中的所有 list 都为空数组，则 hasNotComplete 为 false
        const hasNotComplete = !isEmpty(data?.result) && data?.result.some((item: any) => item.type === 'other');
        if (data?.result && hasNotComplete) {
          const transformData = {
            recallInfo: {
              result: data.result.map((ele: IRecallInfo & { rewriteWord?: string }) => ({
                ...ele,
                // 默认选中原文
                selectedName: ele.rewriteWord || ele.name,
                list: ele.type !== 'other' ? [] : ele.list.map((item) => {
                  if (isString(item)) {
                    return { mergeName: item, name: item };
                  }
                  return item;
                }),
              })),
            },
          };
          setQuestionRewriteRecord(transformData);
        } else if (rewriteConfirmRef.current) {
          setOnshow(false);
        } else {
          onSend(query);
          setOnshow(false);
        }
      }
    },
    [useAtomRewrite]
  );

  useImperativeHandle(ref, () => ({
    initAtomRewriteResult: (data: any) => {
      rewriteConfirmRef.current = true;
      setAtomRewriteResult(data);
    },
  }));

  const questionRewrite = useCallback(
    (query: string) => {
      if (!query) return;

      setQuestionRewriteRecord({});
      setLoading(true);

      if (abortController.current) {
        abortController.current.abort();
      }

      abortController.current = new AbortController();

      POST(
        `knowledgeService/callDomainService/${useAtomRewrite ? 'questionRewriteByAtomic' : 'questionRewrite'}`,
        {
          knowledgeBaseId,
          query,
        },
        {
          cancelToken: abortController.current,
        }
      )
        .then((data: any) => {
          // 处理原子改写返回的数据
          if (useAtomRewrite) {
            setAtomRewriteResult(data);
            return;
          }
          // 处理非原子改写逻辑
          const hasNotComplete = compact(flatten(values(data?.recallInfo))).find((item) => {
            return item?.complete === false;
          });

          if (hasNotComplete) {
            setQuestionRewriteRecord(autoChooseTop1(data));
          } else {
            onSend(query);
            setOnshow(false);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [knowledgeBaseId, useAtomRewrite]
  );

  // 选中相似词
  const handleChoose = useCallback((title: string, keyName: string, idx: number) => {
    setQuestionRewriteRecord((prevList) => {
      set(prevList, `${keyName}.${idx}.selectedName`, title);
      return { ...prevList };
    });
  }, []);

  // 删除相似词
  const handleDelete = useCallback((keyName: string, idx: number) => {
    setQuestionRewriteRecord((prevList) => {
      const newResult = [...get(prevList, keyName, [])];
      newResult.splice(idx, 1);
      set(prevList, keyName, newResult);
      return { ...prevList };
    });
  }, []);

  const renderRecallInfo = useCallback(
    (keyName: string) => {
      const conditionList: any[] = [];
      (get(questionRewriteRecord, keyName) || []).forEach((item: IRecallInfo, idx: number) => {
        conditionList.push(
          <RecallItem
            item={item}
            handleChoose={(title: string) => handleChoose(title, keyName, idx)}
            knowledgeBaseId={knowledgeBaseId}
          />
        );
      });
      return conditionList;
    },
    [questionRewriteRecord]
  );

  const renderDateDimInfo = useCallback(() => {
    const conditionList: any[] = [];
    (get(questionRewriteRecord, 'dateDimInfoList') || []).forEach((item: IDataDimInfo, idx: number) => {
      const { value, name, formatType, selectedDate, conditionType } = item;

      let dataObj = [];
      try {
        dataObj = JSON.parse(value);
      } catch (e) {
        console.warn(e);
      }

      dataObj = concat([], dataObj);

      const conditionItem = (
        <span key={name} className={styles.conditionItemComplete}>
          <span key={name}>
            <span className={styles.tagTitle}>{`${name}`}</span>
            <i
              className="iconfont icon-a-Arrow-rightjiantouyou2x pointer"
              style={{ margin: '0 6px', fontSize: '12px' }}
            />
            <span className={styles.tagItem} key={name}>
              <Tag color="#5AC159" key={name} className="ub-ac" style={{ display: 'inline-flex' }}>
                <MyDatepicker
                  dataObj={selectedDate || dataObj}
                  formatType={formatType}
                  conditionType={conditionType}
                  onChangeDate={(selectedDate: string[]) => {
                    setQuestionRewriteRecord((prevList) => {
                      set(prevList, `dateDimInfoList.${idx}.selectedDate`, selectedDate);

                      return { ...prevList };
                    });
                  }}
                />
              </Tag>
              <CheckOutlined />
            </span>
          </span>
        </span>
      );

      conditionList.push(conditionItem);
    });

    return conditionList;
  }, [questionRewriteRecord]);

  const cancel = () => {
    if (abortController.current) {
      abortController.current.abort();
      abortController.current = undefined;
    }

    setLoading(false);
    setOnshow(false);
  };

  const checkErrorAtom = useCallback((item: IRecallInfo) => {
    return !!(item.type === 'other' && item.selectedName === item.name);
  }, []);

  // 渲染原子术语改写
  const renderAtomResult = useCallback(() => {
    const keyName = 'recallInfo.result';
    const result = get(questionRewriteRecord, keyName, []);
    return result.map((item: any, index: number) => {
      const { name, type } = item;
      if (type === 'other') {
        return (
          <span key={index} className={`mr-8 ml-8 ${styles.splitItem}`}>
            <RecallItem
              item={item}
              showLabel={false}
              className={!checkErrorAtom(item) ? styles.metaItem : styles.errorItem}
              handleChoose={(title: string) => handleChoose(title, keyName, index)}
              handleDelete={() => handleDelete(keyName, index)}
              showMore
              knowledgeBaseId={knowledgeBaseId}
            />
          </span>
        );
      }
      if (type === 'atom') {
        return (
          <span key={index} className={`mr-8 ml-8 ${styles.splitItem} ${styles.atomItem}`}>
            {name}
          </span>
        );
      }
      return <span key={index}>{name}</span>;
    });
  }, [questionRewriteRecord]);

  const afterRectifQuery = useMemo(() => {
    let q = query;
    let disabled = false;
    // useAtomRewrite为true
    if (useAtomRewrite) {
      const result = get(questionRewriteRecord, 'recallInfo.result', []);
      // 如果other存在list为空，或下拉没改变，就限制发送
      disabled = !!result.find(checkErrorAtom);
      q = result.map((item: any) => item.selectedName || item.name).join('');
    } else {
      reduce(
        get(questionRewriteRecord, 'dateDimInfoList'),
        (res: any, item: any) => {
          const { selectedDate, name } = item;
          if (!selectedDate) return res;

          const newRes = replace(res, name, selectedDate.join(intl.formatMessage({ id: 'common.to' })));
          return newRes;
        },
        query
      );
      q = reduce(
        get(questionRewriteRecord, 'recallInfo'),
        (res, item?: Array<{ selectedName?: string; name: string }>) => {
          let newRes = res;
          (item || []).forEach((i: any) => {
            const { selectedName, name } = i;
            if (!selectedName) return;

            newRes = replace(res, name, selectedName);
          });
          return newRes;
        },
        q
      );
    }

    const prefixText = useAtomRewrite
      ? intl.formatMessage({ id: 'chatBI.termAdjustment' })
      : intl.formatMessage({ id: loading ? 'common.optimizing' : 'common.optimized' });

    return (
      <div className={`${styles.afterRectif} ${inputStyles.wrap} ub ub-ac`}>
        <div className={inputStyles.prefix}>
          <span className={`${styles.prefixTxt} ub ub-ac`}>
            <MyIcon
              type="icon-zhiling"
              style={{ fontSize: '24px' }}
              className={classNames({ [styles.Yrotate]: loading })}
            />
            {prefixText}
          </span>
        </div>
        <div className={inputStyles.inputW}>
          <div className={inputStyles.input}>{useAtomRewrite ? renderAtomResult() : q}</div>
        </div>
        {!useAtomRewrite && (
          <span
            className={`${styles.sendOriginTxt} pointer`}
            onClick={() => {
              cancel();
              onSend(query);
            }}
          >
            {intl.formatMessage({ id: 'chatBI.sendOriginal' })}
          </span>
        )}
        <button
          type="button"
          disabled={disabled}
          className={inputStyles.suffix}
          onClick={() => {
            if (disabled) return;
            cancel();
            onSend(q, rewriteConfirmRef.current && { rewriteConfirm: rewriteConfirmRef.current, inputValue: q });
            rewriteConfirmRef.current = false;
          }}
        >
          <i className="iconfont icon-a-sendout-fill" />
        </button>
      </div>
    );
  }, [query, questionRewriteRecord, loading, renderRecallInfo, useAtomRewrite, renderAtomResult, intl]);

  const renderQuestionRewrite = useMemo(() => {
    if (loading) {
      return (
        <div className="ub-f1 ub ub-ac ub-pc ub-ver">
          <Spin
            spinning
            indicator={<MyIcon type="icon-zhiling" style={{ fontSize: '32px' }} className={styles.Yrotate} />}
          />
          <p style={{ margin: '0px 0 8px' }}>{intl.formatMessage({ id: 'chatBI.rewriting' })}</p>
        </div>
      );
    }
    return (
      <>
        <div style={{ padding: '0 16px' }}>
          <div className="ub" style={{ minHeight: '34px' }}>
            <span style={{ color: '#475366', margin: '4px 8px 0 0' }}>
              {intl.formatMessage({ id: 'common.dimension' })}：
            </span>
            <div className="ub-f1">
              {renderRecallInfo('recallInfo.dim')}
              {renderRecallInfo('recallInfo.org')}
              {renderRecallInfo('recallInfo.meta')}
            </div>
          </div>
          <div className="ub" style={{ minHeight: '34px' }}>
            <span style={{ color: '#475366', margin: '4px 8px 0 0' }}>
              {intl.formatMessage({ id: 'common.indicator' })}：
            </span>
            <div className="ub-f1">{renderRecallInfo('recallInfo.indicator')}</div>
          </div>
          <div className="ub" style={{ minHeight: '34px' }}>
            <span style={{ color: '#475366', margin: '4px 8px 0 0' }}>
              {intl.formatMessage({ id: 'common.time' })}：
            </span>
            <div className="ub-f1">{renderDateDimInfo()}</div>
          </div>
        </div>
      </>
    );
  }, [renderRecallInfo, loading, intl]);

  useEffect(() => {
    if (!onshow) return;

    questionRewrite(query);
  }, [query, onshow]);

  const tips = useMemo(
    () =>
      useAtomRewrite
        ? intl.formatMessage({ id: 'chatBI.termSelectionTip' })
        : intl.formatMessage({ id: 'chatBI.confirmQuestionTip' }),
    [useAtomRewrite, intl]
  );

  return (
    <>
      <div className={`${styles.tipsBlock} ${styles.smoothHeight} ${onshow ? styles.smoothHeightOpen : ''}`}>
        <div className={`${styles.tipsBlockTitle}`}>
          <p className="ub ub-ac ub-pj">
            <span>{!loading && tips}</span>
            <i className="iconfont icon-a-Close-smallguanbi-xiao pointer" onClick={cancel} />
          </p>
        </div>
        <div className={`${styles.tipsBlockContent} hideThumb ub ub-ver`}>
          {!useAtomRewrite && renderQuestionRewrite}
          {afterRectifQuery}
        </div>
      </div>
      <div
        className={`${styles.rectifyQuestionTips} ub ub-ac ub-pc ${styles.smoothOpacity} ${
          onshow ? styles.smoothOpacityVisible : ''
        }`}
      />
    </>
  );
}

export default forwardRef(RectifyQuestion);
