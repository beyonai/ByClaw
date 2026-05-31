import { Row } from 'antd';

import { buildFormItemPath } from '../utils';

import FormItemsRender from './FormItemsRender';

import type { FormField } from '../index.d';

import styles from '../index.module.less';

type FormFieldsRenderProps = {
  isDisable: boolean;
  substance: Array<FormField[]>;
  parentPath?: string;
  pathPrefix?: string;
};

export default function FormFieldsRender(props: FormFieldsRenderProps) {
  const { isDisable, substance, parentPath, pathPrefix } = props;

  return (
    <>
      {substance?.map?.((list, lidx) => {
        return (
          <Row gutter={24} key={lidx} className={styles.formRow}>
            {list.map((item, idx) => {
              const key = pathPrefix
                ? `${pathPrefix}.${buildFormItemPath(lidx, idx)}`
                : buildFormItemPath(lidx, idx, parentPath);

              return (
                <FormItemsRender
                  key={key}
                  idx={key}
                  item={item}
                  isDisable={isDisable}
                  renderNestedForm={(formFieldsRenderProps) => <FormFieldsRender {...formFieldsRenderProps} />}
                />
              );
            })}
          </Row>
        );
      })}
    </>
  );
}
