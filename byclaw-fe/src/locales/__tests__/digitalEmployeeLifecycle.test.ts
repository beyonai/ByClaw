import enUS from '../en-US';
import enUSManager from '../en-US/manager';
import zhCN from '../zh-CN';
import zhCNManager from '../zh-CN/manager';

describe('digital employee lifecycle messages', () => {
  // 主语言包和管理模块保持一致，避免菜单与二次确认恢复为通用数据文案。
  it.each([
    ['resource.shelfData', '上架员工', 'Publish employee'],
    ['resource.unShelfData', '下架员工', 'Unpublish employee'],
    ['resource.deleteData', '注销员工', 'Deregister employee'],
    ['resource.shelfDataConfirm', '确定要上架该员工吗？', 'Are you sure you want to publish this employee?'],
    ['resource.unShelfDataConfirm', '确定要下架该员工吗？', 'Are you sure you want to unpublish this employee?'],
    ['resource.deleteDataConfirm', '确定注销该员工吗？', 'Deregister this employee?'],
  ])('uses employee wording for %s', (id, chinese, english) => {
    expect(zhCN[id as keyof typeof zhCN]).toBe(chinese);
    expect(zhCNManager[id as keyof typeof zhCNManager]).toBe(chinese);
    expect(enUS[id as keyof typeof enUS]).toBe(english);
    expect(enUSManager[id as keyof typeof enUSManager]).toBe(english);
  });
});
