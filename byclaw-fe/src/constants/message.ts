export const ChartMessageType = {
  table: 'table',
  bar: 'bar',
  line: 'line',
  pie: 'pie',
  labelCard: 'labelCard',
};

export enum SSEMessageType {
  thinkText = 1001,
  text,
  code,
  chartBI = 2001,
  form,
  employee,
  outline,
  article,
  iframe,
  approvalForm,
  taskOutline, // ⚠️已废弃
  recommend,
  uiAgent,
  botCard,
  uiAgentForm,
  uiAgentUserForm,
  slientHandler, // ⚠️已废弃
  application,
  forward,
  ppt,
  asr,
  commonCard,
  jsonBlock,
  other = 3001,
  appStreamResponse,
  thinkTitle = 3003,
  thinkResource,
  thinkSubTitle,
  thinkTaskPrepare,
  thinkTaskExecute,
  thinkTaskResult,
  thinkStatusTitle,
  thinkResourceFile,
  thinkRootTitle,
  thinkRewriteQuestion,
  thinkTaskUserInput,
  askUserQuestions,
  toolCall = 3015,
  fileChanges = 3016,
  error = 4001,
  rewriteQuestion,
  dataCloudLogin,
  noticeTodo = 5001,
  noticeShare,
  noticeSmartOffice,
  noticeApproval,
  noticeWelfare,
  noticeTask,
  compaction,
}

export enum IMessageState {
  Query,
  Answer,
  Done,
  Error,
  Cancel,
  Timeout,
}

export const ResourceFromType = {
  DATASET: 'knowledgeDetail.knowledgeBase',
  ON_LINE: 'thinkTitle.networkSearch',
  AGENT: 'common.digitalEmployee',
};

export const SSEEventStatus = {
  start: '_START_',
  query: '_QUERY_',
  done: '_DONE_',
};

export const IObjectType = {
  toolCall: 'tool_call',
};
