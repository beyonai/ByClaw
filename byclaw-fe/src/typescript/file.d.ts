import type { RcFile, UploadRequestFile } from 'antd/lib/upload';

/**
 * 文件查询接口类型定义
 */
export interface IQueryFile {

  /** 批次ID */
  batchId: null;

  /** 构建配置 */
  buildConf: null;

  /** 业务用户ID */
  businessUserId: null;

  /** 业务用户名 */
  businessUserName: null;

  /** 分片数量 */
  chunkNum: null;

  /** 分片大小 */
  chunkSize: null;

  /** 完成时间 */
  completeTime: null;

  /** 内容类型 */
  contentType: string;

  /** 转换后的文件名 */
  convertFileName: null;

  /** 转换后的文件URL */
  convertFileUrl: null;

  /** 是否转换为PDF */
  convertPdf: null;

  /** 创建者ID */
  createBy: number;

  /** 数据集合ID */
  dataCollectionId: null;

  /** 数据集ID */
  datasetId: number;

  /** 数据集类型 */
  datasetType: string;

  /** 文档ID */
  docId: null;

  /** 增强ID */
  enhId: null;

  /** 是否存在同名文件 */
  existSameFileName: boolean;

  /** 文件分片上传状态 */
  fileChunkUploadState: null;

  /** 文件集合ID */
  fileCollectId: number;

  /** 文件集合名称 */
  fileCollectName: null;

  /** 文件ID */
  fileId: number;

  /** 文件MD5值 */
  fileMd5: string;

  /** 文件名 */
  fileName: string;

  /** 文件分段增强 */
  fileSegEnhance: null;

  /** 文件分段 */
  fileSegmentation: null;

  /** 文件系统类型 */
  fileSystemType: string;

  /** 文件类型 */
  fileType: string;

  /** 文件类型转换 */
  fileTypeConversion: null;

  /** 文件URL */
  fileUrl: string;

  /** 文件MINIO的路径 */
  filePath: string;

  /** 过滤位 */
  filterBits: null;

  /** 是否生成问答 */
  generateQa: null;

  /** 主键ID */
  id: number;

  /** 是否为AQS */
  isAqs: null;

  /** 文件长度 */
  length: number;

  /** 元数据 */
  metadata: null;

  /** 原始文件名 */
  originFileName: string;

  /** 父级ID */
  parentId: null;

  /** 进度 */
  progress: null;

  /** 同名文件策略 */
  sameNameFileStrategy: null;

  /** 语义索引数量 */
  semanticsIndexNum: null;

  /** 文件大小（MB） */
  size: string;

  /** 摘要 */
  summary: null;

  /** 团队ID */
  teamId: null;

  /** 术语数量 */
  termNum: null;

  /** 线程ID */
  threadId: null;

  /** 上传时间戳 */
  uploadDate: number;

  /** 上传状态 */
  uploadState: string;

  /** 用户名 */
  username: null;

  /** 向量分块规则 */
  vectorChunckRule: null;

  /** 向量索引类型 */
  vectorIndexType: null;
}

export type WisdomPenIFile = {
  useType: 'outline' | 'content';
  sourceType: 'localUpload' | 'knowledgeBase';
};

export type IFile = {
  file?: File | RcFile | UploadRequestFile;
  uid: string;
  downloadUrl?: string;
  imgUrl?: string;
  status: string; // 'uploading' | 'done';
  fileType: 'image' | 'file';
  queryFile?: Partial<IQueryFile>;
} & Partial<WisdomPenIFile>;
