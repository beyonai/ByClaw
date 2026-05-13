// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Table } from 'antd';
import { useIntl } from '@umijs/max';
import { queryResourcesByPage } from '@/pages/manager/service/DigitalEmployeeMgr';

const ToolSelectorModal = ({ open, onClose, onConfirm }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [list, setList] = useState([]);
  const [pagination, setPagination] = useState({
    pageNum: 1,
    pageSize: 5,
    total: 0,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [selectedMap, setSelectedMap] = useState({});

  const normalizeSkillType = useCallback((type) => {
    const typeMap = {
      DIG_EMPLOYEE: 'AGENT',
      KG_DOC: 'TOOLKIT',
      KG_QA: 'TOOLKIT',
    };
    return typeMap[type] || type;
  }, []);

  const toolTypeLabelMap = useMemo(
    () => ({
      AGENT: intl.formatMessage({ id: 'employeeDetail.skillType.agent' }),
      TOOLKIT: intl.formatMessage({ id: 'employeeDetail.skillType.toolkit' }),
      TOOL: intl.formatMessage({ id: 'employeeDetail.skillType.tool' }),
      MCP: 'MCP',
      VIEW: intl.formatMessage({ id: 'employeeDetail.view' }),
      OBJECT: intl.formatMessage({ id: 'employeeDetail.object' }),
    }),
    [intl]
  );

  const fetchList = useCallback(
    (pageNum = 1, pageSize = pagination.pageSize, keyword = searchName) => {
      setLoading(true);
      return queryResourcesByPage({
        resourceName: keyword || '',
        pageNum,
        pageSize,
      })
        .then((res) => {
          const { data } = res;
          const rows = data?.rows;
          const normalizedRows = rows.map((item) => ({
            ...item,
            id: item.resourceId || item.id,
            resourceId: item.resourceId || item.id,
            resourceName: item.resourceName || item.name || '-',
            description: item.resourceDesc || item.description || '',
            grantResourceType: normalizeSkillType(item.resourceBizType || item.grantResourceType),
          }));
          const total = Number(data?.total || 0) || (pageNum === 1 ? normalizedRows.length : 0);
          setList(normalizedRows);
          setPagination({
            pageNum: Number(data?.pageNum || pageNum),
            pageSize: Number(data?.pageSize || pageSize),
            total,
          });
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [pagination.pageSize, searchName, normalizeSkillType]
  );

  useEffect(() => {
    if (!open) return;
    fetchList(1, pagination.pageSize, searchName);
  }, [open]);

  const columns = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'thirdPartyCreateModel.name' }),
        dataIndex: 'resourceName',
        width: 260,
        render: (value) => value || '-',
      },
      {
        title: intl.formatMessage({ id: 'digitalEmployeeMgr.filter.type' }),
        dataIndex: 'grantResourceType',
        width: 120,
        render: (value) => toolTypeLabelMap[value] || value || '-',
      },
      {
        title: intl.formatMessage({ id: 'employeeDetail.description' }),
        dataIndex: 'description',
        ellipsis: true,
        render: (value) => value || '-',
      },
      {
        title: intl.formatMessage({ id: 'baseListModal.createTime' }),
        dataIndex: 'createTime',
        width: 180,
        render: (value) => value || '-',
      },
    ],
    [intl, toolTypeLabelMap]
  );

  const handleOk = useCallback(() => {
    const selectedRows = selectedRowKeys.map((key) => selectedMap[key]).filter(Boolean);
    if (!selectedRows.length) {
      onClose();
      return;
    }
    onConfirm(selectedRows);
    onClose();
  }, [selectedMap, selectedRowKeys, onConfirm, onClose]);

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'employeeDetail.toolSelector.title' })}
      width={980}
      onCancel={onClose}
      onOk={handleOk}
      okButtonProps={{ disabled: selectedRowKeys.length === 0 }}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Input
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          onPressEnter={() => fetchList(1, pagination.pageSize, searchName)}
          placeholder={intl.formatMessage({ id: 'employeeDetail.toolSelector.searchPlaceholder' })}
          allowClear
        />
        <Button type="primary" onClick={() => fetchList(1, pagination.pageSize, searchName)}>
          {intl.formatMessage({ id: 'common.search' })}
        </Button>
      </div>
      <Table
        rowKey={(record) => `${record.resourceId || record.id}`}
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{
          current: pagination.pageNum,
          pageSize: pagination.pageSize,
          total: pagination.total,
          onChange: (pageNum, pageSize) => {
            fetchList(pageNum, pageSize, searchName);
          },
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys, rows) => {
            const nextMap = { ...selectedMap };
            rows.forEach((row) => {
              nextMap[`${row.resourceId || row.id}`] = row;
            });
            Object.keys(nextMap).forEach((key) => {
              if (!keys.includes(key)) {
                delete nextMap[key];
              }
            });
            setSelectedMap(nextMap);
            setSelectedRowKeys(keys);
          },
        }}
      />
    </Modal>
  );
};

export default ToolSelectorModal;
