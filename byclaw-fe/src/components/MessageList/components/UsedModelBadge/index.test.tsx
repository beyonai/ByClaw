import { render, screen } from '@testing-library/react';

import UsedModelBadge from './index';

describe('UsedModelBadge', () => {
  it('renders the model name from message metadata', () => {
    render(
      <UsedModelBadge
        metadata={JSON.stringify({
          usedModel: { id: '10004014', code: 'deepseek-v4-flash', name: 'lwt-deepseek-v4-flash' },
        })}
      />
    );

    expect(screen.getByText('lwt-deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByText('lwt-deepseek-v4-flash').parentElement).toHaveAttribute(
      'title',
      'lwt-deepseek-v4-flash（deepseek-v4-flash）'
    );
  });

  it('falls back to the model code when no display name was recorded', () => {
    render(<UsedModelBadge metadata={JSON.stringify({ usedModel: { code: 'qwen3.6-27b' } })} />);

    expect(screen.getByText('qwen3.6-27b')).toBeInTheDocument();
  });

  it('renders nothing without a usable usedModel field', () => {
    const { container: missing } = render(<UsedModelBadge />);
    expect(missing.firstChild).toBeNull();

    const { container: otherMetadata } = render(<UsedModelBadge metadata={JSON.stringify({ agentId: '1' })} />);
    expect(otherMetadata.firstChild).toBeNull();

    const { container: malformed } = render(<UsedModelBadge metadata="not-json" />);
    expect(malformed.firstChild).toBeNull();
  });
});
