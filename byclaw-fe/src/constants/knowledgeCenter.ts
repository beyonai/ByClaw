// @ts-ignore
import { getIntl } from '@umijs/max';

export const areaList = [
  {
    key: '1',
    title: getIntl().formatMessage({ id: 'knowledgeCenter.onlyVisibleToYourself' }),
    subTitle: getIntl().formatMessage({ id: 'knowledgeCenter.onlyVisibleToYourselfDesc' }),
    icon: 'icon-a-Useryonghu',
  },
  {
    key: '2',
    title: getIntl().formatMessage({ id: 'knowledgeCenter.partiallyVisible' }),
    subTitle: getIntl().formatMessage({ id: 'knowledgeCenter.partiallyVisibleDesc' }),
    icon: 'icon-a-Locksuoding',
  },
  {
    key: '3',
    title: getIntl().formatMessage({ id: 'knowledgeCenter.visibleToEntireCompany' }),
    subTitle: getIntl().formatMessage({ id: 'knowledgeCenter.visibleToEntireCompanyDesc' }),
    icon: 'icon-a-Building-onejianzhu',
  },
];

export const grantType = [
  {
    label: getIntl().formatMessage({ id: 'permissionManage.viewOnly' }),
    value: 'AVAILABLE_USE',
  },
  {
    label: getIntl().formatMessage({ id: 'permissionManage.viewOnly' }),
    value: 'SHARE_USE',
  },
  {
    label: getIntl().formatMessage({ id: 'permissionManage.canManage' }),
    value: 'ALLOW_MANAGE',
  },
];
