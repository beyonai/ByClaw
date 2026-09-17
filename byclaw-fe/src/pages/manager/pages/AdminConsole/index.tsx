import { FileOutlined, FolderOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import { Alert, Button, Card, Input, Layout, Select, Space, Tag, Tree, Typography, message } from 'antd';
import React, { useMemo, useState } from 'react';

import { runRedisCommand } from '@/pages/manager/service/AdminConsole';

const AdminConsole: React.FC = () => {
  // 界面文案随当前语言更新，业务名称与接口数据保持原值。
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const [redisResult, setRedisResult] = useState('');
  const [redisKeys, setRedisKeys] = useState<string[]>([]);
  const [redisKey, setRedisKey] = useState('');
  const [redisDb, setRedisDb] = useState('0');
  const [loading, setLoading] = useState(false);

  const execute = async (command: string, callback: (data: any) => void) => {
    setLoading(true);
    try {
      const res: any = await runRedisCommand(command);
      if (res?.code !== 0) {
        message.error(res?.msg || intl.formatMessage({ id: 'ui.admin.queryFailed' }));
        return;
      }
      callback(res.data);
    } finally {
      setLoading(false);
    }
  };

  const loadRedisKey = async (key: string) => {
    if (!key || loading) return;
    setLoading(true);
    try {
      setRedisKey(key);
      const typeRes: any = await runRedisCommand(`TYPE ${key}`);
      if (typeRes?.code !== 0) {
        message.error(typeRes?.msg || intl.formatMessage({ id: 'ui.admin.typeFailed' }));
        return;
      }
      const type = String(typeRes?.data?.result || 'string').toLowerCase();
      const commands: Record<string, string> = {
        string: `GET ${key}`,
        hash: `HGETALL ${key}`,
        list: `LRANGE ${key} 0 -1`,
        set: `SMEMBERS ${key}`,
        zset: `ZRANGE ${key} 0 -1 WITHSCORES`,
        stream: `XRANGE ${key} - + COUNT 100`,
      };
      const detailRes: any = await runRedisCommand(commands[type] || `GET ${key}`);
      if (detailRes?.code !== 0) {
        message.error(detailRes?.msg || intl.formatMessage({ id: 'ui.admin.queryFailed' }));
        return;
      }
      setRedisResult(JSON.stringify({ type, value: detailRes?.data?.result ?? null }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const countLeaves = (node: any): number =>
    node.children.size === 0
      ? 1
      : Array.from(node.children.values()).reduce((sum: number, child: any) => sum + countLeaves(child), 0);

  const buildTree = (keys: string[]) => {
    const root: any = { children: new Map() };
    keys.forEach((key) => {
      const parts = key.split(':').filter(Boolean);
      let node = root;
      parts.forEach((part, index) => {
        const leaf = index === parts.length - 1;
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, fullKey: leaf ? key : undefined, children: new Map() });
        }
        node = node.children.get(part);
      });
    });
    const convert = (node: any, parentPath = ''): any[] =>
      Array.from(node.children.values())
        .sort((a: any, b: any) => {
          const aLeaf = a.children.size === 0;
          const bLeaf = b.children.size === 0;
          return aLeaf === bLeaf ? a.name.localeCompare(b.name) : aLeaf ? 1 : -1;
        })
        .map((item: any) => {
          const nodePath = parentPath ? `${parentPath}/${item.name}` : item.name;
          return {
            key: item.fullKey || `folder:${nodePath}`,
            title: item.children.size ? `${item.name} (${countLeaves(item)})` : item.name,
            icon: item.children.size ? <FolderOutlined /> : <FileOutlined />,
            children: item.children.size ? convert(item, nodePath) : undefined,
            isLeaf: item.children.size === 0,
            fullKey: item.fullKey,
          };
        });
    return convert(root);
  };

  const updateKeys = (raw: any) => {
    const values = Array.isArray(raw) ? (Array.isArray(raw[1]) ? raw[1] : raw) : [];
    setRedisKeys(Array.from(new Set(values.filter(Boolean).map(String))));
  };

  const buildMatchPattern = (value: string) => {
    const input = value.trim();
    if (!input) return '*';
    // 普通关键字按包含关系搜索，同时保留 Redis glob 写法供前缀/后缀筛选。
    const hasGlob = ['*', '?', '[', ']'].some((character) => input.includes(character));
    return hasGlob ? input : `*${input}*`;
  };

  const redisTree = useMemo(() => buildTree(redisKeys), [redisKeys]);

  if (userInfo?.userCode?.toLowerCase() !== 'adminvip') {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#666' }}>
        {' '}
        {intl.formatMessage({ id: 'ui.admin.denied' })}{' '}
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Alert type="warning" showIcon message={intl.formatMessage({ id: 'ui.admin.policy' })} />
      <Card bodyStyle={{ padding: 0 }} style={{ marginTop: 16 }}>
        <Layout style={{ minHeight: 660, background: '#fff' }}>
          <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #eee' }}>
            <Space size="middle" wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {' '}
                {intl.formatMessage({ id: 'ui.admin.query' })}{' '}
              </Typography.Title>
              <Tag color="green"> {intl.formatMessage({ id: 'ui.admin.connected' })} </Tag>
              <Typography.Text type="secondary"> {intl.formatMessage({ id: 'ui.admin.instance' })} </Typography.Text>
              <Button
                loading={loading}
                onClick={() => execute('PING', (data) => setRedisResult(data?.result || 'PONG'))}
              >
                {' '}
                {intl.formatMessage({ id: 'ui.admin.refreshConnection' })}{' '}
              </Button>
            </Space>
          </div>
          <Layout hasSider style={{ background: '#fff' }}>
            <Layout.Sider width={320} theme="light" style={{ borderRight: '1px solid #eee', padding: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    value={redisDb}
                    onChange={setRedisDb}
                    options={Array.from({ length: 16 }, (_, index) => ({ value: String(index), label: `DB${index}` }))}
                    style={{ width: 100 }}
                  />
                  <Button
                    loading={loading}
                    type="primary"
                    onClick={() => execute('SCAN 0 MATCH * COUNT 100', (data) => updateKeys(data?.result))}
                    style={{ flex: 1 }}
                  >
                    {' '}
                    {intl.formatMessage({ id: 'ui.admin.refreshKeys' })}{' '}
                  </Button>
                </Space.Compact>
                <Input.Search
                  placeholder={intl.formatMessage({ id: 'ui.admin.searchKeys' })}
                  allowClear
                  loading={loading}
                  onSearch={(value) =>
                    execute(`SCAN 0 MATCH ${buildMatchPattern(value)} COUNT 100`, (data) => updateKeys(data?.result))
                  }
                />
                <Typography.Text type="secondary">
                  {intl.formatMessage({ id: 'ui.admin.keys' }, { count: redisKeys.length })}
                </Typography.Text>
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 4 }}>
                  <Tree
                    showIcon
                    blockNode
                    selectable
                    virtual
                    height={480}
                    itemHeight={32}
                    treeData={redisTree}
                    titleRender={(node: any) => (
                      <Typography.Text ellipsis style={{ maxWidth: 260 }}>
                        {node.title}
                      </Typography.Text>
                    )}
                    onSelect={(_, info: any) => {
                      if (info.node.fullKey) loadRedisKey(info.node.fullKey);
                    }}
                  />
                </div>
              </Space>
            </Layout.Sider>
            <Layout.Content style={{ padding: 24 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space>
                  <Typography.Text strong>Key：</Typography.Text>
                  <Input
                    value={redisKey}
                    onChange={(event) => setRedisKey(event.target.value)}
                    placeholder={intl.formatMessage({ id: 'ui.admin.selectKey' })}
                    style={{ width: 520 }}
                  />
                  <Button loading={loading} type="primary" onClick={() => loadRedisKey(redisKey)}>
                    {' '}
                    {intl.formatMessage({ id: 'ui.admin.view' })}{' '}
                  </Button>
                </Space>
                <Tag color="blue"> {intl.formatMessage({ id: 'ui.admin.detectType' })} </Tag>
                <Input.TextArea
                  readOnly
                  value={redisResult}
                  rows={24}
                  placeholder={intl.formatMessage({ id: 'ui.admin.valuePlaceholder' })}
                  style={{ fontFamily: 'monospace', minHeight: 480 }}
                />
              </Space>
            </Layout.Content>
          </Layout>
        </Layout>
      </Card>
    </div>
  );
};

export default AdminConsole;
