export type IDataCloudKey =
  "internetData"
  | "internalKnowledgeBase"
  | 'internalKnowledgeBase'
  | 'personalBasicInfo'
  | 'jingjiaBusinessData'
  | 'subscribedDigitalEmployees'
  | 'browserPageData';

export type IFunctionCloudKey =
  'jingjiaSystem'
  | 'googleChrome';

export type IMemoryKey = 'openMemory';

export type SettingItemKey = IDataCloudKey | IFunctionCloudKey | IMemoryKey;

export type IParamValueConfig = {
  "paramCode": string,
  "paramDesc": string,
  "paramEnName": string,
  "paramId": number,
  "paramName": string,
  "paramType": string,
  "paramValue": string
}

export interface IOSettingConfContent {
  name: string;
  description: string;
  icon: string;
  defaultValue: any;
  choiceValue: boolean;
  editable: boolean;
  componentType: 'toggle';
}

export interface ISettingConfContent extends IOSettingConfContent {
  key: SettingItemKey;
}

// 后端返回的原始配置是以 key 为下标的对象结构，这里单独用一个类型表示
// （例如：{ internalKnowledgeBase: { ...IOSettingConfContent }, ... }）
export type ISettingGroup = Record<SettingItemKey, IOSettingConfContent>;

// 前端实际使用的配置结构是「数组形式」，每一项都带有 key 字段，方便做列表渲染
export type ISettingConf = {
  dataCloud: ISettingConfContent[];
  functionCloud: ISettingConfContent[];
  memory: ISettingConfContent[];
};

// 原始 JSON 配置（一般对应接口直接返回的数据结构），仍然保持为对象形式
export type IChatSettingJSON = {
  dataCloud: ISettingGroup;
  functionCloud: ISettingGroup;
  memory?: ISettingGroup;
};

export type IChatSettingValue = {
  dataCloud: Record<SettingItemKey, any>;
  functionCloud: Record<SettingItemKey, any>;
  memory?: Record<SettingItemKey, any>;
};

export type IOriginObject = {
  dataCloud?: Record<SettingItemKey, IParamValueConfig>;
  functionCloud?: Record<SettingItemKey, IParamValueConfig>;
  memory?: Record<SettingItemKey, IParamValueConfig>;
};