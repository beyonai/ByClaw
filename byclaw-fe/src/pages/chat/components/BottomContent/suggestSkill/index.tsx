import React, { useCallback, useEffect, useState } from 'react';
import { Button, Col, Empty, Popconfirm, Row, Spin, Typography, message } from 'antd';
import classNames from 'classnames';
import { EnterOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';
// @ts-ignore
import { useSelector, getLocale, useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { qryEmployeeDetail } from '@/service/agent';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { installDigitalEmployeeRelResources } from '@/pages/manager/service/DigitalEmployeeMgr';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import { getFileUrl } from '@/utils/file';

import styles from './index.module.less';

interface ISkillItem {
  grantType: string | null;
  operType: string | null;
  grantResourceType: 'SKILL';
  grantResourceId: number;
  createdBy: string | null;
  memberName: string | null;
  privilegeGrantId: string | null;
  grantToObjId: string | null;
  grantToObjType: string | null;
  grantToType: string | null;
  resourceId: string;
  resourceSourcePkId: string | null;
  systemCode: string;
  resourceLogoUrl?: string | null;
  resourceBizType: 'SKILL';
  resourceType: string;
  resourceName: string;
  resourceDesc: string;
  avatar: string | null;
  sample: string | null;
  tags: string | null;
  resourceVersionId: string;
  hostType: string;
  catalogId: string;
  catalogName: string | null;
  manOrgId: string;
  manUserId: string;
  manOrgName: string | null;
  indexList: unknown[] | null;
  createBy: string;
  createUserName: string;
  useCount: number;
  hasPermission: boolean;
  createTime: string;
  updateBy: string;
  updateTime: string;
  comAcctId: string;
  resourceStatus: number;
  resourceDVerid: string;
  resourceRVerid: string;
  resourceCode: string;
  publishTime: string;
  shelfTime: string | null;
  unshelfTime: string | null;
  authStatus: string;
  publishPortal: number;
  parentResourceId: string;
  publishType: string;
  ownerType: string;
  skillType: string;
  sourceType: string;
  version: string;
  skillUrl: string | null;
  skillPackageFormat: string;
  skillOriginalFilename: string | null;
  skillPackageSize: number | null;
  skillPackageHash: string | null;
  targetContent: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncTime: string;
  canEdit: boolean | null;
  canManageAuth: boolean | null;
  canUseAuth: boolean | null;
  canDelete: boolean | null;
  canApplyUse: boolean | null;
  canAuditUse: boolean | null;
}

type ISkill = {
  resourceId: number;
  skillCode: string;
  skillType: string;
  skillUrl: string;
  versionUrl: string;
};

const sortSkillsBySelected = (skills: ISkillItem[], selectedSkillIds: number[]) => {
  const selectedSkillSet = new Set(selectedSkillIds);

  return [...skills].sort((prev, next) => {
    const prevSelected = selectedSkillSet.has(prev.grantResourceId);
    const nextSelected = selectedSkillSet.has(next.grantResourceId);

    if (prevSelected === nextSelected) {
      return 0;
    }

    return prevSelected ? -1 : 1;
  });
};

export default function SuggestSkill({ agentId }: { agentId?: string }) {
  const [messageApi, contextHolder] = message.useMessage();

  const { EventEmitter, agentInfo } = useGlobal();
  const userInfo = useSelector(({ user }: { user: any }) => user.userInfo);

  const intl = useIntl();

  const [list, setList] = useState<ISkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [inited, setInited] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<number[]>([]);
  const [installingSkillId, setInstallingSkillId] = useState<number | null>(null);
  // 滚动容器 DOM 引用，用于监听滚动控制顶部渐变遮罩
  const scrollWrapRef = React.useRef<HTMLDivElement>(null);
  // 是否已向下滚动：滚动后顶部内容渐变淡出，滚到顶部时不遮挡首行
  const [scrolled, setScrolled] = useState(false);

  const isEN = getLocale().includes('en');

  const AbortControllerRef = React.useRef<AbortController>(null);

  // 按语言取描述，缺省时回退到另一语言
  const getDesc = useCallback((item: ISkillItem) => item.resourceDesc || '', [isEN]);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await listResourceUseAuth({
        resourceBizTypeList: ['SKILL'],
        pageNum: 1,
        pageSize: 9999,
      });
      // setList(res?.list || []);
      return res?.list || [];
    } catch (error) {
      console.error('获取推荐技能失败:', error);
      // setList([]);
      return [];
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
      try {
        const skills = JSON.parse(res?.skills || '[]').map((item: ISkill) => item.resourceId);
        // setSelectedSkills(skills);
        return skills;
      } catch (error) {
        console.error('获取数字员工详情失败:', error);
        // setSelectedSkills([]);
        return [];
      }
    });
  }, []);

  // 登录态变化时重新拉取
  useEffect(() => {
    setInited(false);
    setSelectedSkills([]);

    if (userInfo && agentId) {
      setLoading(true);
      Promise.all([fetchSkills(), getCurAgentInfo(agentId || '')])
        .then(([res1, res2]) => {
          setList(sortSkillsBySelected(res1, res2));
          setSelectedSkills(res2);
        })
        .finally(() => {
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

  const emitSkill = useCallback(
    (item: ISkillItem) => {
      EventEmitter.emit('queryInput-set-schema-imme', {
        mentionItem: {
          item: {
            chatAvatar: 'beyond/logout.png',
            resourceId: item.resourceCode,
            resourceName: item.resourceName,
            resourceBizType: ResourceType.SKILL,

            agentId: agentInfo?.agentId || '',
            agentName: agentInfo?.name || '',
            agentType: agentInfo?.agentType || '',

            field_id: item.resourceCode,
            field_name: item.resourceName,
          },
          type: ResourceType.agentTool,
        },
      });
    },
    [EventEmitter, agentInfo]
  );

  const onClickSkill = useCallback(
    (item: ISkillItem) => {
      if (item.grantResourceId && selectedSkills.includes(item.grantResourceId)) {
        emitSkill(item);
        return;
      }

      messageApi.destroy();
      messageApi.error('请先到数字员工管理页配置该技能');
    },
    [emitSkill, messageApi, selectedSkills]
  );

  const handleInstallSkill = useCallback(
    async (item: ISkillItem) => {
      if (!agentId || !item.resourceId || !item.grantResourceId) {
        messageApi.error(intl.formatMessage({ id: 'common.operationFailed' }));
        return;
      }

      try {
        setInstallingSkillId(item.grantResourceId);
        await installDigitalEmployeeRelResources({
          digitalEmployeeId: agentId,
          relIds: [`${item.resourceId}`],
        });

        messageApi.success(intl.formatMessage({ id: 'resource.installSuccess' }));
        const nextSelectedSkills = selectedSkills.includes(item.grantResourceId)
          ? selectedSkills
          : [...selectedSkills, item.grantResourceId];

        setSelectedSkills(nextSelectedSkills);
        setList((prevList) =>
          sortSkillsBySelected(
            prevList.map((skill) =>
              skill.grantResourceId === item.grantResourceId ? { ...skill, hasPermission: true } : skill
            ),
            nextSelectedSkills
          )
        );
        emitSkill({ ...item, hasPermission: true });
      } finally {
        setInstallingSkillId(null);
      }
    },
    [agentId, emitSkill, intl, messageApi, selectedSkills]
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

              const displayImage = item.resourceLogoUrl || item.avatar;
              const canClick = selectedSkills.includes(item.grantResourceId);
              const installing = installingSkillId === item.grantResourceId;

              const skillNode = (
                <div className={classNames(styles.skillItem)} onClick={canClick ? () => onClickSkill(item) : undefined}>
                  <span className={styles.iconBox}>
                    {displayImage ? (
                      <img
                        className={styles.avatar}
                        src={getFileUrl(displayImage)}
                        alt={`${item.resourceName || item.resourceCode}`}
                      />
                    ) : (
                      // <AntdIcon type="icon-chajiantubiao" className={styles.defaultHeaderIconIcon} />
                      <div className={styles.skillDefaultAvatar}>
                        <div className={styles.skillDefaultAvatarOrb} />
                        <span>{intl.formatMessage({ id: 'common.skill' })}</span>
                      </div>
                    )}
                  </span>
                  <div className={styles.content}>
                    {/* 标题行：技能名 + 同行的回填小图标按钮 */}
                    <div className={styles.titleRow}>
                      <span className={styles.title}>{item.resourceName || item.resourceCode}</span>
                      <Button
                        type="text"
                        size="small"
                        className={styles.action}
                        icon={canClick ? <EnterOutlined /> : <VerticalAlignBottomOutlined />}
                        loading={installing}
                        onClick={(e) => {
                          if (canClick) {
                            e.stopPropagation();
                            onClickSkill(item);
                          }
                        }}
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
              );

              return (
                <Col span={8} key={item.grantResourceId || item.resourceName}>
                  {canClick ? (
                    skillNode
                  ) : (
                    <Popconfirm
                      title={intl.formatMessage({ id: 'resource.installConfirm' })}
                      okText={intl.formatMessage({ id: 'common.confirm' })}
                      cancelText={intl.formatMessage({ id: 'common.cancel' })}
                      okButtonProps={{ loading: installing }}
                      disabled={installing}
                      onConfirm={(event) => {
                        event?.stopPropagation();
                        handleInstallSkill(item);
                      }}
                      onCancel={(event) => event?.stopPropagation()}
                    >
                      {skillNode}
                    </Popconfirm>
                  )}
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
