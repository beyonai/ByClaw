import enUS from '../en-US';
import enUSManager from '../en-US/manager';
import zhCN from '../zh-CN';
import zhCNManager from '../zh-CN/manager';
import enUSModels from '../../pages/models/locales/en-US';
import zhCNModels from '../../pages/models/locales/zh-CN';

describe('resource delete messages', () => {
  // 两份语言配置均需同步，菜单和确认提示使用对应模块名称。
  it.each([
    ['resource.deleteKnowledge', '删除知识', 'Delete knowledge'],
    ['resource.deleteKnowledgeConfirm', '确定删除该知识吗？', 'Are you sure you want to delete this knowledge?'],
    ['resource.deleteSkill', '删除技能', 'Delete skill'],
    ['resource.deleteSkillConfirm', '确定删除该技能吗？', 'Are you sure you want to delete this skill?'],
    ['resource.deleteTool', '删除工具', 'Delete tool'],
    ['resource.deleteToolConfirm', '确定删除该工具吗？', 'Are you sure you want to delete this tool?'],
  ])('defines module wording for %s', (id, chinese, english) => {
    expect(zhCN[id as keyof typeof zhCN]).toBe(chinese);
    expect(zhCNManager[id as keyof typeof zhCNManager]).toBe(chinese);
    expect(enUS[id as keyof typeof enUS]).toBe(english);
    expect(enUSManager[id as keyof typeof enUSManager]).toBe(english);
  });

  it('names the model in its delete action', () => {
    expect(zhCNModels['personalModel.delete']).toBe('删除模型');
    expect(enUSModels['personalModel.delete']).toBe('Delete model');
  });
});
