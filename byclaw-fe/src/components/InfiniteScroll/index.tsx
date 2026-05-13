import { throttle } from 'lodash';
// tslint:disable:ordered-imports
import React, { CSSProperties, Component, ReactNode, createRef } from 'react';
import { ThresholdUnits, parseThreshold } from './utils/threshold';

type Fn = () => any;
export interface Props {
  next: (isPrev?: boolean) => any;
  hasMore: boolean;
  children: ReactNode;
  loader: ReactNode;
  scrollThreshold?: number | string;
  endMessage?: ReactNode;
  style?: CSSProperties;
  height?: number | string;
  scrollableTarget?: ReactNode;
  hasChildren?: boolean;
  inverse?: boolean;
  pullDownToRefresh?: boolean;
  // eslint-disable-next-line react/no-unused-prop-types
  pullDownToRefreshContent?: ReactNode;
  // eslint-disable-next-line react/no-unused-prop-types
  releaseToRefreshContent?: ReactNode;
  // eslint-disable-next-line react/no-unused-prop-types
  pullDownToRefreshThreshold?: number;
  // eslint-disable-next-line react/no-unused-prop-types
  refreshFunction?: Fn;
  onScroll?: (e: MouseEvent) => any;
  dataLength: number;
  initialScrollY?: number;
  className?: string;
  bottomItemKey?: string;
  topItemKey?: string;

  // 当列表的长度增加后，是否自动滚动到底部。为了兼容旧版本，默认为 true
  appendItemsAutoScrollBottom?: boolean;
  lowestPageNum?: number;
  onRectSizeChange?: () => void;
}

interface State {
  showLoader: boolean;
  showOppositeDirLoader: boolean;
  pullToRefreshThresholdBreached: boolean;
  prevDataLength: number | undefined;
}

export default class InfiniteScroll extends Component<Props, State> {
  private throttledOnScrollListener: (e: MouseEvent) => void;

  private _scrollableNode: HTMLElement | undefined | null;

  private el: HTMLElement | undefined | (Window & typeof globalThis) | null;

  private _infScroll: HTMLDivElement | null = null;

  private lastScrollHeight = 0;

  private lastScrollTop = 0;

  private scrollDirection: 'down' | 'up' | '' = '';

  private actionTriggered = false;

  private loading = false;

  private loadedScrollTop = 0;

  private loaderRef = createRef<HTMLDivElement>();

  public isLastScrollAtBottom = true;

  private resizeObserver: ResizeObserver | null = null;

  constructor(props: Props) {
    super(props);

    this.state = {
      showLoader: false,
      showOppositeDirLoader: false,
      pullToRefreshThresholdBreached: false,
      prevDataLength: props.dataLength,
    };

    this.throttledOnScrollListener = throttle(this.onScrollListener, 150).bind(this);
  }

  componentDidMount() {
    if (typeof this.props.dataLength === 'undefined') {
      throw new Error(
        'mandatory prop "dataLength" is missing. The prop is needed' +
          ' when loading more content. Check README.md for usage'
      );
    }

    this._scrollableNode = this.getScrollableTarget();
    this.el = this.props.height ? this._infScroll : this._scrollableNode || window;

    if (this.el) {
      this.el.addEventListener('scroll', this.bindScroll as EventListenerOrEventListenerObject);
    }

    if (
      typeof this.props.initialScrollY === 'number' &&
      this.el &&
      this.el instanceof HTMLElement &&
      this.el.scrollHeight > this.props.initialScrollY
    ) {
      this.el.scrollTo(0, this.props.initialScrollY);
    }
    this.observeRect();
  }

