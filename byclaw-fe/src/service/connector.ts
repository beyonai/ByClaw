import { GET, POST } from '@/service/common/request';

// 前后端约定：连接器 ID 仅允许三种企业协作平台，避免聊天 payload 传入未知平台。
export type ConnectorId = 'dingtalk' | 'wecom' | 'feishu';

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

// 以下路径是连接器前后端接口契约；后端实现完成后前端无需再修改授权交互代码。
// 查询当前用户可用的历史授权，用于区分“已授权”和“本轮聊天已选中”。
export const listConnectorConnections = () => GET<ConnectorConnection[]>('/byaiService/connector/connections');

// 创建一次性授权任务，后端返回平台二维码或跳转地址，并负责保存任务与三方回调结果。
export const startConnectorAuthorization = (data: StartConnectorAuthorizationPayload) =>
  POST<ConnectorAuthorization>('/byaiService/connector/authorization/start', data);

// 按授权任务 ID 读取状态，供前端轮询并在 connected 后回显连接器。
export const getConnectorAuthorization = (authorizationId: string) =>
  GET<ConnectorAuthorization>('/byaiService/connector/authorization/status', { authorizationId });
