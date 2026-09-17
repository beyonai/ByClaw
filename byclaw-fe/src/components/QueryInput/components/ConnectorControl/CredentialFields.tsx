import { Form, Input } from 'antd';
import type { ConnectorCredentialField } from '@/service/connector';
import styles from './index.module.less';

interface Props {
  fields: ConnectorCredentialField[];
  customImap?: boolean;
}

export default function CredentialFields({ fields, customImap = false }: Props) {
  const renderField = (field: ConnectorCredentialField) => (
    <Form.Item
      className={styles.credentialField}
      key={field.key}
      label={field.label}
      name={field.key}
      rules={[{ required: true, whitespace: true, message: `请输入${field.label}` }]}
      style={{ gridColumn: /^(imap|smtp)(Port|Encryption)$/.test(field.key) ? undefined : '1 / -1' }}
    >
      {field.inputType === 'password' ? (
        <Input.Password autoComplete="off" maxLength={field.maxLength} />
      ) : (
        <Input autoComplete="off" maxLength={field.maxLength} />
      )}
    </Form.Item>
  );

  if (!customImap) return <>{fields.map(renderField)}</>;

  const groups = [
    { title: '账号信息', fields: fields.filter((field) => !/^(imap|smtp)/.test(field.key)) },
    { title: 'IMAP 收信服务器', fields: fields.filter((field) => field.key.startsWith('imap')) },
    { title: 'SMTP 发信服务器', fields: fields.filter((field) => field.key.startsWith('smtp')) },
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
