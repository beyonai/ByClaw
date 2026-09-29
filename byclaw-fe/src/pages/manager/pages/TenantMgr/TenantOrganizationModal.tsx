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
      message.success(`已挂靠 ${result.attachedOrganizations} 个组织，新增 ${result.addedMembers} 名成员`);
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
      message.success(`已添加 ${selected.length} 名成员`);
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
      message.success('成员已加入租户');
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
      title={`添加成员 · ${tenant?.enterpriseName || ''}`}
      open={Boolean(tenant)}
      onCancel={onClose}
      footer={null}
      width={1040}
    >
      <Segmented
        value={mode}
        options={[
          { label: '按组织', value: 'org' },
          { label: '按成员', value: 'member' },
        ]}
        onChange={(value) => setMode(value as 'org' | 'member')}
        style={{ marginBottom: 16 }}
      />
      <Space align="start" style={{ width: '100%' }}>
        <div style={{ width: 300, height: 480, overflow: 'auto', borderRight: '1px solid #eee', paddingRight: 12 }}>
          <Input
            className={orgTreeStyles.search}
            placeholder="搜索组织"
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
                  {org?.attached && <Tag color="green">已挂靠</Tag>}
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
            <strong>{selectedOrg ? `${selectedOrg.orgName} · ${members.length} 名成员` : '请选择左侧组织'}</strong>
            <Checkbox checked={includeDescendants} onChange={(event) => setIncludeDescendants(event.target.checked)}>
              包含下级组织
            </Checkbox>
          </Space>
          {mode === 'member' && (
            <Input.Search
              placeholder="按用户编码或姓名筛选当前组织成员"
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
              { title: '用户编码', dataIndex: 'userCode' },
              { title: '用户名', dataIndex: 'userName' },
              {
                title: '租户状态',
                dataIndex: 'alreadyMember',
                render: (joined: boolean) => (joined ? <Tag color="green">已加入</Tag> : <Tag>未加入</Tag>),
              },
            ]}
          />
          {mode === 'org' ? (
            <Space style={{ marginTop: 12 }}>
              <Button disabled={!selectedOrgId} loading={submitting} onClick={() => void attach(false)}>
                仅挂靠组织
              </Button>
              <Button type="primary" disabled={!selectedOrgId} loading={submitting} onClick={() => void attach(true)}>
                挂靠组织并添加成员
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
                添加选中成员
              </Button>
              <Input
                placeholder="或输入已有用户账号"
                value={accountCode}
                onChange={(event) => setAccountCode(event.target.value)}
                style={{ width: 190 }}
              />
              <Button disabled={!accountCode.trim()} loading={submitting} onClick={() => void addByAccount()}>
                按账号添加
              </Button>
            </Space>
          )}
        </div>
      </Space>
    </Modal>
  );
}
