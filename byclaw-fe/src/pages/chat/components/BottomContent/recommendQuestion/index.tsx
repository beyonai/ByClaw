import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Col, Empty, Row, Spin, Typography } from 'antd';
import { EnterOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import { getLocale } from '@umijs/max';
import { isEmpty } from 'lodash';
// @ts-ignore
import { getDcSystemConfigListByStandType } from '@/service/auth';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';
import InfiniteScroll from 'react-infinite-scroll-component';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';

import styles from './index.module.less';

export interface IRecommendQuestion {

  /** 卡片标题，缺省时取 question */
  title?: string;

  /** 唯一标识 */
  questionId: string;

  /** 推荐问题，长短不定，需做省略处理 */
  question: string;

  /** 可选的图标（emoji 或 iconfont 名） */
  icon?: string;

  /** 点击后回填输入框的内容，缺省时取 question */
  prompt?: string;
}

// 分页获取推荐问题列表，配合滚动加载使用
function getRecommendQuestionList(isEN: boolean = false) {
  return getDcSystemConfigListByStandType(
    {
      standType: 'RECOMMENDED_QUESTIONS',
    },
    {
      responseCfg: { hideErrorTips: true },
    }
  ).then(
    (
      list: {
        paramId: number;
        paramGroupCode: string;
        paramGroupName: string;
        paramName: string;
        paramEnName: string;
        paramValue: string;
        paramDesc: string;
        paramSeq: number;
      }[]
    ) => {
      return {
        list: list.map((item) => ({
          questionId: item.paramId.toString(),
          title: isEN ? item.paramEnName : item.paramName,
          question: isEN ? item.paramDesc : item.paramValue,
        })),
        total: list.length,
      };
    }
  );
}

// 判断 icon 是否为 iconfont 名（约定以 icon- 开头），否则按 emoji/纯文本渲染
function isIconFont(icon?: string): boolean {
  return !!icon && icon.startsWith('icon-');
}

export default function RecommendQuestion({ relatedQuestions }: { relatedQuestions?: string[] }) {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector(({ user }: { user: any }) => user.userInfo);

  const [questionList, setQuestionList] = useState<IRecommendQuestion[]>([]);
  const [relatedQuestionsList, setRelatedQuestionsList] = useState<IRecommendQuestion[]>([]);
  const [pageNum, setPageNum] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inited, setInited] = useState(false);

  // 防止并发请求同一页
  const loadingRef = useRef(false);
  // 滚动容器需要稳定的 id 供 InfiniteScroll 绑定
  const scrollableId = 'recommendQuestionScrollable';
  // 滚动容器 DOM 引用，用于监听滚动控制顶部渐变遮罩
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  // 是否已向下滚动：滚动后顶部内容渐变淡出，滚到顶部时不遮挡首行
  const [scrolled, setScrolled] = useState(false);

  const hasRelatedQuestions = !isEmpty(relatedQuestionsList);
  const hasMore = hasRelatedQuestions ? false : questionList.length < total || !inited;

  const local = getLocale();

  const isEN = React.useMemo(() => {
    return local.includes('en');
  }, [local]);
  const list = React.useMemo(() => {
    if (!isEmpty(relatedQuestionsList)) {
      return relatedQuestionsList;
    }
    return questionList;
  }, [questionList, relatedQuestionsList]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    const next = pageNum + 1;
    try {
      const res = await getRecommendQuestionList(isEN);

      const newList = res?.list || [];
      setQuestionList((prev) => (next === 1 ? newList : [...prev, ...newList]));
      setTotal(res?.total || 0);
      setPageNum(next);
    } catch (error) {
      console.error('获取推荐问题失败:', error);
      // 首屏请求异常时使用兜底的 30 条推荐问题；翻页失败则保持已有列表
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setInited(true);
    }
  }, [pageNum, isEN]);

  // 登录态变化时重置并重新拉取
  useEffect(() => {
    setQuestionList([]);
    setPageNum(0);
    setTotal(0);
    setInited(false);
    loadingRef.current = false;
    if (userInfo) {
      loadMore();
    } else {
      setInited(true);
    }
    // loadMore 依赖 pageNum，这里只在登录态变化时触发首屏
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInfo]);

  useEffect(() => {
    if (isEmpty(relatedQuestions)) {
      setRelatedQuestionsList([]);
      return;
    }

    setRelatedQuestionsList(
      (relatedQuestions || []).map((item, idx) => ({
        questionId: idx.toString(),
        question: item,
      }))
    );
  }, [relatedQuestions]);

  // 监听滚动容器，向下滚动一定距离后启用顶部渐变遮罩
  useEffect(() => {
    const el = scrollWrapRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      setScrolled(el.scrollTop > 4);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // list 变化时容器可能重建/内容变更，重新绑定并刷新一次状态
  }, [list.length, inited]);

  const onClickQuestion = useCallback(
    (item: IRecommendQuestion) => {
      EventEmitter.emit('queryInput-set-schema-imme', {
        queryQuestion: item.question,
        inputSchema: {
          text: item.question,
        },
      });
    },
    [EventEmitter]
  );

  // 首屏加载中：用 Spin 占位
  if (!inited && loading) {
    return (
      <div className={styles.recommendQuestion}>
        <div className={styles.loadingRow}>
          <Spin size="small" />
        </div>
      </div>
    );
  }

  // 空态
  if (inited && list.length === 0) {
    return (
      <div className={styles.recommendQuestion}>
        <div className={styles.emptyWrap}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.recommendQuestion}>
      <div
        id={scrollableId}
        ref={scrollWrapRef}
        className={classNames(styles.scrollWrap, { [styles.scrolled]: scrolled })}
      >
        <InfiniteScroll
          style={{ overflow: 'hidden auto' }}
          dataLength={list.length}
          next={loadMore}
          hasMore={hasMore}
          scrollableTarget={scrollableId}
          loader={
            <div className={classNames(styles.loadingRow, styles.fullRow)}>
              <Spin size="small" />
            </div>
          }
          endMessage={
            list.length > 0 ? (
              <div className={classNames(styles.endRow, styles.fullRow)}>
                {intl.formatMessage({ id: 'chat.recommendQuestion.noMore' })}
              </div>
            ) : null
          }
        >
          {/* 用 antd Row/Col 做三列栅格，gutter 控制行列间距，避免宽度溢出 */}
          <Row gutter={[14, 14]} className={styles.grid}>
            {list.map((item) => (
              <Col span={8} key={item.questionId}>
                <div className={styles.questionItem} onClick={() => onClickQuestion(item)}>
                  {item.icon && (
                    <span className={styles.iconBox}>
                      {isIconFont(item.icon) ? <AntdIcon type={item.icon} /> : item.icon}
                    </span>
                  )}
                  <div className={styles.content}>
                    {/* 标题行：标题 + 同行的回填小图标按钮 */}
                    <div className={styles.titleRow}>
                      {/* 标题：title 缺省时回退到 question，单行省略 */}
                      <span className={styles.title}>{item.title || item.question}</span>
                      <Button
                        type="text"
                        size="small"
                        className={styles.action}
                        icon={<EnterOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClickQuestion(item);
                        }}
                      />
                    </div>
                    {/* 描述：question 长短不一，用 Typography 限制两行省略，省略时 hover 出完整内容 */}
                    <Typography.Paragraph
                      className={styles.question}
                      ellipsis={{ rows: 2, tooltip: { title: item.question, placement: 'topLeft' } }}
                      style={{ minHeight: 36 }}
                    >
                      {item.question}
                    </Typography.Paragraph>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </InfiniteScroll>
      </div>
    </div>
  );
}
