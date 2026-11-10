import { POST } from '@/service/common/request';
import { history } from '@umijs/max';
import { Alert, Button, Card, Checkbox, Drawer, Empty, message, Space, Spin, Tag, Typography } from 'antd';
import copy from 'copy-to-clipboard';
import { useEffect, useState } from 'react';
import styles from './market.module.less';

type Template = {
  templateKey: string;
  serviceKey: string;
  displayName: string;
  imageTag: string;
  description?: string;
  coverImage?: string;
  enabled?: boolean;
  available?: boolean;
  capabilities: string[];
  buildStatus: string;
  ready: boolean;
};

export default function ToolSandboxMarket() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [details, setDetails] = useState<Template | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    setLoading(true);
    try {
      const response = await POST<any>('/byaiService/sandbox/toolTemplates', {});
      setTemplates(Array.isArray(response) ? response : response?.data || []);
      setError('');
    } catch {
      setError('无法读取模板状态，请登录后重试。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  const usable = templates.filter(
    (template) => selected.includes(template.templateKey) && template.enabled !== false && template.available !== false
  );
  const task = `请根据我的业务需求，使用所选工具环境协同完成任务：${usable
    .map((template) => `${template.displayName}（${template.capabilities.join('、')}）`)
    .join('；')}。先确认输入和交付要求，按需申请环境，保留来源与产物，完成后释放资源。`;

  const run = () => {
    try {
      if (!copy(task)) throw new Error('Clipboard unavailable');
      message.success('协作任务已复制，请在聊天输入框粘贴并发送');
      history.push('/chat');
    } catch {
      message.error('复制失败，请从下方复制协作任务');
    }
  };

  return (
    <main className={styles.market}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>BYCLAW / TOOL SANDBOX MARKET</div>
          <Typography.Title level={1}>为任务组合执行环境</Typography.Title>
          <Typography.Paragraph>浏览器采集、媒体制作，各自运行，统一交付。</Typography.Paragraph>
        </div>
        <Space>
          <Button onClick={() => history.push('/chat')}>返回聊天</Button>
          <Button onClick={refresh} loading={loading}>
            刷新模板状态
          </Button>
        </Space>
      </header>
      {error && <Alert type="error" message={error} showIcon />}
      <Spin spinning={loading}>
        <section className={styles.grid}>
          {templates.map((template) => (
            <Card
              key={template.serviceKey}
              className={styles.card}
              cover={
                template.coverImage ? (
                  <img className={styles.cover} src={template.coverImage} alt={template.displayName} />
                ) : undefined
              }
            >
              <Space className={styles.cardTop}>
                <Tag color={template.enabled === false ? 'default' : 'green'}>
                  {template.enabled === false ? '已停用' : template.available === false ? '配置待检查' : '可申请'}
                </Tag>
                <Tag>{template.ready ? '已构建' : '按需启动'}</Tag>
                <span>{template.imageTag}</span>
              </Space>
              <Typography.Title level={2}>{template.displayName}</Typography.Title>
              <p>
                {template.description ||
                  (template.templateKey === 'browser'
                    ? '浏览网页、提取资料、记录可核查的来源与页面截图。'
                    : '按任务需要组合专业工具，处理当前用户授权的素材与产物。')}
              </p>
              <Space wrap>
                {template.capabilities.map((capability) => (
                  <Tag key={capability}>{capability}</Tag>
                ))}
              </Space>
              <div className={styles.connection}>独立环境 · 按需使用 · 产物隔离</div>
              <Checkbox
                checked={selected.includes(template.templateKey)}
                disabled={template.enabled === false || template.available === false}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...new Set([...current, template.templateKey])]
                      : current.filter((key) => key !== template.templateKey)
                  )
                }
              >
                加入协作任务
              </Checkbox>
              <Button type="link" onClick={() => setDetails(template)}>
                查看详情
              </Button>
            </Card>
          ))}
          {!templates.length && !loading && <Empty description="暂无已准入模板" />}
        </section>
      </Spin>
      <section className={styles.workflow}>
        <div className={styles.eyebrow}>COMPOSE / 多环境协作</div>
        <Typography.Title level={3}>组合所需能力，交给助手执行</Typography.Title>
        <p>选择任务需要的工具环境，再到聊天中补充业务目标、输入素材和交付要求。</p>
        <Typography.Paragraph copyable={{ text: task }}>{task}</Typography.Paragraph>
        <Button
          type="primary"
          size="large"
          onClick={run}
          disabled={!usable.length || usable.length !== selected.length}
        >
          复制协作任务并打开聊天
        </Button>
      </section>
      <Drawer title={details?.displayName} open={!!details} onClose={() => setDetails(null)} width={540}>
        {details?.coverImage && <img className={styles.cover} src={details.coverImage} alt={details.displayName} />}
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {details?.description || '暂无详情描述'}
        </Typography.Paragraph>
        <Space wrap>
          {details?.capabilities.map((capability) => (
            <Tag key={capability}>{capability}</Tag>
          ))}
        </Space>
      </Drawer>
    </main>
  );
}
