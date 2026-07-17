import {
  applyDraftSourceEdit,
  mergeDraftVerification,
  mergeSaveResult,
  saveWithOverwriteConfirmation,
} from './useRecorderSession';
import type { PipelineDraft, RequestEnvelope, SaveResult } from '../types/recorder';

const draft: PipelineDraft = {
  id: 'draft_0',
  candidateId: 'candidate_0',
  site: 'example_com',
  name: 'search',
  source: 'original source',
  score: 90,
  confidence: 'high',
  reason: 'good',
  risks: [],
  notes: [],
  staticOk: true,
  staticViolations: [],
  verify: { ok: true, rows: 1, fieldCount: 2, reasons: [] },
  usable: true,
  verifiedSourceHash: 'sha256-original',
  verifiedAt: 100,
};

describe('recorder verify-then-save state', () => {
  it('invalidates local verification metadata immediately after source editing', () => {
    const edited = applyDraftSourceEdit(draft, 'edited source');

    expect(edited).toEqual(
      expect.objectContaining({
        source: 'edited source',
        usable: false,
        verifiedSourceHash: undefined,
        verifiedAt: undefined,
      })
    );
  });

  it('invalidates prior proof when re-verifying the unchanged source', () => {
    const retrying = applyDraftSourceEdit(draft, draft.source);

    expect(retrying).toEqual(
      expect.objectContaining({
        source: 'original source',
        usable: false,
        verifiedSourceHash: undefined,
        verifiedAt: undefined,
      })
    );
  });

  it('merges terminal verification metadata into the exact verified source', () => {
    const verified = mergeDraftVerification(draft, 'edited source', {
      draftId: 'draft_0',
      verify: { ok: true, rows: 2, fieldCount: 3, reasons: [] },
      usable: true,
      verifiedSourceHash: 'sha256-edited',
      verifiedAt: 200,
    });

    expect(verified).toEqual(
      expect.objectContaining({
        source: 'edited source',
        usable: true,
        verifiedSourceHash: 'sha256-edited',
        verifiedAt: 200,
      })
    );
  });

  it('marks only actually saved drafts and keeps partial failures recoverable', () => {
    const result: SaveResult = {
      state: 'ranked',
      saved: [],
      failed: [{ draftId: 'draft_0', code: 'daemon_unavailable', reason: 'daemon unavailable' }],
      allSucceeded: false,
    };

    expect(mergeSaveResult([], [], result)).toEqual({
      savedDraftIds: [],
      savedAdapters: [],
      savedAdapterPath: undefined,
    });
  });

  it('preserves the legacy path from an earlier successful save after a later failure', () => {
    const saved = {
      draftId: 'draft_saved',
      site: 'example_com',
      name: 'saved',
      adapterPath: '/by/.bycli/clis/example_com/saved.js',
      reportPath: '/by/.bycli/sites/example_com/recorder/saved-report.json',
    };

    expect(
      mergeSaveResult(['draft_saved'], [saved], {
        state: 'ranked',
        saved: [],
        failed: [{ draftId: 'draft_0', code: 'daemon_unavailable', reason: 'daemon unavailable' }],
        allSucceeded: false,
      }).savedAdapterPath
    ).toBe('/by/.bycli/clis/example_com/saved.js');
  });

  const conflict: RequestEnvelope<SaveResult> = {
    ok: false,
    schemaVersion: 'recorder.v1',
    requestId: 'save_conflict',
    data: null,
    error: { code: 'adapter_exists', message: 'adapter already exists' },
  };
  const success: RequestEnvelope<SaveResult> = {
    ok: true,
    schemaVersion: 'recorder.v1',
    requestId: 'save_ok',
    data: {
      state: 'ranked',
      saved: [
        {
          draftId: 'draft_0',
          site: 'example_com',
          name: 'search',
          adapterPath: '/by/.bycli/clis/example_com/search.js',
        },
      ],
      allSucceeded: true,
    },
    error: null,
  };

  it('does not retry or mark success when overwrite confirmation is cancelled', async () => {
    const save = jest.fn().mockResolvedValue(conflict);
    const confirm = jest.fn().mockResolvedValue(false);

    const outcome = await saveWithOverwriteConfirmation(save, confirm);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ response: conflict, cancelled: true });
  });

  it('retries the exact save operation with overwrite=true only after confirmation', async () => {
    const save = jest.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(success);
    const confirm = jest.fn().mockResolvedValue(true);

    const outcome = await saveWithOverwriteConfirmation(save, confirm);

    expect(save.mock.calls).toEqual([[false], [true]]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ response: success, cancelled: false });
  });

  it('does not ask for confirmation when the initial non-overwriting save succeeds', async () => {
    const save = jest.fn().mockResolvedValue(success);
    const confirm = jest.fn().mockResolvedValue(true);

    const outcome = await saveWithOverwriteConfirmation(save, confirm);

    expect(save).toHaveBeenCalledWith(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(outcome.cancelled).toBe(false);
  });
});
