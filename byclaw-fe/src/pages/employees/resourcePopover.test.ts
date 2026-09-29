import fs from 'fs';
import path from 'path';

describe('employee detail resource popover wiring', () => {
  it('passes the upward placement from the detail page to the plus menu', () => {
    const page = fs.readFileSync(path.resolve(__dirname, './index.tsx'), 'utf8');
    const input = fs.readFileSync(path.resolve(__dirname, '../../components/QueryInput/queryInputBase.tsx'), 'utf8');

    // 详情态的 isBottom 为 false，必须保留页面配置到加号弹层的传递链路。
    expect(page).toMatch(/queryInputProps=\{\{[\s\S]*?mentionPopoverPlacement:\s*'topLeft'/);
    expect(input).toMatch(/getResourcePopoverAdapter\(\{[^}]*placement:\s*this\.props\.mentionPopoverPlacement/);
  });
});
