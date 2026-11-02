import { POST } from '@/service/common/request';
import { history } from '@umijs/max';
import { Alert, Button, Card, Checkbox, Empty, message, Space, Spin, Tag, Typography } from 'antd';
import copy from 'copy-to-clipboard';
import { useEffect, useState } from 'react';
import styles from './market.module.less';

type Template = {
  templateKey: string;
  serviceKey: string;
  displayName: string;
  imageTag: string;
  capabilities: string[];
  buildStatus: string;
  ready: boolean;
};

export default function ToolSandboxMarket() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string[]>(['browser', 'media']);
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

  const mediaInput = selected.includes('browser')
    ? '在媒体环境读取采集产物'
    : '在媒体环境读取当前用户已授权的素材；未提供素材时先询问素材路径';
  const steps = [
    selected.includes('browser')
      ? '在浏览器环境通过 Playwright 采集 https://www.deepseek.com/en/harness/ 和 https://github.com/deepseek-ai/deepseek-harness/ ，保存真实页面截图、正文与来源清单'
      : '',
    selected.includes('media') ? `${mediaInput}，用 FFmpeg 生成约24秒、16:9、1080p的无声素材视频，无需配音和字幕` : '',
  ].filter(Boolean);
  const task = `请使用工具沙箱模板市场完成所选任务：选用 ${selected.join(
    '、'
  )} 环境，使用 sandbox_templates 确认真实能力、sandbox_acquire 申请独立租约；${steps.join(
    '；'
  )}。所有操作经各自私网SSH连接，产物写当前用户AgenticFS。返回来源、产物链接与执行记录，完成后释放各租约。`;
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
            <Card key={template.templateKey} className={styles.card}>
              <Space className={styles.cardTop}>
                <Tag color={template.ready ? 'green' : 'orange'}>
                  {template.ready ? '可使用' : template.buildStatus}
                </Tag>
                <span>{template.imageTag}</span>
              </Space>
              <Typography.Title level={2}>{template.displayName}</Typography.Title>
              <p>
                {template.templateKey === 'browser'
                  ? '浏览网页、提取资料、记录可核查的来源与页面截图。'
                  : '读取采集产物，完成素材编排、视频渲染与成片导出。'}
              </p>
              <Space wrap>
                {template.capabilities.map((capability) => (
                  <Tag key={capability}>{capability}</Tag>
                ))}
              </Space>
              <div className={styles.connection}>独立环境 · 私网 SSH · 用户隔离存储</div>
              <Checkbox
                checked={selected.includes(template.templateKey)}
                disabled={!template.ready}
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
            </Card>
          ))}
          {!templates.length && !loading && <Empty description="暂无已准入模板" />}
        </section>
      </Spin>
      <section className={styles.workflow}>
        <div className={styles.eyebrow}>COMPOSE / 多环境协作</div>
        <Typography.Title level={3}>采集素材 → 媒体制作 → 视频交付</Typography.Title>
        <p>每种用途拥有独立连接与租约，通过当前用户的授权产物协作；任务结束分别释放。</p>
        <Typography.Paragraph copyable={{ text: task }}>{task}</Typography.Paragraph>
        <Button
          type="primary"
          size="large"
          onClick={run}
          disabled={
            !selected.length ||
            selected.some((key) => !templates.find((template) => template.templateKey === key)?.ready)
          }
        >
          复制协作任务并打开聊天
        </Button>
      </section>
    </main>
  );
}
