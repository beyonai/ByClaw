import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ModelSelect from '../index';

jest.mock('@/pages/models/service', () => ({
  getMyModels: jest.fn(async () => ({
    data: {
      rows: [{ id: 11, displayName: '我的模型', providerName: 'DeepSeek', modelType: 'LLM', status: 'ENABLED' }],
    },
  })),
  getPublicModels: jest.fn(async () => ({
    data: { rows: [{ id: 22, displayName: '公共模型', modelType: 'LLM', status: 'ENABLED' }] },
  })),
}));

type DesktopWindow = Window & {
  byclawDesktop?: {
    models?: { local?: () => Promise<Array<{ id: string; name: string; provider: string }>> };
  };
};

const desktopWindow = window as DesktopWindow;

afterEach(() => {
  delete desktopWindow.byclawDesktop;
  window.localStorage.clear();
});

describe('ModelSelect', () => {
  it('renders on web only when allowWeb is enabled', () => {
    const { container } = render(<ModelSelect onChange={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('loads my/public models on web and does not auto-select a model', async () => {
    const onChange = jest.fn();
    render(<ModelSelect allowWeb onChange={onChange} />);

    await waitFor(() => expect(screen.getByText('默认模型')).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers the default-model entry and my/public models in the web dropdown', async () => {
    render(<ModelSelect allowWeb onChange={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('默认模型')).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole('combobox'));

    expect(await screen.findByText('我的模型')).toBeInTheDocument();
    expect(screen.queryByText('本地')).not.toBeInTheDocument();
    expect(screen.getAllByText('默认模型').length).toBeGreaterThan(0);
  });

  it('selecting the default-model entry clears the value', async () => {
    const onChange = jest.fn();
    render(<ModelSelect allowWeb value="11" onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('我的模型')).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole('combobox'));
    const defaultEntry = await screen.findByText('默认模型');
    fireEvent.click(defaultEntry);

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps the desktop behaviour: local models, auto-select and localStorage persistence', async () => {
    const local = jest.fn(async () => [{ id: 'local-1', name: '本地模型', provider: 'claude' }]);
    desktopWindow.byclawDesktop = { models: { local } };
    const onChange = jest.fn();

    render(<ModelSelect onChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('local-1'));
    expect(local).toHaveBeenCalled();
  });

  it('treats -1 as an explicit default choice and does not auto-select on desktop', async () => {
    const local = jest.fn(async () => [{ id: 'local-1', name: '本地模型', provider: 'claude' }]);
    desktopWindow.byclawDesktop = { models: { local } };
    const onChange = jest.fn();

    render(<ModelSelect value="-1" onChange={onChange} />);

    await waitFor(() => expect(screen.getAllByText('默认模型').length).toBeGreaterThan(0));
    expect(onChange).not.toHaveBeenCalled();
  });
});
