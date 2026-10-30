import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, Modal, Select, Spin, Tag, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useIntl } from '@umijs/max';
import {
  getAdministratorCandidates,
  getAdministratorOrganizations,
  type AdministratorContext,
  type AdministratorOrganization,
  type OrganizationMember,
} from '@/service/orgMgr';
import styles from './index.module.less';

type Props = AdministratorContext & {
  id?: string;
  value?: (string | number)[];
  onChange?: (ids: string[]) => void;
  initialMembers: OrganizationMember[];
  disabled?: boolean;
};

const AdministratorPicker = ({ id, value = [], onChange, initialMembers, disabled, orgId, parentOrgId }: Props) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<AdministratorOrganization[]>([]);
  const [memberOrgId, setMemberOrgId] = useState<string>();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [known, setKnown] = useState<Record<string, OrganizationMember>>({});
  const [keyword, setKeyword] = useState('');
  const [treeLoading, setTreeLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [membersError, setMembersError] = useState('');
  const [retry, setRetry] = useState(0);
  const text = (id: string) => intl.formatMessage({ id });
  const errorText = (error: unknown) =>
    (typeof error === 'string' ? error : error instanceof Error ? error.message : '') ||
    text('orgMgr.administrators.loadFailed');

  useEffect(() => {
    setKnown((previous) => ({
      ...previous,
      ...Object.fromEntries(initialMembers.map((member) => [member.userId, member])),
    }));
  }, [initialMembers]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setTreeLoading(true);
    setTreeError('');
    setMembersError('');
    setMembersLoading(false);
    setOrganizations([]);
    setMemberOrgId(undefined);
    setMembers([]);
    getAdministratorOrganizations({ orgId, parentOrgId })
      .then((rows) => {
        if (!active) return;
        if (!Array.isArray(rows)) throw new Error(text('orgMgr.administrators.loadFailed'));
        setOrganizations(rows);
        const preferred = orgId ?? parentOrgId;
        setMemberOrgId(
          String(rows.find((row) => String(row.orgId) === String(preferred))?.orgId ?? rows[0]?.orgId ?? '')
        );
      })
      .catch((error) => {
        if (active) setTreeError(errorText(error));
      })
      .finally(() => {
        if (active) setTreeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, orgId, parentOrgId, retry]);

  useEffect(() => {
    if (!open || !memberOrgId) return undefined;
    let active = true;
    setMembersLoading(true);
    setMembersError('');
    setMembers([]);
    setKeyword('');
    getAdministratorCandidates({ orgId, parentOrgId }, memberOrgId)
      .then((rows) => {
        if (!active) return;
        if (!Array.isArray(rows)) throw new Error(text('orgMgr.administrators.loadFailed'));
        setMembers(rows);
        setKnown((previous) => ({ ...previous, ...Object.fromEntries(rows.map((member) => [member.userId, member])) }));
      })
      .catch((error) => {
        if (active) setMembersError(errorText(error));
      })
      .finally(() => {
        if (active) setMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, memberOrgId, orgId, parentOrgId, retry]);

  const nodes = useMemo(() => {
    const map = new Map<string, DataNode>();
    organizations.forEach((organization) => {
      map.set(String(organization.orgId), {
        key: String(organization.orgId),
        title: organization.orgName,
        children: [],
      });
    });
    const roots: DataNode[] = [];
    organizations.forEach((organization) => {
      const node = map.get(String(organization.orgId))!;
      const parent = map.get(String(organization.parentOrgId));
      if (parent) parent.children!.push(node);
      else roots.push(node);
    });
    return roots;
  }, [organizations]);
  const filteredMembers = members.filter((member) =>
    `${member.userName} ${member.userId}`.toLowerCase().includes(keyword.trim().toLowerCase())
  );
  const toggle = (id: string, checked: boolean) => {
    setDraft((previous) => (checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id)));
  };

  return (
    <>
      <Select
        id={id}
        mode="multiple"
        open={false}
        showSearch={false}
        disabled={disabled}
        value={value.map(String)}
        options={Object.values(known).map((member) => ({ value: member.userId, label: member.userName }))}
        placeholder={text('orgMgr.administrators.select')}
        onChange={(ids) => onChange?.(ids)}
        onOpenChange={(visible) => {
          if (visible && !disabled) {
            setDraft(value.map(String));
            setOpen(true);
          }
        }}
      />
      <Modal
        title={text('orgMgr.administrators.select')}
        open={open}
        width={800}
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: treeLoading || membersLoading || !!treeError || !!membersError }}
        onOk={() => {
          if (treeLoading || membersLoading || treeError || membersError) return;
          onChange?.(draft);
          setOpen(false);
        }}
        destroyOnHidden
      >
        {(treeError || membersError) && (
          <Alert
            type="error"
            showIcon
            message={treeError || membersError}
            action={
              <Button onClick={() => setRetry((previous) => previous + 1)}>
                {text('orgMgr.administrators.retry')}
              </Button>
            }
          />
        )}
        <div className={styles.layout}>
          <div className={styles.organizations}>
            <Spin spinning={treeLoading}>
              <Tree
                key={organizations.map((organization) => organization.orgId).join(',')}
                treeData={nodes}
                defaultExpandAll
                selectedKeys={memberOrgId ? [memberOrgId] : []}
                onSelect={(keys) => {
                  if (keys.length) setMemberOrgId(String(keys[0]));
                }}
              />
            </Spin>
          </div>
          <div className={styles.members}>
            <Input.Search
              placeholder={text('orgMgr.administrators.search')}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              allowClear
            />
            <div className={styles.hint}>{text('orgMgr.administrators.directMembers')}</div>
            <Spin spinning={membersLoading || treeLoading}>
              <div className={styles.memberList}>
                {!membersLoading && !treeLoading && !filteredMembers.length && (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
                {filteredMembers.map((member) => (
                  <Checkbox
                    key={member.userId}
                    checked={draft.includes(member.userId)}
                    onChange={(event) => toggle(member.userId, event.target.checked)}
                  >
                    {member.userName}
                  </Checkbox>
                ))}
              </div>
            </Spin>
          </div>
        </div>
        <div className={styles.selected}>
          {intl.formatMessage({ id: 'orgMgr.administrators.selected' }, { count: draft.length })}
          {draft.map((id) => (
            <Tag key={id} closable onClose={() => toggle(id, false)}>
              {known[id]?.userName || id}
            </Tag>
          ))}
        </div>
      </Modal>
    </>
  );
};

export default AdministratorPicker;