  componentDidUpdate(prevProps: Props) {
    const { appendItemsAutoScrollBottom = true } = this.props;
    if (this.props.onRectSizeChange !== prevProps.onRectSizeChange) {
      this.observeRect();
    }
    // 数据有变化，顶部和底部数据变化才更新滚动条位置
    if (this.props.dataLength > prevProps.dataLength) {
      if (this.el instanceof HTMLElement) {
        // 底部新增
        if (this.props.bottomItemKey !== prevProps.bottomItemKey) {
          if (appendItemsAutoScrollBottom) {
            this.scrollToBottom();
          }
          // 顶部加载
        } else if (this.props.topItemKey !== prevProps.topItemKey && this.state.showLoader) {
          let loaderHeight = 0;
          if (!!this.props.loader && this.loaderRef.current) {
            loaderHeight = this.loaderRef.current.clientHeight;
          }
          const scrollTop = this.el.scrollHeight - this.lastScrollHeight - loaderHeight;
          this.el.scrollTop = scrollTop;
          this.loadedScrollTop = scrollTop;
        }

        // @MODIFY: 避免loading时的滚动缓冲
        setTimeout(() => {
          this.loading = false;
        }, 500);
      }
    } else if (
      this.props.dataLength &&
      this.props.dataLength === prevProps.dataLength &&
      this.props.bottomItemKey !== prevProps.bottomItemKey &&
      this.isLastScrollAtBottom
    ) {
      this.scrollToBottom();
      return;
    }
    // do nothing when dataLength is unchanged
    if (this.props.dataLength === prevProps.dataLength) return;
    this.actionTriggered = false;
    // update state when new data was sent in
    // eslint-disable-next-line react/no-did-update-set-state
    this.setState({
      showLoader: false,
      showOppositeDirLoader: false,
    });
  }

