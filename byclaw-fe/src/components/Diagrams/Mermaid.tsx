import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Segmented, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { copyWithMessage } from '@/utils/copy';
import { renderMermaid } from './renderMermaid';
import styles from './Mermaid.module.less';

export default function Mermaid({ source, complete = true }: { source: string; complete?: boolean }) {
  const intl = useIntl();
  const [view, setView] = useState('preview');
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<{ source: string; svg?: string; failed?: boolean }>();
  const current = result?.source === source ? result : undefined;

  useEffect(() => {
    let active = true;
    setResult(undefined);
    setExpanded(false);
    if (complete) {
      // 等待一个完整代码块，避免对每个流式 token 进行解析和绘图。
      void renderMermaid(source)
        .then(({ svg }) => {
          if (active) setResult({ source, svg });
        })
        .catch(() => {
          if (active) setResult({ source, failed: true });
        });
    }
    return () => {
      active = false;
    };
  }, [source, complete]);

  const showSource = view === 'source' || !complete || current?.failed;
  return (
    <section className={styles.diagram} aria-label="Mermaid">
      <div className={styles.toolbar}>
        <Segmented
          value={view}
          onChange={(value) => setView(String(value))}
          options={[
            { value: 'preview', label: intl.formatMessage({ id: 'common.preview' }) },
            { value: 'source', label: intl.formatMessage({ id: 'preview.source' }) },
          ]}
        />
        <Button size="small" onClick={() => copyWithMessage(source)}>
          {intl.formatMessage({ id: 'common.copy' })}
        </Button>
        {current?.svg && (
          <Button size="small" onClick={() => setExpanded(true)}>
            {intl.formatMessage({ id: 'preview.expand' })}
          </Button>
        )}
      </div>
      {current?.failed && (
        <Alert type="warning" showIcon message={intl.formatMessage({ id: 'preview.mermaidFailed' })} />
      )}
      {showSource ? (
        <pre className={styles.source}>
          <code>{source}</code>
        </pre>
      ) : (
        <Spin spinning={!current?.svg}>
          <div className={styles.canvas} dangerouslySetInnerHTML={{ __html: expanded ? '' : current?.svg || '' }} />
        </Spin>
      )}
      <Modal
        open={expanded}
        onCancel={() => setExpanded(false)}
        footer={null}
        width="90vw"
        title="Mermaid"
        destroyOnHidden
      >
        <div className={styles.expanded} dangerouslySetInnerHTML={{ __html: expanded ? current?.svg || '' : '' }} />
      </Modal>
    </section>
  );
}
