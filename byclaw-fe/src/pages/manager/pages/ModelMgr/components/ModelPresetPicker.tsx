import { Select } from 'antd';
import { useState } from 'react';
import { useIntl } from '@umijs/max';
import { MODEL_FORM_PRESETS } from './modelFormPresets';
import type { ModelFormPreset } from './modelFormPresets';
import { getVisiblePresetOptions } from './modelPresetCatalog';

type Props = {
  onSelect?: (presetId: string) => void;
  presets?: ModelFormPreset[];
};

export default function ModelPresetPicker({ onSelect, presets = MODEL_FORM_PRESETS }: Props) {
  const intl = useIntl();
  const [search, setSearch] = useState('');
  const message = (key: string) => intl.formatMessage({ id: `modelMgr.modal.${key}` });
  const formatDeveloper = (preset: ModelFormPreset) =>
    preset.developer ? message(`presetDeveloper.${preset.developer}`) : '';
  const formatLabel = (preset: ModelFormPreset) =>
    intl.formatMessage(
      { id: `modelMgr.modal.${preset.channel ? 'presetLabelWithChannel' : 'presetLabelWithDeveloper'}` },
      {
        model: preset.label,
        developer: formatDeveloper(preset),
        channel: preset.channel ? message(`presetChannel.${preset.channel}`) : '',
      }
    );

  return (
    <Select
      aria-label={message('quickPreset')}
      showSearch
      value={undefined}
      searchValue={search}
      onSearch={setSearch}
      filterOption={false}
      placeholder={message('quickPresetPlaceholder')}
      notFoundContent={message('presetNoResults')}
      options={getVisiblePresetOptions({ presets, search, locale: intl.locale, formatLabel })}
      onChange={(presetId) => {
        setSearch('');
        onSelect?.(presetId);
      }}
    />
  );
}
