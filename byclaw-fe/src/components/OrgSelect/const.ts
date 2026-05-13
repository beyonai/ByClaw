import { getIntl } from '@umijs/max';

export const listTypeMap = {
  org: 'ORG',
  post: 'POST',
  station: 'STATION',
  agent: 'AGENT',
};

export const leftTypeMap = {
  list: 'list',
  searchList: 'searchList',
};

export const dataItemTypeMap = {
  org: 'ORG',
  user: 'USER',
  post: 'POST',
  station: 'STATION',
  agent: 'AGENT',
  session: 'SESSION',
};

export const searchTypeMap = {
  all: 'all',
  org: 'org',
  user: 'user',
  post: 'post',
  station: 'station',
  agent: 'agent',
};

export const searchTypeOpts = [
  {
    label: getIntl().formatMessage({ id: 'orgMgr.personalSelect.all' }),
    key: searchTypeMap.all,
  },
  {
    label: getIntl().formatMessage({ id: 'orgMgr.personalSelect.org' }),
    key: searchTypeMap.org,
  },
  {
    label: getIntl().formatMessage({ id: 'orgMgr.personalSelect.user' }),
    key: searchTypeMap.user,
  },
  {
    label: getIntl().formatMessage({ id: 'orgMgr.modal.position' }),
    key: searchTypeMap.post,
  },
  // {
  //   label: getIntl().formatMessage({ id: 'orgMgr.personalSelect.station' }),
  //   key: searchTypeMap.station,
  // },
  {
    label: getIntl().formatMessage({ id: 'orgMgr.personalSelect.agent' }),
    key: searchTypeMap.agent,
  },
];
