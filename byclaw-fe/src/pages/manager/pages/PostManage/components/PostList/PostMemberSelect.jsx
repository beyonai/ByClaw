import { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import { Input, message, Modal, Table } from 'antd';
import { uniqBy } from 'lodash';
import { getUsersByOrgId } from '@/pages/manager/service/OrgCenter';

const PostMemberSelect = ({ saving, onCancel, onOk }) => {
  const intl = useIntl();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({ keyword: '', pageNum: 1, pageSize: 10 });
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getUsersByOrgId(query)
      .then((response) => {
        if (cancelled) return;
        const result = response?.data || response || {};
        setData({ rows: uniqBy(result.rows || result.list || [], 'userId'), total: result.total || 0 });
      })
      .catch((error) => {
        if (cancelled) return;
        setData({ rows: [], total: 0 });
        message.error(error?.msg || error?.message || intl.formatMessage({ id: 'postList.loadUsersFailed' }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, intl]);

  return (
    <Modal
      open
      title={intl.formatMessage({ id: 'postList.batchAdd' })}
      width={760}
      confirmLoading={saving}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      okButtonProps={{ disabled: !selectedUserIds.length || loading }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      onCancel={onCancel}
      onOk={() => onOk(selectedUserIds).catch(() => {})}
    >
      <Input.Search
        allowClear
        disabled={saving}
        placeholder={intl.formatMessage({ id: 'postList.addSearchPlaceholder' })}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onSearch={(keyword) => setQuery((previous) => ({ ...previous, keyword: keyword.trim(), pageNum: 1 }))}
        style={{ marginBottom: 16 }}
      />
      <Table
        rowKey="userId"
        size="small"
        loading={loading}
        dataSource={data.rows}
        columns={[
          { title: intl.formatMessage({ id: 'postList.userName' }), dataIndex: 'userName' },
          { title: intl.formatMessage({ id: 'postList.userCode' }), dataIndex: 'userCode' },
          { title: intl.formatMessage({ id: 'postList.department' }), dataIndex: 'orgName' },
        ]}
        rowSelection={{
          selectedRowKeys: selectedUserIds,
          preserveSelectedRowKeys: true,
          onChange: setSelectedUserIds,
          getCheckboxProps: () => ({ disabled: saving }),
        }}
        pagination={{
          current: query.pageNum,
          pageSize: query.pageSize,
          total: data.total,
          showSizeChanger: true,
          onChange: (pageNum, pageSize) => setQuery((previous) => ({ ...previous, pageNum, pageSize })),
        }}
      />
      {intl.formatMessage({ id: 'postList.selectedCount' }, { count: selectedUserIds.length })}
    </Modal>
  );
};

export default PostMemberSelect;
