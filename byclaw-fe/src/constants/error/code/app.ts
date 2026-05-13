import { ErrType } from '../errorCode';

/* dataset: 502000 */
export enum AppErrEnum {
  unExist = 'unExist',
  unAuthApp = 'unAuthApp'
}


const appErrList = [
  {
    statusText: AppErrEnum.unExist,
    message: '应用不存在',
  },
  {
    statusText: AppErrEnum.unAuthApp,
    message: '无权操作该应用',
  },
];
export default appErrList.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 502000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null,
    },
  };
}, {} as ErrType<`${AppErrEnum}`>);

export enum LockStatusEnum {
  noPermission = 0, // 无权限
  locked = 1, // 锁定状态
  unLocked = 2, // 解锁状态
}

export enum LockedObjTypeEnum {
  dataset = 1, // 文档
  app = 2, // 智能体应用
  pluginMachine = 3, // 插件
}

export enum AppOperTypeEnum {
  versionList = 1, // 版本列表
  online = 2, // 上线
  offline = 3, // 下线
  model = 4, // 大模型
  realease = 5, // 发布
  record = 6, // 对话记录
  guide = 7, // 开场白
  flow = 8, // 编排
  edit = 9, // 编辑
  delete = 10, // 删除
}

export enum PluginOperTypeEnum {
  model = 1, // 版本列表
  online = 2, // 上线
  offline = 3, // 下线
  flow = 4, // 编排
  edit = 5, // 编辑
  delete = 6, // 删除
}

export enum ServerStatusEnum {
  online = 1, // 在线
  offline = 2, // 离线
}

export enum VersionStatusEnum {
  draft = 1, // 草稿
  published = 2, // 已发布
  history = 3, // 历史版本
}