  componentWillUnmount() {
    if (this.el) {
      this.el.removeEventListener('scroll', this.bindScroll as EventListenerOrEventListenerObject);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    const dataLengthChanged = nextProps.dataLength !== prevState.prevDataLength;

    // reset when data changes
    if (dataLengthChanged) {
      return {
        ...prevState,
        prevDataLength: nextProps.dataLength,
      };
    }
    return null;
  }

  observeRect = () => {
    if (this._infScroll) {
      const onResize = () => {
        if (this._scrollableNode) {
          this.lastScrollTop = this._scrollableNode.scrollTop;
        }
        if (this.props.onRectSizeChange) {
          this.props.onRectSizeChange();
        }
      };
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(this._infScroll);
      this.resizeObserver = resizeObserver;
    }
  };

  bindScroll = (e: MouseEvent) => {
    const { scrollTop } = e.target as HTMLElement;
    this.scrollDirection = scrollTop - this.lastScrollTop > 0 ? 'down' : 'up';
    this.lastScrollTop = scrollTop;
    this.throttledOnScrollListener(e);
    if (e.isTrusted && this.el instanceof HTMLElement) {
      this.isLastScrollAtBottom = this.isElementAtBottom(this.el, this.props.scrollThreshold);
    }
  };

  scrollToBottom = (params?: { behavior?: ScrollBehavior }) => {
    if (this.el instanceof HTMLElement) {
      // this.el.scrollTop = this.el.scrollHeight;
      this.el.scrollTo({
        behavior: 'smooth',
        ...(params || {}),
        top: this.el.scrollHeight,
      });
      this.isLastScrollAtBottom = true;
    }
  };

  getScrollableTarget = () => {
    if (this.props.scrollableTarget instanceof HTMLElement) return this.props.scrollableTarget;
    if (typeof this.props.scrollableTarget === 'string') {
      return document.getElementById(this.props.scrollableTarget);
    }
    if (this.props.scrollableTarget === null) {
      console.warn(`You are trying to pass scrollableTarget but it is null. This might
        happen because the element may not have been added to DOM yet.
        See https://github.com/ankeetmaini/react-infinite-scroll-component/issues/59 for more info.
      `);
    }
    return null;
  };

  scrollByControl = (scrollDirection: 'down' | 'up') => {
    this.onScrollListener(
      {
        target: this.el!,
        isTrusted: true,
      } as unknown as MouseEvent,
      scrollDirection
    );
  };

  onScrollListener = (event: MouseEvent, direction?: 'down' | 'up') => {
    let target: HTMLElement;
    if (this.props.height || this._scrollableNode) {
      target = event.target as HTMLElement;
    } else {
      target = document.documentElement.scrollTop ? document.documentElement : document.body;
    }
    if (target.clientHeight === target.scrollHeight) {
      return;
    }

    if (!event.isTrusted || this.loading || this.state.showLoader) {
      // @MODIFY: 避免用户滚动到顶部时的滚动缓冲动作导致scrollTop改变
      if (this.loadedScrollTop && target.scrollTop < 0) {
        target.scrollTop = this.loadedScrollTop;
      }
      return;
    }
    if (typeof this.props.onScroll === 'function') {
      // Execute this callback in next tick so that it does not affect the
      // functionality of the library.
      setTimeout(() => this.props.onScroll && this.props.onScroll(event), 0);
    }

    // return immediately if the action has already been triggered,
    // prevents multiple triggers.
    if (this.actionTriggered || this.loading || this.state.showLoader) return;

    const elementAtTop = this.isElementAtTop(target, this.props.scrollThreshold);
    const elementAtBottom = this.isElementAtBottom(target, this.props.scrollThreshold);

    let scrollDirection = direction || this.scrollDirection;
    if (this.props.inverse) {
      scrollDirection = scrollDirection === 'down' ? 'up' : 'down';
    }

    const atBottom = this.props.inverse ? elementAtTop : elementAtBottom;
    const atTop = this.props.inverse ? elementAtBottom : elementAtTop;
    // call the `next` function in the props to trigger the next data fetch

    if (atBottom && this.props.hasMore && !this.loading && !this.state.showLoader && scrollDirection === 'down') {
      this.loading = true;
      this.lastScrollHeight = target.scrollHeight;
      this.actionTriggered = true;
      this.setState({ showLoader: true });
      if (this.props.next) {
        this.props.next();
      }
    } else if (atTop && !this.loading && !this.state.showLoader) {
      if (typeof this.props.lowestPageNum === 'number' && this.props.lowestPageNum > 1 && scrollDirection === 'up') {
        this.setState({ showOppositeDirLoader: true });
        this.props?.next(true);
      }
    }
  };

  isElementAtTop(target: HTMLElement, scrollThreshold: string | number = 0.8) {
    const clientHeight =
      target === document.body || target === document.documentElement ? window.screen.availHeight : target.clientHeight;

    const threshold = parseThreshold(scrollThreshold);

    if (threshold.unit === ThresholdUnits.Pixel) {
      return target.scrollTop <= threshold.value;
    }

    return target.scrollTop <= (threshold.value / 100) * clientHeight;
  }

  isElementAtBottom(target: HTMLElement, scrollThreshold: string | number = 0.8) {
    const clientHeight =
      target === document.body || target === document.documentElement ? window.screen.availHeight : target.clientHeight;

    const threshold = parseThreshold(scrollThreshold);

    if (threshold.unit === ThresholdUnits.Pixel) {
      return target.scrollTop + clientHeight >= target.scrollHeight - threshold.value;
    }

    return target.scrollTop + clientHeight >= (threshold.value / 100) * target.scrollHeight;
  }

  render() {
    const style = {
      height: this.props.height || 'auto',
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
      ...this.props.style,
    } as CSSProperties;

    let { hasChildren } = this.props;
    if (hasChildren === undefined) {
      hasChildren = !!this.props.children && this.props.children instanceof Array && this.props.children.length > 0;
    }

    // because heighted infiniteScroll visualy breaks
    // on drag down as overflow becomes visible
    const outerDivStyle = this.props.pullDownToRefresh && this.props.height ? { overflow: 'auto' } : {};

    const showUpperLoader = this.props.inverse && this.state.showLoader && this.props.hasMore;

    const showDownLoader =
      (!this.props.inverse && this.props.hasMore && this.state.showLoader) ||
      (!!this.props.inverse && this.state.showOppositeDirLoader);

    return (
      <div style={outerDivStyle} className="infinite-scroll-component__outerdiv">
        <div
          className={`infinite-scroll-component ${this.props.className || ''}`}
          ref={(infScroll: HTMLDivElement | null) => {
            this._infScroll = infScroll;
          }}
          style={style}
        >
          {!!showUpperLoader && (
            <div key="upperLoader" ref={this.loaderRef}>
              {this.props.loader}
            </div>
          )}
          {this.props.children}
          {!!showDownLoader && <div key="downLoader">{this.props.loader}</div>}
          {!this.props.hasMore && this.props.endMessage}
        </div>
      </div>
    );
  }
}
