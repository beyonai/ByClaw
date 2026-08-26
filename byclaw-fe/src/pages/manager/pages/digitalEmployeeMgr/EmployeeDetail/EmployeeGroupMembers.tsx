// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeleteOutlined } from '@ant-design/icons';
import { Button, Input, message, Modal, Popconfirm, Table, Tag, Tooltip, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import { queryEmployeeGroupMemberCandidates } from '@/pages/manager/service/DigitalEmployeeMgr';
import { getAvatarUrl, getDefaultAgentAvatar } from '@/pages/manager/utils/agent';
import styles from './EmployeeGroupMembers.module.less';

const getDigitalEmployeeAvatarUrl = (avatar) => getAvatarUrl(avatar || getDefaultAgentAvatar());

const getMemberRelationInfo = (item) => {
  const rawInfo = item?.relResourceInfo ?? item?.rel_resource_info;
  if (!rawInfo) return {};
  if (typeof rawInfo === 'object') return rawInfo;
  try {
    return JSON.parse(rawInfo);
  } catch (_) {
    return {};
  }
};

const normalizeMember = (item, index = 0) => {
  const relationInfo = getMemberRelationInfo(item);
  return {
    ...item,
    resourceId: `${item?.resourceId ?? item?.id ?? ''}`,
    name: item?.name || item?.resourceName || '',
    description: item?.description || item?.resourceDesc || '',
    avatar: item?.avatar || item?.chatAvatar || item?.resourceLogoUrl || item?.resource_logo_url || '',
    teamRole: item?.teamRole ?? item?.team_role ?? relationInfo?.teamRole ?? relationInfo?.team_role ?? '',
    sortOrder:
      Number(item?.sortOrder ?? item?.sort_order ?? relationInfo?.sortOrder ?? relationInfo?.sort_order) || index + 1,
  };
};

const unwrapCandidatePage = (response) => {
  if (response?.code !== undefined && Number(response.code) !== 0) {
    throw new Error(response?.msg || 'Failed to load digital employee candidates');
  }
  return response?.data || response || {};
};

const CANDIDATE_PAGE_SIZE = 30;
const CANDIDATE_CACHE_TTL = 60 * 1000;
const MAX_GROUP_MEMBER_COUNT = 20;

const mergeCandidates = (previous, next) => {
  const merged = new Map();
  [...previous, ...next].forEach((item) => {
    merged.set(`${item.resourceId}`, item);
  });
  return Array.from(merged.values());
};

const isCancelledRequest = (error) =>
  error?.name === 'CanceledError' || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';

export default function EmployeeGroupMembers({ value = [], onChange, disabled = false, agentTypeOptions = [] }) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [candidates, setCandidates] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const requestRef = useRef(null);
  const loadingRef = useRef(false);
  const candidateCacheRef = useRef(new Map());
  const candidateRegistryRef = useRef(new Map());
  const members = useMemo(() => value.map(normalizeMember), [value]);

  useEffect(() => {
    if (!open) return;
    requestRef.current?.abort();
    const cacheKey = `${pageNum}:${CANDIDATE_PAGE_SIZE}:${keyword}`;
    const cached = candidateCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CANDIDATE_CACHE_TTL) {
      setCandidates((previous) => {
        const nextCandidates = pageNum === 1 ? cached.list : mergeCandidates(previous, cached.list);
        setHasMore(cached.total > nextCandidates.length || cached.list.length === CANDIDATE_PAGE_SIZE);
        return nextCandidates;
      });
      setTotal(cached.total);
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    const requestController = new AbortController();
    requestRef.current = requestController;
    loadingRef.current = true;
    setLoading(true);
    queryEmployeeGroupMemberCandidates(
      {
        pageNum,
        pageSize: CANDIDATE_PAGE_SIZE,
        keyword,
        ownerType: 'enterprise',
        resourceStatus: 2,
      },
      requestController
    )
      .then((response) => {
        const page = unwrapCandidatePage(response);
        const source = page?.list?.length ? page.list : page?.rows || [];
        const list = source.map(normalizeMember);
        const pageTotal = Number(page?.total ?? list.length);
        list.forEach((item) => candidateRegistryRef.current.set(`${item.resourceId}`, item));
        candidateCacheRef.current.set(cacheKey, { list, total: pageTotal, cachedAt: Date.now() });
        setCandidates((previous) => {
          const nextCandidates = pageNum === 1 ? list : mergeCandidates(previous, list);
          setHasMore(pageTotal > nextCandidates.length || list.length === CANDIDATE_PAGE_SIZE);
          return nextCandidates;
        });
        setTotal(pageTotal);
      })
      .catch((error) => {
        if (isCancelledRequest(error)) return;
        if (pageNum === 1) {
          setCandidates([]);
          setHasMore(false);
        }
        message.error(error?.message || intl.formatMessage({ id: 'employeeDetail.groupMember.loadFailed' }));
      })
      .finally(() => {
        if (requestRef.current === requestController) {
          requestRef.current = null;
          loadingRef.current = false;
          setLoading(false);
        }
      });
    return () => {
      requestController.abort();
    };
  }, [intl, keyword, open, pageNum]);

  const loadMoreCandidates = useCallback(() => {
    if (!open || loadingRef.current || !hasMore) return;
    setPageNum((currentPage) => currentPage + 1);
  }, [hasMore, open]);

  useEffect(() => {
    if (!open) return undefined;

    let removeScrollListener;
    const timer = window.setTimeout(() => {
      const modal = document.querySelector(`.${styles.memberSelectorModal}`);
      const tableBody = modal?.querySelector('.ant-table-body, .beyond-table-body, [class*="table-body"]');
      if (!tableBody) return;

      const handleScroll = () => {
        if (tableBody.scrollHeight - tableBody.scrollTop - tableBody.clientHeight <= 80) {
          loadMoreCandidates();
        }
      };

      tableBody.addEventListener('scroll', handleScroll);
      removeScrollListener = () => tableBody.removeEventListener('scroll', handleScroll);
      if (tableBody.scrollHeight <= tableBody.clientHeight) {
        loadMoreCandidates();
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
      removeScrollListener?.();
    };
  }, [candidates.length, hasMore, loadMoreCandidates, loading, open]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const updateMembers = (next) => {
    onChange?.(next.map((item, index) => ({ ...item, sortOrder: index + 1 })));
  };

  const openSelector = () => {
    setKeyword('');
    setSearchValue('');
    setPageNum(1);
    setCandidates([]);
    setHasMore(false);
    setTotal(0);
    setSelectedKeys(members.map((item) => `${item.resourceId}`));
    members.forEach((item) => candidateRegistryRef.current.set(`${item.resourceId}`, item));
    setOpen(true);
  };

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleWrap}>
          <span className={styles.required}>*</span>
          <span className={styles.title}>{intl.formatMessage({ id: 'employeeDetail.groupMember.title' })}</span>
          <Typography.Text type="secondary" className={styles.hint}>
            {intl.formatMessage({ id: 'employeeDetail.groupMember.hint' })}
          </Typography.Text>
        </div>
        {!disabled && (
          <Button type="link" size="small" className={styles.selectButton} onClick={openSelector}>
            + {intl.formatMessage({ id: 'employeeDetail.groupMember.add' })}
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <div className={styles.empty}>{intl.formatMessage({ id: 'employeeDetail.groupMember.empty' })}</div>
      ) : (
        <div className={styles.memberList}>
          {members.map((member, index) => (
            <div key={member.resourceId} className={styles.memberRow}>
              <div className={styles.memberAvatar}>
                <img src={getDigitalEmployeeAvatarUrl(member.avatar)} alt={member.name} />
              </div>
              <div className={styles.memberInfo}>
                <Tooltip
                  placement="topLeft"
                  title={
                    <div>
                      <div>{member.name}</div>
                      {member.description && <div>{member.description}</div>}
                    </div>
                  }
                >
                  <Typography.Text className={styles.memberName} ellipsis>
                    {member.name}
                  </Typography.Text>
                </Tooltip>
                <Input
                  className={styles.roleInput}
                  maxLength={100}
                  size="small"
                  disabled={disabled}
                  placeholder={intl.formatMessage({ id: 'employeeDetail.groupMember.rolePlaceholder' })}
                  value={member.teamRole}
                  onChange={(event) => {
                    const next = [...members];
                    next[index] = { ...member, teamRole: event.target.value };
                    updateMembers(next);
                  }}
                />
              </div>
              {!disabled && (
                <div className={styles.actions}>
                  <Popconfirm
                    title={intl.formatMessage({ id: 'employeeDetail.groupMember.removeConfirm' })}
                    okText={intl.formatMessage({ id: 'common.confirm' })}
                    cancelText={intl.formatMessage({ id: 'common.cancel' })}
                    onConfirm={() => updateMembers(members.filter((_, memberIndex) => memberIndex !== index))}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        width={880}
        className={styles.memberSelectorModal}
        wrapClassName={styles.memberSelectorModalWrap}
        title={intl.formatMessage({ id: 'employeeDetail.groupMember.select' })}
        onCancel={() => setOpen(false)}
        onOk={() => {
          if (selectedKeys.length > MAX_GROUP_MEMBER_COUNT) {
            message.error(intl.formatMessage({ id: 'employeeDetail.groupMember.maxExceeded' }));
            return;
          }
          const existingMembers = new Map(members.map((member) => [`${member.resourceId}`, member]));
          const next = selectedKeys
            .map((key) => {
              const candidate = candidateRegistryRef.current.get(`${key}`);
              const existing = existingMembers.get(`${key}`);
              if (!candidate) return existing;
              // 候选列表没有团队角色；重新选择时必须保留已经配置的成员角色。
              return existing ? { ...candidate, teamRole: existing.teamRole } : candidate;
            })
            .filter(Boolean);
          updateMembers(next);
          setOpen(false);
        }}
      >
        <Input.Search
          allowClear
          value={searchValue}
          placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSearchValue(nextValue);
            if (!nextValue) {
              setPageNum(1);
              setKeyword('');
            }
          }}
          onSearch={(nextSearchValue) => {
            const normalizedKeyword = nextSearchValue.trim();
            setSearchValue(normalizedKeyword);
            setPageNum(1);
            setKeyword(normalizedKeyword);
          }}
          className={styles.search}
        />
        <Table
          rowKey={(record) => `${record.resourceId}`}
          loading={loading}
          pagination={false}
          tableLayout="fixed"
          scroll={{ y: 420 }}
          dataSource={candidates}
          onRow={(record) => ({
            onClick: (event) => {
              if (event.target?.closest?.('.ant-checkbox-wrapper, .ant-checkbox')) return;
              const key = `${record.resourceId}`;
              setSelectedKeys((previousKeys) => {
                if (previousKeys.includes(key)) {
                  return previousKeys.filter((item) => item !== key);
                }
                if (previousKeys.length >= MAX_GROUP_MEMBER_COUNT) {
                  message.error(intl.formatMessage({ id: 'employeeDetail.groupMember.maxExceeded' }));
                  return previousKeys;
                }
                return [...previousKeys, key];
              });
            },
          })}
          rowSelection={{
            preserveSelectedRowKeys: true,
            selectedRowKeys: selectedKeys,
            onChange: (nextKeys, _, info) => {
              if (info?.type === 'all') return;
              if (nextKeys.length > MAX_GROUP_MEMBER_COUNT) {
                message.error(intl.formatMessage({ id: 'employeeDetail.groupMember.maxExceeded' }));
                return;
              }
              setSelectedKeys(nextKeys);
            },
            onSelectAll: (checked, selectedRows) => {
              const currentCandidateKeys = new Set(candidates.map((item) => `${item.resourceId}`));
              if (checked && selectedKeys.length >= MAX_GROUP_MEMBER_COUNT) {
                setSelectedKeys([]);
                return;
              }
              if (!checked) {
                setSelectedKeys(selectedKeys.filter((key) => !currentCandidateKeys.has(`${key}`)));
                return;
              }

              const preservedKeys = selectedKeys.filter((key) => !currentCandidateKeys.has(`${key}`));
              const rowsToSelect = (selectedRows || candidates).filter(Boolean);
              const nextKeys = [...preservedKeys, ...rowsToSelect.map((row) => `${row.resourceId}`)];
              setSelectedKeys(nextKeys.slice(0, MAX_GROUP_MEMBER_COUNT));
            },
          }}
          locale={{ emptyText: intl.formatMessage({ id: 'employeeDetail.groupMember.candidateEmpty' }) }}
          columns={[
            {
              title: (
                <div className={styles.candidateTableHeader}>
                  <Tooltip
                    title={intl.formatMessage(
                      { id: 'employeeDetail.groupMember.selectAllTooltip' },
                      { selected: selectedKeys.length, max: MAX_GROUP_MEMBER_COUNT }
                    )}
                  >
                    <span>
                      {intl.formatMessage(
                        { id: 'employeeDetail.groupMember.selectAll' },
                        { selected: selectedKeys.length, max: MAX_GROUP_MEMBER_COUNT }
                      )}
                    </span>
                  </Tooltip>
                  <span className={styles.candidateTableCount}>
                    {intl.formatMessage(
                      { id: 'employeeDetail.groupMember.loadedCount' },
                      { loaded: candidates.length, total }
                    )}
                  </span>
                </div>
              ),
              dataIndex: 'name',
              width: '100%',
              render: (name, record) => {
                const typeLabel =
                  agentTypeOptions.find((item) => `${item?.value ?? ''}` === `${record?.agentType ?? ''}`)?.label ||
                  record?.agentType ||
                  '';
                return (
                  <div className={styles.candidateEmployeeCell}>
                    <span className={styles.candidateAvatar}>
                      <img src={getDigitalEmployeeAvatarUrl(record.avatar)} alt={name} />
                    </span>
                    <div className={styles.candidateEmployeeMain}>
                      <div className={styles.candidateEmployeeTitle} title={name}>
                        <span className={styles.candidateEmployeeName}>{name || '-'}</span>
                        {typeLabel && (
                          <Tag bordered={false} className={styles.candidateTypeTag}>
                            {typeLabel}
                          </Tag>
                        )}
                      </div>
                      <Tooltip title={record?.description || '-'} placement="topLeft">
                        <div className={styles.candidateDescription}>{record?.description || '-'}</div>
                      </Tooltip>
                    </div>
                  </div>
                );
              },
            },
          ]}
        />
      </Modal>
    </section>
  );
}
