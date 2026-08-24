// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Input, message, Modal, Table, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import { queryEmployeeGroupMemberCandidates } from '@/pages/manager/service/DigitalEmployeeMgr';
import styles from './EmployeeGroupMembers.module.less';

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

const isCancelledRequest = (error) =>
  error?.name === 'CanceledError' || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';

export default function EmployeeGroupMembers({ value = [], onChange, disabled = false, agentTypeOptions = [] }) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [candidates, setCandidates] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const requestRef = useRef(null);
  const candidateCacheRef = useRef(new Map());
  const candidateRegistryRef = useRef(new Map());
  const members = useMemo(() => value.map(normalizeMember), [value]);

  useEffect(() => {
    if (!open) return;
    requestRef.current?.abort();
    const cacheKey = `${pageNum}:${CANDIDATE_PAGE_SIZE}:${keyword}`;
    const cached = candidateCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CANDIDATE_CACHE_TTL) {
      setCandidates(cached.list);
      setTotal(cached.total);
      setLoading(false);
      return;
    }

    const requestController = new AbortController();
    requestRef.current = requestController;
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
        setCandidates(list);
        setTotal(pageTotal);
      })
      .catch((error) => {
        if (isCancelledRequest(error)) return;
        setCandidates([]);
        setTotal(0);
        message.error(error?.message || intl.formatMessage({ id: 'employeeDetail.groupMember.loadFailed' }));
      })
      .finally(() => {
        if (requestRef.current === requestController) {
          requestRef.current = null;
          setLoading(false);
        }
      });
    return () => {
      requestController.abort();
    };
  }, [intl, keyword, open, pageNum]);

  const updateMembers = (next) => {
    onChange?.(next.map((item, index) => ({ ...item, sortOrder: index + 1 })));
  };

  const openSelector = () => {
    setKeyword('');
    setSearchValue('');
    setPageNum(1);
    setSelectedKeys(members.map((item) => `${item.resourceId}`));
    members.forEach((item) => candidateRegistryRef.current.set(`${item.resourceId}`, item));
    setOpen(true);
  };

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleWrap}>
          <span className={styles.required}>*</span>
          <Typography.Text className={styles.title}>
            {intl.formatMessage({ id: 'employeeDetail.groupMember.title' })}
          </Typography.Text>
          <Typography.Text type="secondary" className={styles.hint}>
            {intl.formatMessage({ id: 'employeeDetail.groupMember.hint' })}
          </Typography.Text>
        </div>
        {!disabled && (
          <Button type="link" icon={<PlusOutlined />} className={styles.selectButton} onClick={openSelector}>
            {intl.formatMessage({ id: 'employeeDetail.groupMember.select' })}
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <div className={styles.empty}>{intl.formatMessage({ id: 'employeeDetail.groupMember.empty' })}</div>
      ) : (
        <div className={styles.memberList}>
          {members.map((member, index) => (
            <div key={member.resourceId} className={styles.memberRow}>
              <div className={styles.memberInfo}>
                <Typography.Text strong ellipsis title={member.name}>
                  {member.name}
                </Typography.Text>
                <Typography.Text type="secondary" ellipsis title={member.description}>
                  {member.description || '-'}
                </Typography.Text>
              </div>
              <Input
                className={styles.roleInput}
                maxLength={100}
                disabled={disabled}
                placeholder={intl.formatMessage({ id: 'employeeDetail.groupMember.rolePlaceholder' })}
                value={member.teamRole}
                onChange={(event) => {
                  const next = [...members];
                  next[index] = { ...member, teamRole: event.target.value };
                  updateMembers(next);
                }}
              />
              {!disabled && (
                <div className={styles.actions}>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => updateMembers(members.filter((_, memberIndex) => memberIndex !== index))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        width={800}
        title={intl.formatMessage({ id: 'employeeDetail.groupMember.select' })}
        onCancel={() => setOpen(false)}
        onOk={() => {
          if (selectedKeys.length > 20) {
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
          pagination={{
            current: pageNum,
            pageSize: CANDIDATE_PAGE_SIZE,
            total,
            showSizeChanger: false,
          }}
          onChange={(nextPagination) => setPageNum(nextPagination.current || 1)}
          scroll={{ y: 420 }}
          dataSource={candidates}
          rowSelection={{
            preserveSelectedRowKeys: true,
            selectedRowKeys: selectedKeys,
            onChange: setSelectedKeys,
          }}
          locale={{ emptyText: intl.formatMessage({ id: 'employeeDetail.groupMember.candidateEmpty' }) }}
          columns={[
            { title: intl.formatMessage({ id: 'employeeDetail.groupMember.name' }), dataIndex: 'name', width: 180 },
            { title: intl.formatMessage({ id: 'employeeDetail.groupMember.description' }), dataIndex: 'description' },
            {
              title: intl.formatMessage({ id: 'employeeDetail.groupMember.type' }),
              dataIndex: 'agentType',
              width: 100,
              render: (agentType) =>
                agentTypeOptions.find((item) => `${item?.value ?? ''}` === `${agentType ?? ''}`)?.label ||
                agentType ||
                '-',
            },
          ]}
        />
      </Modal>
    </section>
  );
}
