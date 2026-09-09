import { GET, POST } from '@/service/common/request';

export interface MailServerConfig {
  host?: string;
  port?: number;
  encryption?: MailEncryption;
}

export type MailEncryption = 'tls' | 'starttls' | 'ssl';

export type MailCapability = 'list' | 'get' | 'search' | 'downloadAttachment' | 'send' | 'reply' | 'delete';

export type MailCapabilityStatus = 'YES' | 'NO' | `CONDITIONAL_${string}`;

export type MailAuthType = 'OAUTH2' | 'API_TOKEN' | 'APP_PASSWORD' | 'BROWSER_SSO' | 'NTLM' | 'KERBEROS';

export interface MailProvider {
  code: string;
  name: string;
  transport: string;
  authType: MailAuthType;
  imap?: MailServerConfig;
  smtp?: MailServerConfig;
  connectorCode?: string;
  capabilities: MailCapability[];
  capabilityStatus: Partial<Record<MailCapability, MailCapabilityStatus>>;
  setupRequirements: string[];
  advancedServerEditable: boolean;
}

export interface MailConnectionCheckResult {
  connectionState: string;
  lastCheckTime?: string;
  status?: string;
  capabilityStatus?: Partial<Record<MailCapability, MailCapabilityStatus>>;
}

export interface PersonalEmailAccount {
  accountId?: number | string;
  name?: string;
  email?: string;
  displayName?: string;
  display_name?: string;
  providerCode?: string;
  authType?: MailAuthType;
  capabilities?: MailCapability[];
  capabilityStatus?: Partial<Record<MailCapability, MailCapabilityStatus>>;
  setupRequirements?: string[];
  connectionState?: string;
  lastCheckTime?: string;
  status?: string;
  default?: boolean;
  imap?: MailServerConfig;
  smtp?: MailServerConfig;
  hasAuthCode?: boolean;
  authCodeLast4?: string;
  updateTime?: string;
}

export interface PersonalEmailAccountSavePayload {
  accountId?: number | string;
  name?: string;
  email?: string;
  providerCode?: string;
  authType?: MailAuthType;
  displayName?: string;
  default?: boolean;
  imap?: MailServerConfig;
  smtp?: MailServerConfig;
  authCode?: string;
}

export const queryPersonalEmailAccounts = () => GET<PersonalEmailAccount[]>('/byaiService/userMailAccount/list');

export const queryMailProviders = () => GET<MailProvider[]>('/byaiService/userMailAccount/providers');

export const savePersonalEmailAccount = (data: PersonalEmailAccountSavePayload) =>
  POST<PersonalEmailAccount>('/byaiService/userMailAccount/save', data);

export const deletePersonalEmailAccount = (accountId: number | string) =>
  POST<boolean>('/byaiService/userMailAccount/delete', { accountId });

export const setDefaultPersonalEmailAccount = (accountId: number | string) =>
  POST<PersonalEmailAccount>('/byaiService/userMailAccount/setDefault', { accountId });

// Task 12 owns the backend implementation; keeping this shape here isolates the UI from that rollout.
export const checkPersonalEmailConnection = (accountId: number | string) =>
  POST<MailConnectionCheckResult>('/byaiService/userMailAccount/check', { accountId });
