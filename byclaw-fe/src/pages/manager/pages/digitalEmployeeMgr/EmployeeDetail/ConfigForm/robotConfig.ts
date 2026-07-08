export type RobotConfig = {
  channel?: string;
  clientId?: string;
  clientSecret?: string;
  robotCode?: string;
  AICardId?: string;
  botId?: string;
  secret?: string;
  agentId?: string;
  corpId?: string;
  corpSecret?: string;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
};

const normalizeChannel = (channel?: string) => `${channel || ''}`.replace(/[\s_-]/g, '').toLowerCase();

const firstValue = (...values: Array<string | undefined>) => values.find((value) => value) || '';

export const isWeComChannel = (channel?: string) => normalizeChannel(channel) === 'wecom';

export const getReusableRobotConfigValues = (item: RobotConfig = {}): RobotConfig => {
  const channel = item.channel || '';
  const robotIdentityValue = firstValue(item.botId, item.robotCode);
  const secretValue = firstValue(item.secret, item.clientSecret);

  return {
    channel,
    clientId: item.clientId ?? '',
    clientSecret: firstValue(item.clientSecret, secretValue),
    robotCode: firstValue(item.robotCode, robotIdentityValue),
    AICardId: item.AICardId ?? '',
    botId: firstValue(item.botId, robotIdentityValue),
    secret: firstValue(item.secret, secretValue),
    agentId: item.agentId ?? '',
    corpId: item.corpId ?? '',
    corpSecret: item.corpSecret ?? '',
    appId: item.appId ?? '',
    appSecret: item.appSecret ?? '',
    verificationToken: item.verificationToken ?? '',
    encryptKey: item.encryptKey ?? '',
  };
};

export const getRobotConfigIdentityValue = (item: RobotConfig = {}) => {
  const reusableItem = getReusableRobotConfigValues(item);

  if (isWeComChannel(item.channel)) {
    return reusableItem.botId || '';
  }
  return reusableItem.clientId || '';
};

export const getRobotConfigIdentityKey = (item: RobotConfig = {}) =>
  `${normalizeChannel(item.channel)}:${getRobotConfigIdentityValue(item)}`;

export const getRobotConfigDisplayValue = (item: RobotConfig = {}) => {
  const reusableItem = getReusableRobotConfigValues(item);

  if (isWeComChannel(item.channel)) {
    return {
      label: 'botId',
      value: reusableItem.botId || '',
    };
  }
  return {
    label: 'clientId',
    value: reusableItem.clientId || '',
  };
};

export const normalizeRobotConfig = (item: RobotConfig = {}): RobotConfig => {
  return getReusableRobotConfigValues(item);
};
