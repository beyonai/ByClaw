// @ts-nocheck
import React from 'react';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

/**
 * 显示合规校验确认框
 * @param {Array} allUnpassed - 所有不符合规范的项
 * @returns {Promise<boolean>} 返回 Promise，resolve(true) 表示继续执行，resolve(false) 表示返回调整
 */
export function showAuditConfirm(allUnpassed, flag) {
  return new Promise((resolve) => {
    // 根据 key 值分类不符合项
    const suggestedOptimizations = allUnpassed.filter(
      (item) => item.key === 'consistency_check' || item.key === 'name'
    );
    const coreCompetencies2 = allUnpassed.find((item) => item.key === 'coreCompetencies');
    const needsAdjustment = coreCompetencies2.subItems
      ? coreCompetencies2.subItems
        .filter((subItem) => subItem.compliance === false)
        .map((subItem) => ({
          key: subItem.key,
          compliance: subItem.compliance,
          reason: `${subItem.key}:${subItem.reason}`,
        }))
      : [];
    // 动态设置按钮文本和行为
    let okText = '返回调整';
    let cancelText = '继续保存';
    let cancelButtonProps = {};
    const title = '校验提示';
    let summaryMessage = '';
    let summaryCount = 0;

    if (needsAdjustment.length > 0) {
      // 如果存在"需要调整"的项，只显示"返回调整"按钮
      summaryMessage = '校验不通过，请返回调整。';
      cancelButtonProps = { style: { display: 'none' } };
    } else if (suggestedOptimizations.length > 0) {
      // 如果只存在"建议优化"的项，显示两个按钮
      summaryCount = suggestedOptimizations.length;
      summaryMessage = '可能会影响执行效果，是否仍要保存？';
      okText = '返回调整';
      cancelText = '继续保存';
    }
    if (flag) {
      okText = '关闭';
      cancelButtonProps = { style: { display: 'none' } };
    }

    Modal.confirm({
      title: title,
      icon: null,
      width: 600,
      content: (
        <div style={{ maxHeight: '550px', overflow: 'auto' }}>
          {/* 总结栏 */}
          {(suggestedOptimizations.length > 0 || needsAdjustment.length > 0) && (
            <div
              style={{
                backgroundColor: needsAdjustment.length > 0 ? '#FFF1F0' : '#FFFBE6',
                padding: '12px 16px',
                borderRadius: '4px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                color: needsAdjustment.length > 0 ? '#CF1322' : '#FAAD14',
              }}
            >
              <ExclamationCircleOutlined
                style={{
                  color: needsAdjustment.length > 0 ? '#CF1322' : '#FAAD14',
                  fontSize: '20px',
                  marginRight: '12px',
                }}
              />
              <div style={{ flex: 1 }}>
                {needsAdjustment.length > 0 ? (
                  <span>{summaryMessage}</span>
                ) : (
                  <span>
                    存在<span style={{ fontWeight: 'bold' }}>{summaryCount}</span>项建议优化，{summaryMessage}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 建议优化项 */}
          {suggestedOptimizations.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              {suggestedOptimizations.map((item, index) => (
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
                        marginBottom: '4px',
                      }}
                    >
                      建议优化
                    </span>
                  </div>
                  <div style={{ color: '#333', fontSize: '14px', lineHeight: '1.6' }}>
                    {item.reason || '不符合规范'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 需要调整项 */}
          {needsAdjustment.length > 0 && (
            <div>
              {needsAdjustment.map((item, index) => (
                <div key={index} style={{ marginBottom: '12px' }}>
                  <div style={{ marginBottom: '4px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: '#FFF1F0',
                        border: '1px solid #FFCCC7',
                        fontSize: '12px',
                        color: '#CF1322',
                      }}
                    >
                      需要调整
                    </span>
                  </div>
                  <div style={{ color: '#CF1322', fontSize: '14px', lineHeight: '1.6', marginLeft: '8px' }}>
                    {item.reason || '不符合规范'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
      okText: okText,
      cancelText: cancelText,
      cancelButtonProps: cancelButtonProps,
      onOk: () => resolve(false),
      onCancel: () => resolve(true),
    });
  });
}
