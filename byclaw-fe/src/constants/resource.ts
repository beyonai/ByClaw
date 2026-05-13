export const ResourceTypeMap = {
  user: 'HUMAN', // 普通企业员工
  superAssistant: 'HUMAN_ASSISTANT', // 超级助手
  digitalEmployee: 'DIG_EMPLOYEE', // 数字员工
  knowledgeBase: 'KG_DOC', // 知识库
  knowledgeBaseQa: 'KG_QA', // 知识库问答
  knowledgeBaseTerm: 'KG_TERM', // 知识库问答
  folder: 'KG_DOC_FOLDER', // 知识库文件夹
  file: 'KG_DOC_FILE', // 知识库文件
  database: 'KG_DB', // chatbi数据库
  doc: 'DOC', // KG_DOC,KG_QA,KG_TERM

  Agent: 'AGENT', // 智能体
  MCP: 'MCP',
  TOOL: 'TOOL',
  TOOLKIT: 'TOOLKIT',
  VIEW: 'VIEW',
  OBJECT: 'OBJECT',
  SKILL: 'SKILL',

  Knowledge: 'Knowledge', // 知识库插件
  KnowledgeKIT: 'KnowledgeKIT', // 知识库插件库
} as const;

export const FileUploadStatusMap = {
  '-1': '失败',
  1: '未开始',
  2: '处理中',
  3: '已完成',
  41: '存储完成',
};

export const FileUploadStatusColors: Record<string, string> = {
  '-1': '#FF7D00', // 构建失败 - 橙色
  1: '#A4AAB2', // 未开始构建 - 灰色
  2: '#165DFF', // 构建中 - 蓝色
  3: '#00B42A', // 构建成功 - 绿色
  41: '#722ed1', // 存储完成 - 紫色
};
