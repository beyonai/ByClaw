import React, { useCallback, useState } from 'react';
import SkillDetailDrawer from '@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer';

/**
 * 岗位管理资源列表中打开技能详情（与 employees 侧 SkillDetailDrawer 一致）
 */
export function useSkillDetailDrawer() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<{ id: string; title: string } | null>(null);

  const show = useCallback((opts: { id: string; title: string }) => {
    setPayload(opts);
    setOpen(true);
  }, []);

  const placeholder =
    open && payload ? (
      <SkillDetailDrawer
        resourceId={payload.id}
        title={payload.title}
        open={open}
        onClose={() => {
          setOpen(false);
          setPayload(null);
        }}
      />
    ) : null;

  return { placeholder, show };
}
