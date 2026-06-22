import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

type FormFieldValue = string | number | Array<string | number>;

type FormFieldOption = {
  label: string;
  value: string | number;
};

// 基础表单字段公共属性
interface BaseFormField {
  formType: string;
  fieldCode: string;
  fieldPath: string;
  fieldName: string;
  fieldType: string; // 如 "string" | "number" | "object" | "array<string>"
  description?: string;
  required?: boolean;
  readonly?: boolean;
  disabled?: boolean;
  isHidden?: boolean;
  defaultValue?: FormFieldValue;
  defaultFiles?: unknown[]; // 通常为空数组
  itemId?: string;
  optional?: string | string[];
  options?: FormFieldOption[];
  children?: FormField[][];
  fieldValue?: FormFieldValue;
}

// 日期时间类型字段
interface DateTimeFormField extends BaseFormField {
  formType: 'date_time';
  format?: string;
}

// object 类型字段，包含 children 二维数组
interface ObjectFormField extends BaseFormField {
  formType: 'object';
  children: FormField[][]; // 二维数组，每个元素是一组字段
  fieldValue?: never; // object 没有直接值
}

// array 类型字段，包含 children 二维数组
interface ArrayFormField extends BaseFormField {
  formType: 'array';
  children: FormField[][];
  fieldValue?: never;
}

// input 类型字段
interface InputFormField extends BaseFormField {
  formType: 'input';
  fieldValue?: FormFieldValue;
}

// number 类型字段
interface NumberFormField extends BaseFormField {
  formType: 'number';
  fieldValue?: number;
}

// select 类型字段
interface SelectFormField extends BaseFormField {
  formType: 'select';
  fieldValue?: FormFieldValue;
}

// textarea 类型字段
interface TextareaFormField extends BaseFormField {
  formType: 'textarea';
  fieldValue?: string;
}

// term_select 类型字段
interface TermSelectFormField extends BaseFormField {
  formType: 'term_select';
  fieldValue?: FormFieldValue;
  term?: {
    termSet: string;
    termField: string;
    termTypeCode: string;
    datasetId: number;
  };
  termResolveNotice?: {
    "status": "recommended",
    "originalValue": string,
    "recommendedValue": string,
    "recommendedLabel": string,
    "message": string,
  },

  page?: number;
  pageSize?: number;
  total?: number;
  hasMore?: boolean;
  keyword?: string;
  termOptionsData?: unknown;
  termOptionsLoading?: boolean;
}

// 所有可能的表单字段联合类型
type FormField =
  | DateTimeFormField
  | ObjectFormField
  | ArrayFormField
  | InputFormField
  | NumberFormField
  | SelectFormField
  | TextareaFormField
  | TermSelectFormField;

// 批处理中的一个操作项
interface SubstanceItem {
  toolCallId: string;
  toolName: string;
  actionCode: string;
  actionName: string;
  title: string;
  description: string;
  rule: FormField[][]; // 二维数组，外层为操作项，内层为字段组
  confirmed?: boolean;
}

// 顶层确认表单结构
interface OperationFormConfirmation {
  sourceAgentType: string;
  metadata: string; // JSON 字符串
  schemaVersion: string;
  formId: string;
  title: string;
  description: string;
  substance: SubstanceItem[];
  formStatus?: IFormStatus;
}

export type {
  ArrayFormField,
  FormField,
  FormFieldOption,
  FormFieldValue,
  InputFormField,
  NumberFormField,
  ObjectFormField,
  OperationFormConfirmation,
  SelectFormField,
  SubstanceItem,
  TermSelectFormField,
  TextareaFormField,
};
