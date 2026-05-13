## 数据结构说明

### 卡片整体结构
整体例子：
```json
{
  "title": "卡片标题",
  "content": {
    "blocks": [
      { "type": "text", "text": "第一段文本" },
      { "type": "markdown", "text": "# 标题\n内容" },
      { "type": "image", "src": "https://...", "alt": "图片" },
      { "type": "agentInfo", "agentId": "xxxxxxxx" }
    ]
  },
  "buttons": [
    {
      "key": "btn-handle",
      "text": "去处理",
      "disabledText": "已处理",
      "action": {
        "type": "chat",
        "agentId": "xxxxxxxx",
        "message": "你好",
        "extParams": {}
      }
    },
    {
      "text": "按钮1",
      "action": {
        "type": "url",
        "url": "https://...",
        "target": "_blank"
      }
    },
    {
      "text": "按钮2",
      "action": {
        "type": "iframe",
        "url": "https://example.com",
        "title": "窗口标题"
      }
    },
    {
      "text": "按钮3",
      "action": {
        "type": "fetch",
        "url": "/api/endpoint",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json"
        },
        "params": {
          "key": "value"
        },
        "body": {},
        "showLoading": true,
        "successExpression": "code=0",
        "toast": {
          "success": "操作成功",
          "fail": "操作失败"
        }
      }
    }
  ]
}
```
`typescript`定义如下：
```typescript
/**
 * 卡片配置
 */
interface ICardConfig {
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
 * 卡片标题配置
 */
type ICardTitle = string | {
  /**
   * 主标题文本
   */
  mainTitle: string | {
    text: string;
    style?: React.CSSProperties;
  };

  /**
   * 副标题文本
   */
  subTitle?: string | {
    text: string;
    style?: React.CSSProperties;
  };

  /**
   * 自定义样式
   */
  style?: React.CSSProperties;
}

/**
 * 文本内容块
 */
interface ITextContent {
  /** 文本类型，默认是此类型 */
  type: 'text';
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
interface IMarkdownContent {
  type: 'markdown';
  /** Markdown文本内容 */
  text: string;
}

/**
 * HTML内容块
 */
interface IHtmlContent {
  type: 'html';
  /** HTML字符串 */
  text: string;
}

/**
 * 图片内容块
 */
interface IImageContent {
  type: 'image';
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
interface IAgentInfo {
  type: 'agentInfo';
  agentId: string;
}

/**
 * 内容块联合类型
 */
type ICardContentBlock =
  | ITextContent
  | IMarkdownContent
  | IHtmlContent
  | IImageContent
  | IAgentInfo;

/**
 * 卡片内容配置
 */
interface ICardContent {
  /** 内容块列表 */
  blocks: ICardContentBlock[];
  /** 内容区域自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 聊天操作配置
 */
interface IChatAction {
  type: 'chat';
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
interface IIframeAction {
  type: 'iframe';
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
interface IFetchAction {
  type: 'fetch';
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
interface ILinkAction {
  type: 'link';
  /** 链接地址 */
  url: string;
  /** 是否在新窗口打开 */
  target?: '_blank' | '_self';
}

/**
 * 卡片操作联合类型
 */
type ICardAction =
  | IChatAction
  | IIframeAction
  | IFetchAction
  | ILinkAction;

/**
 * 按钮配置
 */
interface ICardButton {
  /** 按钮唯一标识，用于更新按钮状态 */
  key?: string;
  /** 按钮文本 */
  text: string;
  /** 按钮禁用时的文本 */
  disabledText?: string;
  /** 按钮类型：primary（主要）、default（默认）、dashed（虚线）、text（文本）、link（链接） */
  type?: 'primary' | 'default' | 'dashed' | 'text' | 'link';
  /** 按钮大小：large、middle、small */
  size?: 'large' | 'middle' | 'small';
  /** 按钮操作 */
  action: ICardAction;
  /** 自定义样式 */
  style?: React.CSSProperties;
}
```

### 标题区域 (ICardTitle)

- **主标题**：必填
- **副标题**：可选

```typescript
{
  title: '主标题'
}
// 或者
{
  title: {
    mainTitle: '主标题',
    subTitle: '副标题'
  }
}
```

### 内容区域 (ICardContent)

内容区域采用块（Block）的概念，支持：

#### 支持的内容类型

1. **文本 (text)**：纯文本内容
2. **Markdown (markdown)**：Markdown格式文本，支持富文本渲染
3. **HTML (html)**：HTML富文本（可配置是否允许脚本）
4. **图片 (image)**：单张图片，支持点击操作
5. **数字员工小卡片 (agentInfo)**：显示数字员工信息（头像+名称+描述）

#### 内容块组合示例

```typescript
{
  title: '标题',
  content: {
    blocks: [
      { type: 'text', text: '第一段文本' },
      { type: 'markdown', markdown: '# 标题\n内容' },
      { type: 'image', src: 'https://...', alt: '图片' },
      { type: 'agentInfo', agentId: 'xxxxxxxx' },
    ]
  }
}
```

### 按钮区域 (ICardButton[])

按钮区域支持多个按钮，每个按钮可以执行不同的操作。

#### 按钮配置

```typescript
{
  buttons: [
    {
      text: '按钮文本',
      type: 'primary',      // primary | default | dashed | text | link
      size: 'middle',       // large | middle | small
      action: { ... },       // 操作配置 参考 ICardAction
      disabled: false,      // 是否禁用
    }
  ]
}
```

### 操作类型 (ICardAction)

按钮和卡片点击都支持以下操作类型：

#### 聊天操作 (CHAT)

向数字员工发起聊天或发送消息：

```typescript
{
  type: 'chat',
  agentId: 'xxxxxxxx',           // 目标数字员工ID          // 数字员工类型（可选）
  message: '你好',                // 要发送的消息（可选）
  newSession: true,              // 是否在新会话中发送
  extParams: {},                 // 扩展参数（可选）
}
```

#### iframe操作 (IFRAME)

打开一个iframe窗口：

```typescript
{
  type: 'iframe',
  url: 'https://example.com',      // iframe URL
  title: '窗口标题',               // 可选
}
```

#### fetch操作 (FETCH)

调用API请求：

```typescript
{
  type: 'fetch',
  url: '/api/endpoint',            // 请求URL
  method: 'POST',                  // GET | POST | PUT | DELETE | PATCH
  headers: {                       // 请求头（可选）
    'Content-Type': 'application/json'
  },
  params: {                        // 请求参数（可选）
    key: 'value'
  },
  body: { ... },                   // 请求体（可选，POST等请求时使用）
  showLoading: true,               // 是否显示加载状态(可选）
  successExpression: 'code=0', // 成功表达式（可选）
  toast: {                         // 提示信息（可选）
    success: '操作成功',
    fail: '操作失败'
  },
}
```

#### 链接操作 (LINK)

打开链接：

```typescript
{
  type: 'link',
  url: 'https://example.com',
  target: '_blank'                 // '_blank' | '_self'
}
```
