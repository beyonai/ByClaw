import fs from 'fs';
import path from 'path';

describe('prompt tabs layout', () => {
  const configFormSource = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');

  it('renders tab headers separately and selects one editor by active key', () => {
    const promptItemsStart = configFormSource.indexOf('const promptTabItems = useMemo');
    const activePromptStart = configFormSource.indexOf('const activePromptTab = useMemo', promptItemsStart);
    const promptItemsEnd = configFormSource.indexOf('const handleTagAdd', activePromptStart);

    expect(promptItemsStart).toBeGreaterThanOrEqual(0);
    expect(activePromptStart).toBeGreaterThan(promptItemsStart);
    expect(promptItemsEnd).toBeGreaterThan(promptItemsStart);

    const tabHeadersSource = configFormSource.slice(promptItemsStart, activePromptStart);
    const activePromptSource = configFormSource.slice(activePromptStart, promptItemsEnd);
    expect(tabHeadersSource).not.toContain('renderPromptTextArea(');
    expect(activePromptSource).toContain('item.key === activePromptTabKey');

    const promptTabsMarkupStart = configFormSource.indexOf('<Tabs', promptItemsEnd);
    const promptModalStart = configFormSource.indexOf('<Modal', promptTabsMarkupStart);
    const promptTabsMarkup = configFormSource.slice(promptTabsMarkupStart, promptModalStart);
    expect(promptTabsMarkup).toContain('onChange={handlePromptTabChange}');
    expect(promptTabsMarkup).toContain('{activePromptTab && (');
    expect(promptTabsMarkup).toContain('key={activePromptTab.key}');
    expect(promptTabsMarkup).toContain('data-prompt-tab-key={activePromptTab.key}');
    expect(promptTabsMarkup).toContain('renderPromptTextArea(');
    expect(promptTabsMarkup).toContain('activePromptTab.key');
  });
});
