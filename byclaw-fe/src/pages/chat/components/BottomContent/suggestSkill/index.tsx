import React, { useCallback, useEffect, useState } from 'react';
import { Button, Col, Empty, Row, Spin, Typography, message } from 'antd';
import classNames from 'classnames';
import { EnterOutlined, StopOutlined } from '@ant-design/icons';
// @ts-ignore
import { useSelector, getLocale } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import { qryEmployeeDetail } from '@/service/agent';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';

import styles from './index.module.less';

interface ISkillItem {

  /** 技能编码，作为唯一标识 */
  skillCode: string;

  /** 技能名称 */
  skillName: string;

  /** 中文描述 */
  skillDescZh?: string;

  /** 英文描述 */
  skillDescEn?: string;
}

// paramValue 可能是 JSON 字符串或已解析的数组，统一解析为数组
function parseConfigList(value: any): ISkillItem[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SuggestSkill({ agentId }: { agentId: string }) {
  const [messageApi, contextHolder] = message.useMessage();

  const { EventEmitter, agentInfo } = useGlobal();
  const userInfo = useSelector(({ user }: { user: any }) => user.userInfo);

  const [list, setList] = useState<ISkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [inited, setInited] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  // 滚动容器 DOM 引用，用于监听滚动控制顶部渐变遮罩
  const scrollWrapRef = React.useRef<HTMLDivElement>(null);
  // 是否已向下滚动：滚动后顶部内容渐变淡出，滚到顶部时不遮挡首行
  const [scrolled, setScrolled] = useState(false);

  const isEN = getLocale().includes('en');

  const AbortControllerRef = React.useRef<AbortController>(null);

  // 按语言取描述，缺省时回退到另一语言
  const getDesc = useCallback(
    (item: ISkillItem) => (isEN ? item.skillDescEn || item.skillDescZh : item.skillDescZh || item.skillDescEn) || '',
    [isEN]
  );

  const fetchSkills = useCallback(async () => {
    try {
      const res: any = await getDcSystemConfig({ paramCode: 'OPENCLAW_BUNDLED_SKILLS' });
      setList(parseConfigList(res?.paramValue).filter((item) => item.skillCode || item.skillName));
    } catch (error) {
      console.error('获取推荐技能失败:', error);
      setList([]);
    }
  }, []);

  const getCurAgentInfo = useCallback(async (myAgentId: string) => {
    try {
      if (AbortControllerRef.current && !AbortControllerRef.current?.signal.aborted) {
        AbortControllerRef.current.abort('abort');
        AbortControllerRef.current = null;
      }
    } catch (e) {
      console.error(e);
    }

    AbortControllerRef.current = new AbortController();

    return qryEmployeeDetail(myAgentId, AbortControllerRef.current).then((res) => {
      setSelectedSkills(res?.relSkills || []);
    });
  }, []);

  // 登录态变化时重新拉取
  useEffect(() => {
    setInited(false);
    setSelectedSkills([]);

    if (userInfo) {
      setLoading(true);
      Promise.all([fetchSkills(), getCurAgentInfo(agentId)]).finally(() => {
        setLoading(false);
        setInited(true);
      });
    } else {
      setList([]);
      setInited(true);
    }
  }, [userInfo, agentId]);

  // 监听滚动容器，向下滚动一定距离后启用顶部渐变遮罩
  useEffect(() => {
    const el = scrollWrapRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      setScrolled(el.scrollTop > 4);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // list 变化时容器可能重建/内容变更，重新绑定并刷新一次状态
  }, [list.length, inited]);

  const onClickSkill = useCallback(
    (item: ISkillItem) => {
      console.log(item, selectedSkills);
      if (item.skillCode && selectedSkills.includes(item.skillCode)) {
        EventEmitter.emit('queryInput-set-schema-imme', {
          mentionItem: {
            item: {
              chatAvatar: 'beyond/logout.png',
              resourceId: item.skillCode,
              resourceName: item.skillName,
              resourceBizType: ResourceType.SKILL,

              agentId: agentInfo?.agentId || '',
              agentName: agentInfo?.name || '',
              agentType: agentInfo?.agentType || '',

              field_id: item.skillCode,
              field_name: item.skillName,
            },
            type: ResourceType.agentTool,
          },
        });
        return;
      }

      messageApi.destroy();
      messageApi.error('请先到数字员工管理页配置该技能');
    },
    [EventEmitter, messageApi, agentInfo, selectedSkills]
  );

  // 首屏加载中：用 Spin 占位
  if (!inited && loading) {
    return (
      <div className={styles.suggestSkill}>
        <div className={styles.loadingRow}>
          <Spin size="small" />
        </div>
      </div>
    );
  }

  // 空态
  if (inited && list.length === 0) {
    return (
      <div className={styles.suggestSkill}>
        <div className={styles.emptyWrap}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.suggestSkill}>
        <div ref={scrollWrapRef} className={classNames(styles.scrollWrap, { [styles.scrolled]: scrolled })}>
          {/* 用 antd Row/Col 做三列栅格，gutter 控制行列间距，避免宽度溢出 */}
          <Row gutter={[14, 14]} className={styles.grid}>
            {list.map((item) => {
              const desc = getDesc(item);

              const canClick = selectedSkills.includes(item.skillCode);

              return (
                <Col span={8} key={item.skillCode || item.skillName}>
                  <div
                    className={classNames(styles.skillItem, { [styles.disabled]: !canClick })}
                    onClick={() => onClickSkill(item)}
                  >
                    <span className={styles.iconBox}>
                      <AntdIcon type="icon-chajiantubiao" className={styles.defaultHeaderIconIcon} />
                    </span>
                    <div className={styles.content}>
                      {/* 标题行：技能名 + 同行的回填小图标按钮 */}
                      <div className={styles.titleRow}>
                        <span className={styles.title}>{item.skillName || item.skillCode}</span>
                        <Button
                          type="text"
                          size="small"
                          className={styles.action}
                          icon={canClick ? <EnterOutlined /> : <StopOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClickSkill(item);
                          }}
                          disabled={!canClick}
                        />
                      </div>
                      {/* 描述：长短不一，用 Typography 限制两行省略，省略时 hover 出完整内容 */}
                      <Typography.Paragraph
                        className={styles.desc}
                        ellipsis={{ rows: 2, tooltip: { title: desc, placement: 'topLeft' } }}
                        style={{ minHeight: 36 }}
                      >
                        {desc}
                      </Typography.Paragraph>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        </div>
      </div>
      {contextHolder}
    </>
  );
}
