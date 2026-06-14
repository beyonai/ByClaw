import { GET, POST } from '@/service/common/request';

export interface MailServerConfig {
  host?: string;
  port?: number;
  encryption?: string;
}

export interface PersonalEmailAccount {
  accountId?: number | string;
  name?: string;
  email?: string;
  displayName?: string;
  display_name?: string;
  default?: boolean;
  imap?: MailServerConfig;
  smtp?: MailServerConfig;
  authCode?: string;
  auth_code?: string;
  hasAuthCode?: boolean;
  authCodeLast4?: string;
  updateTime?: string;
}

export const queryPersonalEmailAccounts = () => GET<PersonalEmailAccount[]>('/byaiService/userMailAccount/list');

export const savePersonalEmailAccount = (data: PersonalEmailAccount) =>
  POST<PersonalEmailAccount>('/byaiService/userMailAccount/save', data);

export const deletePersonalEmailAccount = (accountId: number | string) =>
  POST<boolean>('/byaiService/userMailAccount/delete', { accountId });

export const setDefaultPersonalEmailAccount = (accountId: number | string) =>
  POST<PersonalEmailAccount>('/byaiService/userMailAccount/setDefault', { accountId });
