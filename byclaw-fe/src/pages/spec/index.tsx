import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Anchor, Button, Card, Tag, Tooltip, message } from 'antd';
import { CheckOutlined, CloudDownloadOutlined, CopyOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { getRuntimeActualUrl } from '@/utils';
import { copyTextToClipboard } from '@/utils/copy';
import {
  E2E_DEMO_DIR,
  E2E_DEMOS,
  E2E_RESULT_DIR_TREE,
  E2E_SCRIPT_SKELETON,
  E2E_SPEC_SECTIONS,
  E2E_STATUS_ENUM,
  E2E_STATUS_JSON,
  E2E_SUITE_CONTRACT,
  type E2eDemoKind,
} from './contracts';
import styles from './index.module.less';

/** 三方职责:规范最大的认知负担是「我是哪类人、该读哪份」,先用一张图分流。 */
const ROLE_KEYS = ['platform', 'orchestrator', 'suite'] as const;

/** 每个角色卡点击后跳到自己那一节;平台一列不对应章节,跳职责总览。 */
const ROLE_TARGET: Record<(typeof ROLE_KEYS)[number], string> = {
  platform: E2E_SPEC_SECTIONS.roles,
  orchestrator: E2E_SPEC_SECTIONS.orchestrator,
  suite: E2E_SPEC_SECTIONS.suite,
};

/** 章节标题距容器顶部的留白,Anchor 定位与 scroll-margin-top 用同一个值,避免标题贴边。 */
const SCROLL_OFFSET = 24;

const SpecPage: React.FC = () => {
  const intl = useIntl();
  // 复制成功后短暂回显对勾,避免用户不确定有没有复制上。
  const [copiedKey, setCopiedKey] = useState<string>('');
  // 滚动发生在本页容器上而非 window。Anchor 必须拿到它才能定位,
  // 否则默认去滚 window —— 在 overflow 容器里毫无效果(点了没反应的原因)。
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToSection = (section: string) => {
    const container = scrollRef.current;
    const target = document.getElementById(section);
    if (!container || !target) return;
    // 用相对位移而不是 scrollIntoView:后者会连带滚动外层祖先,容器内定位不准。
    container.scrollTo({
      top: target.offsetTop - container.offsetTop - SCROLL_OFFSET,
      behavior: 'smooth',
    });
  };

  const t = (id: string, values?: Record<string, any>) =>
    intl.formatMessage({ id: `spec.integrationTest.${id}` }, values);

  const handleCopy = (key: string, text: string) => {
    copyTextToClipboard(
      text,
      () => {
        setCopiedKey(key);
        message.success(intl.formatMessage({ id: 'common.copySuccess' }));
        // 对勾只是短暂反馈,超时回落到复制图标;用 prev 判断避免覆盖后续复制。
        window.setTimeout(() => setCopiedKey((prev) => (prev === key ? '' : prev)), 2000);
      },
      () => message.error(intl.formatMessage({ id: 'common.copyFail' }))
    );
  };

  const handleDownload = (fileName: string) => {
    const link = document.createElement('a');
    link.href = getRuntimeActualUrl(`${E2E_DEMO_DIR}/${fileName}`);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 弹框深链(/spec/integrationTest#suite)进来时,浏览器原生 hash 定位同样滚不动
  // 这个容器,必须自己滚一次,否则深链只会停在页首 —— 整个「跳到我那一节」的设计靠它。
  useEffect(() => {
    const section = window.location.hash.replace('#', '');
    if (!section) return;
    // 等一帧,确保代码块/卡片布好版后 offsetTop 才是最终值。
    const raf = window.requestAnimationFrame(() => scrollToSection(section));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const anchorItems = useMemo(
    () =>
      [
        E2E_SPEC_SECTIONS.roles,
        E2E_SPEC_SECTIONS.demo,
        E2E_SPEC_SECTIONS.suite,
        E2E_SPEC_SECTIONS.orchestrator,
      ].map((key) => ({ key, href: `#${key}`, title: t(`anchor.${key}`) })),
    [intl]
  );

  /** 代码块 + 右上角复制:契约内容都是要粘到工程里去的,复制按钮是刚需。 */
  const renderCode = (copyKey: string, code: string) => (
    <div className={styles.codeBlock}>
      <Tooltip title={copiedKey === copyKey ? t('copied') : t('copy')}>
        <Button
          size="small"
          type="text"
          className={styles.codeCopy}
          icon={copiedKey === copyKey ? <CheckOutlined /> : <CopyOutlined />}
          onClick={() => handleCopy(copyKey, code)}
        />
      </Tooltip>
      <pre>{code}</pre>
    </div>
  );

  const renderSectionTitle = (id: string, index: string) => (
    <h2 className={styles.sectionTitle} id={id}>
      <span className={styles.sectionIndex}>{index}</span>
      {t(`section.${id}`)}
    </h2>
  );

  return (
    <div className={styles.specPage} ref={scrollRef}>
      <div className={styles.main}>
        <header className={styles.pageHeader}>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </header>

        {/* ① 三方职责边界:点某一列直接跳到对应章节。 */}
        {renderSectionTitle(E2E_SPEC_SECTIONS.roles, '①')}
        <p className={styles.sectionIntro}>{t('roles.intro')}</p>
        <div className={styles.roleGrid}>
          {ROLE_KEYS.map((role) => (
            <a
              key={role}
              href={`#${ROLE_TARGET[role]}`}
              className={styles.roleCard}
              onClick={(e) => {
                e.preventDefault();
                scrollToSection(ROLE_TARGET[role]);
              }}
            >
              <div className={styles.roleHead}>
                <strong>{t(`roles.${role}.name`)}</strong>
                <span>{t(`roles.${role}.who`)}</span>
              </div>
              <ul>
                {['d1', 'd2', 'd3'].map((duty) => (
                  <li key={duty}>{t(`roles.${role}.${duty}`)}</li>
                ))}
              </ul>
              <div className={styles.roleFoot}>{t(`roles.${role}.action`)}</div>
            </a>
          ))}
        </div>

        {/* ② demo 工程:读懂契约 ≠ 写对,给能跑的参考实现比给文字有效。 */}
        {renderSectionTitle(E2E_SPEC_SECTIONS.demo, '②')}
        <p className={styles.sectionIntro}>{t('demo.intro')}</p>
        <div className={styles.demoGrid}>
          {E2E_DEMOS.map(({ kind, fileName }: { kind: E2eDemoKind; fileName: string }) => (
            <Card key={kind} className={styles.demoCard} size="small">
              <div className={styles.demoBody}>
                <strong>{t(`demo.${kind}.title`)}</strong>
                <p>{t(`demo.${kind}.desc`)}</p>
                <code className={styles.demoRun}>{t(`demo.${kind}.run`)}</code>
              </div>
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => handleDownload(fileName)}>
                {t('demo.download')}
              </Button>
            </Card>
          ))}
        </div>
        <p className={styles.demoTip}>{t('demo.tip')}</p>

        {/* ③ 用例集作者:只需产 JUnit + 退出码 + 失败证据,不碰整轮状态机。 */}
        {renderSectionTitle(E2E_SPEC_SECTIONS.suite, '③')}
        <p className={styles.sectionIntro}>{t('suite.intro')}</p>
        {renderCode('suite', E2E_SUITE_CONTRACT)}

        {/* ④ 编排层:目录 + status.json 契约 + 状态枚举 + 脚本骨架。 */}
        {renderSectionTitle(E2E_SPEC_SECTIONS.orchestrator, '④')}
        <p className={styles.sectionIntro}>{t('orchestrator.intro')}</p>

        <h3 className={styles.subTitle}>{t('orchestrator.treeTitle')}</h3>
        {renderCode('tree', E2E_RESULT_DIR_TREE)}

        <h3 className={styles.subTitle}>{t('orchestrator.statusTitle')}</h3>
        {renderCode('status', E2E_STATUS_JSON)}

        <h3 className={styles.subTitle}>{t('orchestrator.enumTitle')}</h3>
        <div className={styles.enumList}>
          {E2E_STATUS_ENUM.map((item) => (
            <div className={styles.enumRow} key={item.code}>
              <Tag className={styles.enumCode}>{item.code}</Tag>
              <span>{item.meaning}</span>
            </div>
          ))}
        </div>

        <h3 className={styles.subTitle}>{t('orchestrator.scriptTitle')}</h3>
        {renderCode('script', E2E_SCRIPT_SKELETON)}
      </div>

      {/* 长页必备:右侧锚点导航。
          affix 关掉改用 CSS sticky:affix 按 window 滚动算位置,本页滚动在容器里,
          用 affix 会让导航停在错误位置。getContainer/targetOffset 交出真实滚动容器。 */}
      <Anchor
        className={styles.anchor}
        affix={false}
        items={anchorItems}
        getContainer={() => scrollRef.current || window}
        targetOffset={SCROLL_OFFSET}
        onClick={(e, link) => {
          // 接管跳转:默认行为会改 URL hash 并让浏览器滚 window,容器里不生效。
          e.preventDefault();
          scrollToSection(String(link.href).replace('#', ''));
        }}
      />
    </div>
  );
};

export default SpecPage;
