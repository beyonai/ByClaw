import { previewPublication, publicationAction, saveOfficialUpdateDraft } from '@/service/employeePublication';
import { useCallback, useRef, useState } from 'react';
import usePublicationConfirmation from './usePublicationConfirmation';

export default function useOfficialUpdate() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const { confirmPublication, confirmationDialog } = usePublicationConfirmation('update');
  const save = useCallback(
    async (resourceId: string, employee: any) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        const saved = await saveOfficialUpdateDraft(resourceId, employee);
        const preview = await previewPublication(saved.publication);
        if ((await confirmPublication(preview)) !== 'publish') return 'draft';
        const submitted = await publicationAction('submit', preview.publication);
        if (submitted.publication.status === 'DRAFT') return 'draft';
        return 'submitted';
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [confirmPublication]
  );
  return { save, busy, confirmationDialog };
}
