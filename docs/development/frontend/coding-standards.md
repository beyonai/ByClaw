# 前端编码规范

本文档定义 ByClaw 前端项目的编码规范。

## 代码风格

### ESLint 配置

项目使用 `@umijs/lint` 提供的 ESLint 配置：

```javascript
// .eslintrc.js
module.exports = {
  extends: require.resolve('@umijs/lint/dist/config/eslint'),
  rules: {
    // 自定义规则
    '@typescript-eslint/no-unused-vars': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
```

### Prettier 配置

```javascript
// .prettierrc.js
module.exports = {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  proseWrap: 'never',
  overrides: [
    {
      files: '.prettierrc',
      options: { parser: 'json' },
    },
  ],
};
```

### 运行代码检查

```bash
# 检查
pnpm lint

# 自动修复
pnpm lint:fix

# 类型检查
pnpm tsc
```

## TypeScript 规范

### 类型定义

#### 接口命名

```typescript
// 使用 PascalCase
interface UserInfo {
  id: string;
  name: string;
  email: string;
}

// 使用 I 前缀（可选，根据团队约定）
interface IUserService {
  getUser(id: string): Promise<UserInfo>;
}
```

#### 类型别名

```typescript
// 使用 PascalCase
type UserId = string;
type UserStatus = 'active' | 'inactive' | 'banned';

// 复杂类型
type ApiResponse<T> = {
  code: number;
  data: T;
  message: string;
};
```

#### 枚举

```typescript
// 使用 PascalCase
enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

// 优先使用 const enum
const enum HttpStatus {
  OK = 200,
  NotFound = 404,
}
```

### 类型推断

优先使用类型推断，减少冗余类型声明：

```typescript
// ✅ 推荐
const userList = useUserList(); // 自动推断类型

// ❌ 避免
const userList: UserInfo[] = useUserList();
```

### any 类型

避免使用 `any`，使用 `unknown` 代替：

```typescript
// ❌ 避免
function processData(data: any) {
  return data.name;
}

// ✅ 推荐
function processData(data: unknown) {
  if (typeof data === 'object' && data !== null) {
    return (data as { name: string }).name;
  }
}
```

## React 规范

### 组件定义

#### 函数组件

```typescript
// ✅ 推荐：使用箭头函数 + FC
interface Props {
  title: string;
}

const MyComponent: React.FC<Props> = ({ title }) => {
  return <div>{title}</div>;
};

export default MyComponent;
```

#### Props 命名

```typescript
interface MyComponentProps {
  // 回调函数使用 on 前缀
  onClick: () => void;
  onSubmit: (values: FormValues) => void;
  
  // 布尔值使用 is/has/can/should 前缀
  isLoading: boolean;
  hasError: boolean;
  canEdit: boolean;
  
  // 数组使用复数
  items: Item[];
  users: User[];
}
```

### Hooks 规范

#### useEffect

```typescript
// ✅ 正确的依赖处理
useEffect(() => {
  fetchData();
}, [id]); // 明确的依赖

// ✅ 清理函数
useEffect(() => {
  const subscription = subscribe();
  return () => {
    subscription.unsubscribe();
  };
}, []);
```

#### 自定义 Hooks

```typescript
// 使用 use 前缀
function useUserInfo(userId: string) {
  const [user, setUser] = useState<UserInfo | null>(null);
  
  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]);
  
  return user;
}

// 返回数组时使用语义化命名
function useToggle(initial = false) {
  const [isOn, setIsOn] = useState(initial);
  const toggle = useCallback(() => setIsOn(v => !v), []);
  return [isOn, toggle] as const;
}
```

## 命名规范

### 文件命名

| 类型 | 命名 | 示例 |
|------|------|------|
| 组件 | PascalCase | `UserProfile.tsx` |
| 工具函数 | camelCase | `formatDate.ts` |
| 常量 | UPPER_SNAKE_CASE | `API_ENDPOINTS.ts` |
| 样式 | 与组件同名 | `UserProfile.less` |
| 测试 | 组件名.test.ts | `UserProfile.test.tsx` |

### 变量命名

```typescript
// ✅ 语义化命名
const isLoading = true;
const hasPermission = false;
const userList: User[] = [];
const currentUser: User | null = null;

// ❌ 避免
const flag = true;
const arr = [];
const data = null;
```

### 函数命名

```typescript
// 动词 + 名词
function fetchUserInfo() {}
function handleSubmit() {}
function validateForm() {}

// 布尔值返回函数使用 is/has/can
function isValid() {}
function hasPermission() {}
function canEdit() {}
```

## 注释规范

### 文件头注释

```typescript
/**
 * @file 文件描述
 * @author 作者名
 * @description 详细描述
 */
```

### 函数注释

```typescript
/**
 * 获取用户信息
 * @param id 用户ID
 * @returns 用户信息
 * @throws 当用户不存在时抛出错误
 */
async function getUser(id: string): Promise<UserInfo> {
  // ...
}
```

### 代码注释

```typescript
// 单行注释
const count = 0; // 计数器

/**
 * 多行注释
 * 说明复杂逻辑
 */
function complexLogic() {
  // TODO: 优化性能
  // FIXME: 处理边界情况
}
```

## 性能优化

### 组件优化

```typescript
// ✅ 使用 memo 避免不必要渲染
const ExpensiveComponent = React.memo(({ data }) => {
  return <div>{/* 复杂渲染 */}</div>;
});

// ✅ 使用 useMemo 缓存计算结果
const processedData = useMemo(() => {
  return data.map(item => expensiveOperation(item));
}, [data]);

// ✅ 使用 useCallback 缓存回调函数
const handleClick = useCallback(() => {
  onSubmit(formData);
}, [formData, onSubmit]);
```

### 状态管理

```typescript
// ✅ 状态最小化
const [user, setUser] = useState({
  name: '',
  email: '',
  age: 0,
});

// ❌ 避免嵌套过深的状态
const [state, setState] = useState({
  user: { profile: { name: '' } },
});
```

## Git 提交规范

### Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 修复 Bug |
| docs | 文档更新 |
| style | 代码格式调整 |
| refactor | 重构 |
| perf | 性能优化 |
| test | 测试相关 |
| chore | 构建/工具相关 |

### 示例

```
feat(chat): add message reply feature

- Add reply button to message actions
- Show quoted message in input area
- Update message list to show reply indicator

Closes #123
```

## 代码审查清单

- [ ] TypeScript 类型正确
- [ ] 没有使用 any
- [ ] 组件 props 有完整类型定义
- [ ] Hooks 依赖完整
- [ ] 没有 console.log
- [ ] 代码已格式化
- [ ] 没有未使用的变量/导入
- [ ] 错误处理完善
- [ ] 国际化文本已添加
