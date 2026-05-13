// @ts-nocheck
import React from 'react';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

/**
 * 显示发布校验确认框
 * @param {Array} unpassedItems - compliance 为 false 的项
 * @returns {Promise<boolean>} 返回 Promise，resolve(true) 表示继续保存，resolve(false) 表示取消
 */
export function showPublishConfirm(unpassedItems, title) {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '校验提示',
      icon: null,
      width: 600,
      content: (
        <div>
          {/* 总结栏 */}
          <div
            style={{
              backgroundColor: '#FFFBE6',
              padding: '12px 16px',
              borderRadius: '4px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              color: '#FAAD14',
            }}
          >
            <ExclamationCircleOutlined style={{ color: '#FAAD14', fontSize: '20px', marginRight: '12px' }} />
            <div style={{ flex: 1 }}>
              <span>{`存在需要关注的风险项，是否仍要${title}？`}</span>
            </div>
          </div>

          {/* 需要调整项 */}
          {unpassedItems.length > 0 && (
            <div>
              {unpassedItems.map((item, index) => (
                <div key={index} style={{ marginBottom: '12px' }}>
                  <div style={{ marginBottom: '4px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: '#FFFBE6',
                        border: '1px solid #FFE58F',
                        fontSize: '12px',
                        color: '#D46B08',
                      }}
                    >
                      需要关注
                    </span>
                  </div>
                  <div style={{ color: '#333', fontSize: '14px', lineHeight: '1.6' }}>
                    {item.reason || '不符合规范'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
      okText: '继续' + title,
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
