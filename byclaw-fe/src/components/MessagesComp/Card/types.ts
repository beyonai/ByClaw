/* eslint-disable lines-around-comment */

/**
 * 卡片标题配置
 */
export type ICardTitle =
  | string
  | {
      /**
       * 主标题文本
       */
      mainTitle:
        | string
        | {
            text: string;
            style?: React.CSSProperties;
          };

      /**
       * 副标题文本
       */
      subTitle?:
        | string
        | {
            text: string;
            style?: React.CSSProperties;
          };

      /**
       * 自定义样式
       */
      style?: React.CSSProperties;
    };

/**
 * 内容块类型枚举
 */
export enum CardContentType {
  /** 纯文本 */
  TEXT = 'text',
  /** Markdown格式文本 */
  MARKDOWN = 'markdown',
  /** HTML富文本 */
  HTML = 'html',
  /** 图片 */
  IMAGE = 'image',
  /** 展示一个数字员工详情（头像+名称+描述） */
  AGENT_INFO = 'agentInfo',
}

/**
 * 文本内容块
 */
export interface ITextContent {
  /** 文本类型，默认是此类型 */
  type: CardContentType.TEXT;
  /** 文本内容 */
  text: string;
  /** 文本行数 */
  rows?: number;
  /** 文本样式 */
  style?: React.CSSProperties;
}

/**
 * Markdown内容块
 */
export interface IMarkdownContent {
  type: CardContentType.MARKDOWN;
  /** Markdown文本内容 */
  text: string;
}

/**
 * HTML内容块
 */
export interface IHtmlContent {
  type: CardContentType.HTML;
  /** HTML字符串 */
  text: string;
}

/**
 * 图片内容块
 */
export interface IImageContent {
  type: CardContentType.IMAGE;
  /** 图片URL */
  src: string;
  /** 图片alt文本 */
  alt?: string;
  /** 图片标题 */
  title?: string;
  /** 图片宽度 */
  width?: number | string;
  /** 图片高度 */
  height?: number | string;
  /** 点击图片时的操作（可选） */
  action?: ICardAction;
}

/**
 * 展示一个数字员工详情（头像+名称+描述）
 */
export interface IAgentInfoContent {
  type: CardContentType.AGENT_INFO;
  agentId: string;
}

/**
 * 内容块联合类型
 */
export type ICardContentBlock = ITextContent | IMarkdownContent | IHtmlContent | IImageContent | IAgentInfoContent;

/**
 * 卡片内容配置
 */
export interface ICardContent {
  /** 内容块列表 */
  blocks: ICardContentBlock[];
  /** 内容区域自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 操作类型枚举
 */
export enum CardActionType {
  /** 发起聊天/发送消息 */
  CHAT = 'chat',
  /** 打开iframe */
  IFRAME = 'iframe',
  /** 调用API请求 */
  FETCH = 'fetch',
  /** 打开链接 */
  LINK = 'link',
  /** 打开链接 */
  POPUP = 'popup',
  /** 自定义组件 */
  CUSTOM = 'custom',
}

/**
 * 聊天操作配置
 */
export interface IChatAction {
  type: CardActionType.CHAT;
  /** 目标数字员工ID */
  agentId?: string;
  /** 要发送的消息内容 */
  message?: string;
  /** 是否在新会话中发送（true：新会话，false：当前会话），默认true */
  isNewSession?: boolean;
  /** 是否携带会话历史记录 */
  withSessionHistory?: boolean;
  /** 数字员工的扩展参数，按需传入 */
  extParams?: Record<string, any>;
}

/**
 * iframe操作配置
 */
export interface IIframeAction {
  type: CardActionType.IFRAME;
  /** iframe URL */
  url: string;
  /** iframe宽度 */
  width?: number | string;
  /** iframe最小宽度 */
  minWidth?: number | string;
  /** iframe最大宽度 */
  maxWidth?: number | string;
  /** iframe标题 */
  title?: string;
}

/**
 * fetch操作配置
 */
export interface IFetchAction {
  type: CardActionType.FETCH;
  /** 请求URL */
  url: string;
  /** 请求方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求参数（GET请求会转为query参数，POST等会作为body） */
  params?: Record<string, any>;
  /** 请求体（POST等请求时使用，优先级高于params） */
  body?: any;
  /**
   * 自定义成功判断表达式（可选）
   * - 字符串形式，用于判断接口是否成功
   * - 只支持非常简单的「路径 = 值」形式：
   *   - 'code=0'
   *   - 'success=true'
   * - 如果不配置，则仅根据http状态码判断
   */
  successExpression?: string;
  /** 是否显示加载状态，默认true */
  showLoading?: boolean;
  /** 接口成功和失败提示，默认不提示 */
  toast?: {
    success?: string;
    fail?: string;
  };
}

/**
 * 链接操作配置
 */
export interface ILinkAction {
  type: CardActionType.LINK;
  /** 链接地址 */
  url: string;
  /** 是否在新窗口打开 */
  target?: '_blank' | '_self';
}

/**
 * 打开链接操作配置
 */
export type IPopupAction = {
  type: CardActionType.POPUP;
} & Omit<IIframeAction, 'type'>;

/**
 * 打开链接操作配置
 */
export type ICustomAction = {
  type: CardActionType.CUSTOM;
  resourceId: string;
  resourceBizType?: string;
};

/**
 * 卡片操作联合类型
 */
export type ICardAction = IChatAction | IIframeAction | IFetchAction | ILinkAction | IPopupAction | ICustomAction;

/**
 * 按钮配置
 */
export interface ICardButton {
  /** 按钮唯一标识，用于更新按钮状态 */
  key?: string;
  /** 按钮文本 */
  text: string;
  /** 按钮类型：primary（主要）、default（默认）、dashed（虚线）、text（文本）、link（链接） */
  type?: 'primary' | 'default' | 'dashed' | 'text' | 'link';
  /** 按钮大小：large、middle、small */
  size?: 'large' | 'middle' | 'small';
  /** 按钮操作 */
  action: ICardAction;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 卡片配置
 */
export interface ICardConfig {
  /** 卡片标题（可选） */
  title?: ICardTitle;

  /** 卡片内容（可选，但通常应该有内容） */
  content?: ICardContent;

  /** 按钮列表（可选） */
  buttons?: ICardButton[];

  /** 卡片点击操作（可选，当没有按钮时，可以点击整个卡片） */
  action?: ICardAction;

  /** 卡片自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 卡片数据（用于序列化/反序列化）
 * 这是实际在消息中传递的JSON结构
 */
export type ICardData = ICardConfig;
