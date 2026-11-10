import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ToolSandboxMarket from '../market';
import { POST } from '@/service/common/request';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@umijs/max', () => ({ history: { push: jest.fn() } }));
jest.mock('copy-to-clipboard', () => jest.fn(() => true));

describe('tool sandbox public market', () => {
  it('shows custom metadata and lets enabled cold templates join while disabled templates cannot', async () => {
    (POST as jest.Mock).mockResolvedValue([
      {
        templateKey: 'analysis',
        serviceKey: 'custom-analysis',
        displayName: 'Data analysis',
        capabilities: ['data.analysis'],
        description: 'Analyze supplied datasets',
        coverImage: '/covers/analysis.png',
        enabled: true,
        ready: false,
        buildStatus: 'UNKNOWN',
      },
      {
        templateKey: 'media',
        serviceKey: 'media',
        displayName: 'Media production',
        capabilities: ['video.render'],
        description: 'Video editing',
        enabled: false,
        ready: true,
      },
    ]);
    render(<ToolSandboxMarket />);
    await screen.findByText('Data analysis');
    expect(screen.getByText('Analyze supplied datasets')).toBeTruthy();
    expect(screen.getByAltText('Data analysis')).toHaveAttribute('src', '/covers/analysis.png');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeDisabled();
    expect(checkboxes[1]).toBeDisabled();
    fireEvent.click(checkboxes[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: '复制协作任务并打开聊天' })).not.toBeDisabled());
  });
});
