import { useIntl } from '@umijs/max';
import { useEffect, useMemo, useState, type Key } from 'react';
import { Button, Checkbox, Input, Modal, Segmented, Space, Table, Tag, Tree, message } from 'antd';
import type { DataNode } from 'antd/es/tree';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import orgTreeStyles from '@/pages/manager/components/OrganizationTree/index.module.less';
import {
  addTenantMember,
  attachTenantOrganization,
  listTenantOrganizationMembers,
  listTenantOrganizations,
  type TenantItem,
  type TenantOrganization,
  type TenantOrganizationMember,
} from '../../service/TenantMgr';

interface Props {
  tenant: TenantItem | null;
  onClose: () => void;
}

function buildTree(organizations: TenantOrganization[]): DataNode[] {
  const nodes = new Map<string, DataNode & { children: DataNode[] }>();
  for (const org of organizations) {
    nodes.set(org.orgId, {
      key: org.orgId,
      title: org.orgName,
      children: [],
    });
  }
  const roots: DataNode[] = [];
  for (const org of organizations) {
    const node = nodes.get(org.orgId)!;
    const parent = nodes.get(org.parentOrgId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export default function TenantOrganizationModal({ tenant, onClose }: Props) {
  const intl = useIntl();
  const [organizations, setOrganizations] = useState<TenantOrganization[]>([]);
  const [members, setMembers] = useState<TenantOrganizationMember[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>();
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [search, setSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [mode, setMode] = useState<'org' | 'member'>('org');
  const [selectedMemberIds, setSelectedMemberIds] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const treeData = useMemo(() => buildTree(organizations), [organizations]);
  const selectedOrg = organizations.find((org) => org.orgId === selectedOrgId);
  const visibleMembers = members.filter((member) =>
    `${member.userCode} ${member.userName}`.toLowerCase().includes(memberSearch.trim().toLowerCase())
  );
  const memberRowSelection = {
    selectedRowKeys: selectedMemberIds,
    onChange: setSelectedMemberIds,
    getCheckboxProps: (member: TenantOrganizationMember) => ({ disabled: member.alreadyMember }),
  };

  useEffect(() => {
    if (!tenant) return;
    setSelectedOrgId(undefined);
    setMembers([]);
    setSelectedMemberIds([]);
    setMemberSearch('');
    setAccountCode('');
    setMode('org');
    setLoading(true);
    listTenantOrganizations(tenant.enterpriseId)
      .then((result) => {
        const next = Array.isArray(result) ? result : [];
        setOrganizations(next);
        setExpandedKeys(
          next.filter((org) => !next.some((candidate) => candidate.orgId === org.parentOrgId)).map((org) => org.orgId)
        );
        setSelectedOrgId(next[0]?.orgId);
      })
      .finally(() => setLoading(false));
  }, [tenant?.enterpriseId]);

  useEffect(() => {
    if (!tenant || !selectedOrgId) return;
    setSelectedMemberIds([]);
    setLoading(true);
    listTenantOrganizationMembers(tenant.enterpriseId, selectedOrgId, includeDescendants)
      .then((result) => setMembers(Array.isArray(result) ? result : []))
      .finally(() => setLoading(false));
  }, [tenant?.enterpriseId, selectedOrgId, includeDescendants]);

  const attach = async (addMembers: boolean) => {
    if (!tenant || !selectedOrgId) return;
    setSubmitting(true);
    try {
      const result = await attachTenantOrganization(tenant.enterpriseId, selectedOrgId, includeDescendants, addMembers);
      message.success(
        intl.formatMessage(
          { id: 'tenant.org.attachedResult' },
          { organizations: result.attachedOrganizations, members: result.addedMembers }
        )
      );
      const [nextOrganizations, nextMembers] = await Promise.all([
        listTenantOrganizations(tenant.enterpriseId),
        listTenantOrganizationMembers(tenant.enterpriseId, selectedOrgId, includeDescendants),
      ]);
      setOrganizations(nextOrganizations);
      setMembers(nextMembers);
    } finally {
      setSubmitting(false);
    }
  };

  const addSelected = async () => {
    if (!tenant || selectedMemberIds.length === 0) return;
    setSubmitting(true);
    try {
      const selected = members.filter((member) => selectedMemberIds.includes(member.userId) && !member.alreadyMember);
      for (const member of selected) await addTenantMember(tenant.enterpriseId, member.userCode);
      message.success(intl.formatMessage({ id: 'tenant.org.addedResult' }, { count: selected.length }));
      setMembers(await listTenantOrganizationMembers(tenant.enterpriseId, selectedOrgId!, includeDescendants));
      setSelectedMemberIds([]);
    } finally {
      setSubmitting(false);
    }
  };

  const addByAccount = async () => {
    if (!tenant || !accountCode.trim()) return;
    setSubmitting(true);
    try {
      await addTenantMember(tenant.enterpriseId, accountCode.trim());
      message.success(intl.formatMessage({ id: 'tenant.org.joinedSuccess' }));
      setAccountCode('');
      if (selectedOrgId) {
        setMembers(await listTenantOrganizationMembers(tenant.enterpriseId, selectedOrgId, includeDescendants));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage({ id: 'tenant.org.title' }, { name: tenant?.enterpriseName || '' })}
      open={Boolean(tenant)}
      onCancel={onClose}
      footer={null}
      width={1040}
    >
      <Segmented
        value={mode}
        options={[
          { label: intl.formatMessage({ id: 'tenant.org.byOrg' }), value: 'org' },
          { label: intl.formatMessage({ id: 'tenant.org.byMember' }), value: 'member' },
        ]}
        onChange={(value) => setMode(value as 'org' | 'member')}
        style={{ marginBottom: 16 }}
      />
      <Space align="start" style={{ width: '100%' }}>
        <div style={{ width: 300, height: 480, overflow: 'auto', borderRight: '1px solid #eee', paddingRight: 12 }}>
          <Input
            className={orgTreeStyles.search}
            placeholder={intl.formatMessage({ id: 'tenant.org.search' })}
            allowClear
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            suffix={<AntdIcon type="icon-a-Searchsousuo" />}
          />
          <Tree
            className={orgTreeStyles.tree}
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys)}
            switcherIcon={<AntdIcon type="icon-a-Down-onexia1" className={orgTreeStyles.switcherIcon} />}
            titleRender={(node) => {
              const active = String(node.key) === selectedOrgId;
              const org = organizations.find((item) => item.orgId === String(node.key));
              return (
                <div className={active ? orgTreeStyles.nodeActive : orgTreeStyles.node}>
                  <div className={orgTreeStyles.nodeMain}>
                    <AntdIcon type="icon-zuzhitubiao" className={orgTreeStyles.nodeIcon} />
                    <span className={active ? orgTreeStyles.nodeTextActive : orgTreeStyles.nodeText}>
                      {org?.orgName}
                    </span>
                  </div>
                  {org?.attached && <Tag color="green">{intl.formatMessage({ id: 'tenant.org.attached' })}</Tag>}
                </div>
              );
            }}
            selectedKeys={selectedOrgId ? [selectedOrgId] : []}
            onSelect={(keys) => setSelectedOrgId(keys[0] ? String(keys[0]) : undefined)}
            filterTreeNode={(node) =>
              Boolean(search && organizations.find((org) => org.orgId === node.key)?.orgName.includes(search))
            }
          />
        </div>
        <div style={{ width: 670 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong>
              {selectedOrg
                ? intl.formatMessage({ id: 'tenant.org.members' }, { name: selectedOrg.orgName, count: members.length })
                : intl.formatMessage({ id: 'tenant.org.select' })}
            </strong>
            <Checkbox checked={includeDescendants} onChange={(event) => setIncludeDescendants(event.target.checked)}>
              {intl.formatMessage({ id: 'tenant.org.includeDescendants' })}
            </Checkbox>
          </Space>
          {mode === 'member' && (
            <Input.Search
              placeholder={intl.formatMessage({ id: 'tenant.org.searchMembers' })}
              allowClear
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              style={{ marginBottom: 12, width: 320 }}
            />
          )}
          <Table<TenantOrganizationMember>
            size="small"
            rowKey="userId"
            loading={loading}
            dataSource={visibleMembers}
            rowSelection={mode === 'member' ? memberRowSelection : undefined}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: intl.formatMessage({ id: 'tenant.org.userCode' }), dataIndex: 'userCode' },
              { title: intl.formatMessage({ id: 'tenant.org.userName' }), dataIndex: 'userName' },
              {
                title: intl.formatMessage({ id: 'tenant.org.membership' }),
                dataIndex: 'alreadyMember',
                render: (joined: boolean) =>
                  joined ? (
                    <Tag color="green">{intl.formatMessage({ id: 'tenant.org.joined' })}</Tag>
                  ) : (
                    <Tag>{intl.formatMessage({ id: 'tenant.org.notJoined' })}</Tag>
                  ),
              },
            ]}
          />
          {mode === 'org' ? (
            <Space style={{ marginTop: 12 }}>
              <Button disabled={!selectedOrgId} loading={submitting} onClick={() => void attach(false)}>
                {intl.formatMessage({ id: 'tenant.org.attachOnly' })}
              </Button>
              <Button type="primary" disabled={!selectedOrgId} loading={submitting} onClick={() => void attach(true)}>
                {intl.formatMessage({ id: 'tenant.org.attachWithMembers' })}
              </Button>
            </Space>
          ) : (
            <Space style={{ marginTop: 12 }}>
              <Button
                type="primary"
                disabled={!selectedMemberIds.length}
                loading={submitting}
                onClick={() => void addSelected()}
              >
                {intl.formatMessage({ id: 'tenant.org.addSelected' })}
              </Button>
              <Input
                placeholder={intl.formatMessage({ id: 'tenant.org.existingAccount' })}
                value={accountCode}
                onChange={(event) => setAccountCode(event.target.value)}
                style={{ width: 190 }}
              />
              <Button disabled={!accountCode.trim()} loading={submitting} onClick={() => void addByAccount()}>
                {intl.formatMessage({ id: 'tenant.org.addAccount' })}
              </Button>
            </Space>
          )}
        </div>
      </Space>
    </Modal>
  );
}
