import { useIntl } from '@umijs/max';
import { Form, Input } from 'antd';
import type { ConnectorCredentialField } from '@/service/connector';
import styles from './index.module.less';

interface Props {
  fields: ConnectorCredentialField[];
  customImap?: boolean;
}

export default function CredentialFields({ fields, customImap = false }: Props) {
  const intl = useIntl();
  const input = (field: ConnectorCredentialField) => {
    if (field.inputType === 'password') {
      return (
        <Input.Password autoComplete="off" maxLength={field.maxLength} placeholder={field.placeholder ?? undefined} />
      );
    }
    if (field.inputType === 'textarea') {
      return (
        <Input.TextArea
          autoComplete="off"
          maxLength={field.maxLength}
          placeholder={field.placeholder ?? undefined}
          rows={4}
        />
      );
    }
    return (
      <Input
        autoComplete="off"
        maxLength={field.maxLength}
        placeholder={field.placeholder ?? undefined}
        type={field.inputType === 'number' ? 'number' : 'text'}
      />
    );
  };

  const renderField = (field: ConnectorCredentialField) => (
    <Form.Item
      className={styles.credentialField}
      key={field.key}
      label={field.label}
      name={field.key}
      initialValue={field.defaultValue ?? undefined}
      extra={field.description ?? undefined}
      rules={[
        {
          required: true,
          whitespace: true,
          message: intl.formatMessage({ id: 'connector.credentials.required' }, { label: field.label }),
        },
      ]}
      style={{ gridColumn: /^(imap|smtp)(Port|Encryption)$/.test(field.key) ? undefined : '1 / -1' }}
    >
      {input(field)}
    </Form.Item>
  );

  if (!customImap) {
    const basicFields = fields.filter((field) => !field.advanced);
    const advancedFields = fields.filter((field) => field.advanced);
    return (
      <>
        {basicFields.map(renderField)}
        {advancedFields.length > 0 && (
          <details className={styles.credentialAdvanced}>
            <summary>{intl.formatMessage({ id: 'connector.credentials.advanced' })}</summary>
            <div className={styles.credentialAdvancedFields}>{advancedFields.map(renderField)}</div>
          </details>
        )}
      </>
    );
  }

  const groups = [
    {
      title: intl.formatMessage({ id: 'connector.credentials.account' }),
      fields: fields.filter((field) => !/^(imap|smtp)/.test(field.key)),
    },
    {
      title: intl.formatMessage({ id: 'connector.credentials.imap' }),
      fields: fields.filter((field) => field.key.startsWith('imap')),
    },
    {
      title: intl.formatMessage({ id: 'connector.credentials.smtp' }),
      fields: fields.filter((field) => field.key.startsWith('smtp')),
    },
  ];
  return (
    <>
      {groups
        .filter((group) => group.fields.length)
        .map((group) => (
          <fieldset className={styles.credentialFieldGroup} key={group.title}>
            <legend>{group.title}</legend>
            <div className={styles.credentialFieldGrid}>{group.fields.map(renderField)}</div>
          </fieldset>
        ))}
    </>
  );
}
