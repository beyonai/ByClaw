import { fireEvent, render, screen } from '@testing-library/react';
import ScriptsStep from './ScriptsStep';
import type { PipelineDraft } from '../types/recorder';

jest.mock('./pipelineShared', () => ({
  DraftCard: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}));

const draft: PipelineDraft = {
  id: 'draft_0',
  candidateId: 'candidate_0',
  site: 'example_com',
  name: 'search',
  source: 'same verified source',
  score: 90,
  confidence: 'high',
  reason: 'good',
  risks: [],
  notes: [],
  staticOk: true,
  staticViolations: [],
  verify: { ok: true, rows: 1, fieldCount: 2, reasons: [] },
  usable: true,
  verifiedSourceHash: 'sha256-source',
  verifiedAt: 100,
  filePath: '/by/.bycli/.recorder-drafts/draft_0.js',
};

describe('ScriptsStep save state', () => {
  it('keeps a previously saved draft actionable and saves the same verified source again', () => {
    const onSaveDraft = jest.fn();
    render(
      <ScriptsStep
        loading={false}
        drafts={[draft]}
        savedDraftIds={['draft_0']}
        savedAdapters={[
          {
            draftId: 'draft_0',
            site: 'example_com',
            name: 'search',
            adapterPath: '/by/.bycli/clis/example_com/search.js',
          },
        ]}
        onVerifyDraft={jest.fn()}
        onSaveDraft={onSaveDraft}
        onBack={jest.fn()}
      />
    );

    const saveAgain = screen.getByRole('button', { name: /再次保存/ });
    expect(saveAgain).toBeEnabled();

    fireEvent.click(saveAgain);
    expect(onSaveDraft).toHaveBeenCalledWith('draft_0', 'same verified source');
  });
});
