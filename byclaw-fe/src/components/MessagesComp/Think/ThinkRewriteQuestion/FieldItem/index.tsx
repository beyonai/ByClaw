import RewriteString from '../components/RewriteString';
import { IFieldItem } from '../interface';

export default function FieldItem({
  field,
  path,
  handleChange,
  handleDelete,
}: {
  field: IFieldItem;
  path: string;
  handleChange: (path: string, value: string) => void;
  handleDelete: (path: string) => void;
}) {
  const item = {
    name: field.keyword,
    selectedName: field.choiceKeyword || field.recall?.[0],
    list: field.recall.map((ele) => ({
      mergeName: ele,
    })),
  };
  return (
    <RewriteString
      item={item}
      handleChange={(value) => handleChange(`${path}.choiceKeyword`, value)}
      handleDelete={() => handleDelete(path)}
    />
  );
}
