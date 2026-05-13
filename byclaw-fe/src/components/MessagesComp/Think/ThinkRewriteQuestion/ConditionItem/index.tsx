import RewriteString from '../components/RewriteString';
import { ComparisonMap, IConditionItem } from '../interface';

export default function ConditionItem({
  condition,
  path,
  handleChange,
  handleDelete,
}: {
  condition: IConditionItem;
  path: string;
  handleChange: (path: string, value: string) => void;
  handleDelete: (path: string) => void;
}) {
  const fieldItem = {
    name: condition.field,
    selectedName: condition.choiceField || condition.fieldRecall?.[0],
    list:
      condition.fieldRecall?.map((ele) => ({
        mergeName: ele,
      })) || [],
  };
  // 将comparison转化为ComparisonMap的value
  const comparison = ComparisonMap[condition.comparison as keyof typeof ComparisonMap];
  const comparisonItem = {
    name: comparison,
    selectedName: condition.choiceComparison || comparison,
    list:
      Object.values(ComparisonMap).map((ele) => ({
        mergeName: ele,
      })) || [],
  };
  const valueItem = {
    name: condition.value,
    selectedName: condition.choiceValue || condition.valueRecall?.[0],
    list:
      condition.valueRecall?.map((ele) => ({
        mergeName: ele,
      })) || [],
  };
  return (
    <div className="ub">
      <RewriteString
        item={fieldItem}
        handleChange={(value) => handleChange(`${path}.choiceField`, value)}
        handleDelete={() => handleDelete(path)}
      />
      <RewriteString
        item={comparisonItem}
        handleChange={(value) => handleChange(`${path}.choiceComparison`, value)}
        showLabel={false}
      />
      <RewriteString
        item={valueItem}
        handleChange={(value) => handleChange(`${path}.choiceValue`, value)}
        handleDelete={() => handleDelete(path)}
      />
    </div>
  );
}
