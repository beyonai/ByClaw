import { useRef, useState } from 'react';
import { Button, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { buildSkillBundle, fetchSkillPackage, saveSkillFile } from '../skillExport';
import type { WorkspaceSkillItem } from '../workspaceSkill/utils';

interface Props {
  item?: WorkspaceSkillItem;
  loadAll?: () => Promise<WorkspaceSkillItem[]>;
  digitalEmployeeId?: string | number;
}

/** 导出属于浏览能力，不依赖管理、编辑或导入权限。 */
export default function SkillExportButton({ item, loadAll, digitalEmployeeId }: Props) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);
  return (
    <Button
      size="small"
      icon={<DownloadOutlined />}
      loading={loading}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.stopPropagation();
        if (lock.current) return;
        lock.current = true;
        setLoading(true);
        try {
          if (item) {
            const { file, fileName } = await fetchSkillPackage(item, digitalEmployeeId);
            saveSkillFile(file, fileName);
          } else {
            const items = await loadAll?.();
            if (!items?.length) {
              message.info(intl.formatMessage({ id: 'common.noData' }));
              return;
            }
            saveSkillFile(await buildSkillBundle(items, digitalEmployeeId), 'skills.zip');
          }
        } catch {
          message.error(intl.formatMessage({ id: 'common.downloadFailed' }));
        } finally {
          lock.current = false;
          setLoading(false);
        }
      }}
    >
      {intl.formatMessage({ id: item ? 'resource.skillExport.single' : 'resource.skillExport.all' })}
    </Button>
  );
}
