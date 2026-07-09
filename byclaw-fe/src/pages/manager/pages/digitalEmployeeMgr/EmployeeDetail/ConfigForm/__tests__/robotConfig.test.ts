import {
  getReusableRobotConfigValues,
  getRobotConfigIdentityValue,
  isWeComChannel,
  normalizeRobotConfig,
} from '../robotConfig';

describe('robotConfig helpers', () => {
  it('detects WeCom channel from system config value', () => {
    expect(isWeComChannel('WeCom')).toBe(true);
    expect(isWeComChannel('DingTalk')).toBe(false);
  });

  it('uses clientId as DingTalk identity', () => {
    expect(
      getRobotConfigIdentityValue({
        channel: 'DingTalk',
        clientId: 'ding-client',
        robotCode: 'ding-robot',
      })
    ).toBe('ding-client');
  });

  it('uses botId as WeCom identity without requiring clientId', () => {
    expect(
      getRobotConfigIdentityValue({
        channel: 'WeCom',
        botId: 'bot-100001',
      })
    ).toBe('bot-100001');
  });

  it('normalizes WeCom credentials from machineChannel payload', () => {
    expect(
      normalizeRobotConfig({
        channel: 'WeCom',
        botId: 'bot-1',
        secret: 'secret-1',
        agentId: '1000002',
        corpId: 'ww-corp',
        corpSecret: 'contact-secret',
      })
    ).toEqual({
      channel: 'WeCom',
      clientId: '',
      clientSecret: 'secret-1',
      robotCode: 'bot-1',
      AICardId: '',
      botId: 'bot-1',
      secret: 'secret-1',
      agentId: '1000002',
      corpId: 'ww-corp',
      corpSecret: 'contact-secret',
      appId: '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
    });
  });

  it('reuses DingTalk identity and secret values for WeCom fields', () => {
    expect(
      getReusableRobotConfigValues({
        channel: 'WeCom',
        clientId: 'ding-client',
        clientSecret: 'ding-secret',
        robotCode: 'ding-robot',
      })
    ).toEqual({
      channel: 'WeCom',
      clientId: 'ding-client',
      clientSecret: 'ding-secret',
      robotCode: 'ding-robot',
      agentId: '',
      corpId: '',
      corpSecret: '',
      AICardId: '',
      botId: 'ding-robot',
      secret: 'ding-secret',
      appId: '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
    });
  });

  it('reuses WeCom botId and secret values for DingTalk fields', () => {
    expect(
      getReusableRobotConfigValues({
        channel: 'DingTalk',
        botId: 'wecom-bot',
        secret: 'wecom-secret',
      })
    ).toEqual({
      channel: 'DingTalk',
      clientId: '',
      clientSecret: 'wecom-secret',
      robotCode: 'wecom-bot',
      agentId: '',
      corpId: '',
      corpSecret: '',
      AICardId: '',
      botId: 'wecom-bot',
      secret: 'wecom-secret',
      appId: '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
    });
  });
});
