import { GET, POST } from '@/service/common/request';

// 连接器 ID 直接使用列表接口返回的数值，避免前端维护一份不完整的平台白名单。
export type ConnectorId = number;

export interface ConnectorListQuery {
  pageNum: number;
  pageSize: number;
  keyword: string;
}

export interface ConnectorListItem {
  connectorCode: string;
  connectorId: number;
  connectorName: string;
  connectorType: 'SYSTEM' | 'CUSTOM';
  description: string;
  // Y=当前用户已连接，N=已连接但关闭，null=当前用户未绑定。
  enableFlag: 'Y' | 'N' | null;
}

export interface ConnectorListPage {
  list: ConnectorListItem[];
  pageNum: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// 后端保存的连接状态；connected 表示可以被当前用户用于聊天检索。
export type ConnectorConnectionStatus = 'connected' | 'pending' | 'failed' | 'expired';

export interface ConnectorConnection {
  connectorId: ConnectorId;
  status: ConnectorConnectionStatus;
  accountName?: string;
}

export interface StartConnectorAuthorizationPayload {
  connectorId: ConnectorId;
  // 后端在授权完成后回跳前端时使用，实际换取 token 的回调仍由后端完成。
  redirectUrl: string;
}

export interface ConnectorAuthorization {
  authorizationId: string;
  connectorId: ConnectorId;
  status: ConnectorConnectionStatus;
  // 二维码和跳转地址由后端按平台返回，前端不保存任何三方凭据。
  qrCodeUrl?: string;
  authorizationUrl?: string;
  expiresAt?: string;
  errorMessage?: string;
}

// 文档接口：查询连接器列表；request 层会自动解包 code=0 响应中的 data 字段。
export const queryConnectorList = (data: ConnectorListQuery) =>
  POST<ConnectorListPage>('/byaiService/connector/listAll', data);

// 创建一次性授权任务，后端返回平台二维码或跳转地址，并负责保存任务与三方回调结果。
export const startConnectorAuthorization = (data: StartConnectorAuthorizationPayload) =>
  POST<ConnectorAuthorization>('/byaiService/connector/authorization/start', data);

// 按授权任务 ID 读取状态，供前端轮询并在 connected 后回显连接器。
export const getConnectorAuthorization = (authorizationId: string) =>
  GET<ConnectorAuthorization>('/byaiService/connector/authorization/status', { authorizationId });
