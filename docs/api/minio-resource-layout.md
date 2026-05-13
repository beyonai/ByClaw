# MinIO 资源落点说明

本文用于说明各类资源在 `MinIO` 模式下的最终落点，供下游系统按统一规则读取文件与目录。

## 1. 统一前提

- 存储类型：`file.storage.type=minio`
- MinIO bucket：`file.storage.minio.bucket_name`
- 当前默认 bucket：`byclaw`
- 资源对象统一前缀：`resource/`

因此，下游读取资源时，可以统一理解为：

- bucket：`byclaw`
- object key 根前缀：`resource/`

## 2. 单 JSON 资源

这类资源最终会发布成一个标准命名的 JSON 文件。

适用类型包括：

- `TOOLKIT`
- `MCP`
- `AGENT`
- `DIG_EMPLOYEE`
- 知识库类资源，例如 `KG_DOC`
- 其他走“单 JSON 发布”的资源

### 2.1 统一规则

- 普通资源目录：`{resourceBizType小写}`
- 知识库资源目录：凡 `resourceBizType` 以 `KG_` 开头，统一落到 `doc`
- 文件名：`{RESOURCE_BIZ_TYPE大写}_{resourceId}.json`

### 2.2 MinIO 落点

```text
bucket: byclaw
objectKey: resource/{directory}/{BIZTYPE_UPPER}_{resourceId}.json
```

### 2.3 示例

#### TOOLKIT

```text
resource/toolkit/TOOLKIT_1001.json
```

#### MCP

```text
resource/mcp/MCP_1002.json
```

#### AGENT

```text
resource/agent/AGENT_1003.json
```

#### DIG_EMPLOYEE

```text
resource/dig_employee/DIG_EMPLOYEE_1004.json
```

#### 知识库资源（以 `KG_DOC` / `KG_QA` 为例）

```text
resource/doc/KG_DOC_1005.json
resource/doc/KG_QA_1006.json
```

## 3. OBJECT 压缩包资源

OBJECT 不是单文件，而是一个 bundle 目录。

### 3.1 统一规则

- bundle 目录名：`OBJECT_{id1&id2...}`
- bundle zip：`OBJECT_{id1&id2...}.zip`
- 每个对象 JSON：直接放在 `resource/object/` 根目录下，命名为 `OBJECT_{resourceId}.json`
- 原始解压内容：直接保留在 bundle 目录下

### 3.2 MinIO 落点

```text
bucket: byclaw
resource/object/OBJECT_{id1&id2...}/OBJECT_{id1&id2...}.zip
resource/object/OBJECT_{id1&id2...}/...原始解压内容...
resource/object/OBJECT_{id1}.json
resource/object/OBJECT_{id2}.json
```

### 3.3 示例

```text
resource/object/OBJECT_10817660_10817662/OBJECT_10817660_10817662.zip
resource/object/OBJECT_10817660_10817662/ontology/objects/...
resource/object/OBJECT_10817660.json
resource/object/OBJECT_10817662.json
```

## 4. VIEW 压缩包资源

VIEW 和 OBJECT 一样，也是 bundle 目录结构。

### 4.1 统一规则

- bundle 目录名：`VIEW_{id1&id2...}`
- bundle zip：`VIEW_{id1&id2...}.zip`
- 每个视图 JSON：直接放在 `resource/view/` 根目录下，命名为 `VIEW_{resourceId}.json`
- 原始解压内容：直接保留在 bundle 目录下

### 4.2 MinIO 落点

```text
bucket: byclaw
resource/view/VIEW_{id1&id2...}/VIEW_{id1&id2...}.zip
resource/view/VIEW_{id1&id2...}/...原始解压内容...
resource/view/VIEW_{id1}.json
resource/view/VIEW_{id2}.json
```

### 4.3 示例

```text
resource/view/VIEW_10036108_10036109/VIEW_10036108_10036109.zip
resource/view/VIEW_10036108_10036109/ontology/views/...
resource/view/VIEW_10036108.json
resource/view/VIEW_10036109.json
```

## 5. 下游读取建议

下游系统建议统一按以下规则读取：

### 5.1 单 JSON 资源

```text
resource/{directory}/{RESOURCE_BIZ_TYPE大写}_{resourceId}.json
```

其中：

```text
普通资源：directory = resourceBizType小写
知识库资源：如果 resourceBizType 以 KG_ 开头，则 directory = doc
```

### 5.2 OBJECT bundle

```text
resource/object/OBJECT_{ids}/...
```

### 5.3 VIEW bundle

```text
resource/view/VIEW_{ids}/...
```

## 6. 一句话总结

MinIO 模式下，所有资源统一落在：

- bucket：`byclaw`
- 前缀：`resource/`

其中：

- 单 JSON 资源：落为一个标准 JSON 文件
- OBJECT / VIEW：落为一个 bundle 目录，目录内同时包含：
  - bundle zip
  - 原始解压内容
- OBJECT / VIEW 各自生成的单资源 JSON：直接平铺在 `resource/object/`、`resource/view/` 根目录下
