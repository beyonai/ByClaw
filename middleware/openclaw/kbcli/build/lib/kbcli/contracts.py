from __future__ import annotations

from copy import deepcopy


COMMON_ERRORS = [
    "INVALID_ARGUMENT",
    "BACKEND_ERROR",
    "DISCOVERY_UNAVAILABLE",
    "SERVICE_UNAVAILABLE",
    "PROTOCOL_ERROR",
    "EMPTY_DOWNLOAD",
]


def _object(**properties: str | dict) -> dict:
    return {
        "type": "object",
        "properties": {
            name: value if isinstance(value, dict) else {"type": value}
            for name, value in properties.items()
        },
    }


def _array(item: str | dict) -> dict:
    return {"type": "array", "items": item if isinstance(item, dict) else {"type": item}}


RESOURCE_SCHEMA = _object(
    resourceId="string", resourceCode="string", resourceName="string", resourceDesc="string",
    resourceBizType="string", resourceType="string", ownerType="string", catalogId="string",
    resourceStatus="integer", type="string", createTime="string", updateTime="string",
)
DIR_ITEM_SCHEMA = _object(
    id="string", knCode="string", resourceId="string", name="string", type="string",
    fileName="string", directoryPath="string", size="integer", updatedAt="string",
    buildStatus="string", buildCurrentStep="string", createBy="string", createStaffName="string",
)
UPLOAD_ITEM_SCHEMA = _object(
    fileId="string", fileName="string", filePath="string", fileUrl="string",
    success="boolean", error="string",
)
SEARCH_CHUNK_SCHEMA = _object(
    knCode="string", resourceId="string", filePath="string", chunkNo="integer",
    chunkId="string", chunkText="string", score="number", imagePath="string",
    startLine="integer", endLine="integer", metadata="object",
)
SEARCH_FILE_SCHEMA = _object(
    knCode="string", resourceId="string", filePath="string", score="number", metadata="object",
)
METADATA_ITEM_SCHEMA = _object(
    knCode="string", resourceId="string", filePath="string", metadata="object",
)
RESOURCE_AUTH_SCHEMA = _object(
    resourceId="string", resourceCode="string", resourceName="string", resourceDesc="string",
    resourceBizType="string", resourceType="string", ownerType="string", resourceStatus="integer",
    systemCode="string", avatar="string", tags="string", catalogId="string", catalogName="string",
    createBy="string", createUserName="string", createTime="string", updateTime="string",
    hasPermission="boolean", authStatus="string", publishType="string",
)

OUTPUT_SCHEMAS = {
    "SsResource": RESOURCE_SCHEMA,
    "DatasetDetail": RESOURCE_SCHEMA,
    "null": {"type": "null"},
    "boolean": {"type": "boolean"},
    "KbDirectoryCreate": _object(knCode="string", directoryPath="string", directoryDescription="string"),
    "KbDirectoryUpdate": _object(knCode="string", directoryPath="string", directoryName="string"),
    "KnowledgeItemsMoveResult": _object(
        data=_array(_object(sourcePath="string", targetPath="string", success="boolean", error="string")),
        summary=_object(total="integer", succeeded="integer", failed="integer"),
    ),
    "DirAndFile[]": _array(DIR_ITEM_SCHEMA),
    "KnowledgeUploadConflictCheckResponse": _object(conflict="boolean", overwritePaths=_array("string")),
    "UploadResult": _object(
        resourceId="string", resourceCode="string", resourceName="string",
        uploadItems=_array(UPLOAD_ITEM_SCHEMA), failedItems=_array(UPLOAD_ITEM_SCHEMA),
        summary=_object(total="integer", succeeded="integer", failed="integer"),
        postProcessErrors=_array("string"),
    ),
    "KbFileUpdateResult": _object(data=_array(_object(
        knCode="string", resourceId="string", filePath="string", success="boolean", error="string"
    ))),
    "DownloadResult": _object(outputPath="string", size="integer", contentType="string"),
    "KbFileReadResult": _object(
        knCode="string", resourceId="string", filePath="string", startLine="integer",
        endLine="integer", data="string", reachedEof="boolean",
    ),
    "KnowledgeSearchResult": _object(data=_array(SEARCH_CHUNK_SCHEMA)),
    "KnowledgeFileSearchResult": _object(data=_array(SEARCH_FILE_SCHEMA)),
    "KnowledgeMetadataSearchResult": _object(
        data=_array(METADATA_ITEM_SCHEMA), total="integer", pageNum="integer", pageSize="integer"
    ),
    "PageInfoResourceAuth": _object(
        pageNum="integer", pageSize="integer", total="integer", totalPages="integer",
        list=_array(RESOURCE_AUTH_SCHEMA),
    ),
    "BuildAccepted": {"type": "null"},
    "MarkdownConversionResult": _object(outputPath="string", size="integer", contentType="string"),
    "BuildKnowledgeFromDocResult": {"type": "string"},
    "KnowledgeBuildResult": _object(
        knCode="string", resourceId="string", filePath="string", fileName="string",
        fileType="string", fileSize="integer", mimeType="string", build="object",
        markdown="object", chunks="object", embedding="object", retrieval="object",
    ),
    "ProcessStatus": _object(
        status="string", currentStep="string", currentStepStatus="string",
        statusDict="array", stepDict="array",
    ),
}


def _schema(**properties: tuple[str, bool]) -> dict:
    result = {"type": "object", "properties": {}, "required": []}
    for name, (value_type, required) in properties.items():
        result["properties"][name] = {"type": value_type, "required": required}
        if required:
            result["required"].append(name)
    return result


def _search_schema() -> dict:
    result = _schema(
        sessionId=("string", True), resourceId=("string[]", True),
        query=("string", True), topK=("integer", False), mode=("string", False),
    )
    result["properties"]["mode"].update({
        "enum": ["mixedRecall", "fullTextRecall", "embedding"],
        "default": "mixedRecall",
    })
    return result


def _contract(command: str, description: str, method: str, path: str,
              input_schema: dict, data_type: str, *, notes: list[str] | None = None) -> dict:
    return {
        "command": command,
        "description": description,
        "http": {"method": method, "path": path if path.startswith("/byaiService/")
                 else f"/byaiService/datasetController{path}"},
        "input": input_schema,
        "output": {
            "type": "object",
            "dataType": data_type,
            "dataSchema": deepcopy(OUTPUT_SCHEMAS[data_type]),
            "envelope": {
                "ok": "boolean",
                "operation": "string",
                "data": data_type,
                "meta": "object",
            },
        },
        "errors": list(COMMON_ERRORS),
        "notes": notes or [],
    }


CONTRACTS = {
    "base list": _contract(
        "base list", "查询当前用户可用的知识库", "POST",
        "/byaiService/auth/privilegeGrant/listResourceUseAuth",
        _schema(sessionId=("string", True), keyword=("string", False), pageNum=("integer", False),
                pageSize=("integer", False)),
        "PageInfoResourceAuth",
        notes=["默认只查询已上架的 KG_DOC、KG_QA、KG_TERM"],
    ),
    "base create": _contract("base create", "创建知识库", "POST", "/createDataset",
                             _schema(sessionId=("string", True), input=("DatasetDto", True)), "SsResource"),
    "base update": _contract("base update", "更新知识库", "POST", "/updateDataset",
                             _schema(sessionId=("string", True), input=("DatasetDto", True)), "null"),
    "base delete": _contract("base delete", "删除知识库", "POST", "/deleteDataset",
                             _schema(sessionId=("string", True), resourceId=("string", True)), "boolean"),
    "base get": _contract("base get", "查询知识库详情", "GET", "/detail",
                          _schema(sessionId=("string", True), resourceId=("string", True)), "DatasetDetail"),
    "folder create": _contract("folder create", "创建目录", "POST", "/createFolder",
                               _schema(sessionId=("string", True), input=("Folder", True)), "KbDirectoryCreate"),
    "folder rename": _contract("folder rename", "重命名目录", "POST", "/renameFolder",
                               _schema(sessionId=("string", True), input=("Folder", True)), "KbDirectoryUpdate"),
    "folder delete": _contract("folder delete", "删除目录", "POST", "/deleteFolder",
                               _schema(sessionId=("string", True), resourceId=("string", True), path=("string", True)), "null"),
    "item move": _contract("item move", "批量移动文件或目录", "POST", "/moveKnowledgeItems",
                           _schema(sessionId=("string", True), input=("KnowledgeItemsMoveRequest", True)), "KnowledgeItemsMoveResult"),
    "item list": _contract("item list", "列出指定目录的文件和子目录", "POST", "/queryDirAndFileByLevel",
                           _schema(sessionId=("string", True), resourceId=("string", True),
                                   directory=("string", False), keyword=("string", False)), "DirAndFile[]",
                           notes=["directory 默认为 /；目录浏览应使用本命令，不要用 glob 代替"]),
    "item glob": _contract("item glob", "使用 Glob 匹配知识库路径", "POST", "/glob",
                           _schema(sessionId=("string", True), resourceId=("string", True),
                                   pathRule=("string", True)), "DirAndFile[]",
                           notes=["pathRule 必须以 / 开头；* 匹配单层路径；不支持 ** 多层通配符"]),
    "file conflicts": _contract("file conflicts", "检查上传文件冲突", "POST", "/checkUploadFileConflicts",
                                _schema(sessionId=("string", True), input=("KnowledgeUploadConflictCheckRequest", True)),
                                "KnowledgeUploadConflictCheckResponse"),
    "file upload": _contract("file upload", "上传知识库文件", "POST", "/uploadFiles",
                             _schema(sessionId=("string", True), resourceId=("string", True),
                                     directory=("string", False), file=("path[]", True)), "UploadResult"),
    "file update": _contract("file update", "更新知识库文件内容", "POST", "/knowledgeItems/update",
                             _schema(sessionId=("string", True), resourceId=("string", True),
                                     path=("string", True), file=("path", True)), "KbFileUpdateResult",
                             notes=["更新后不会自动触发知识构建"]),
    "file delete": _contract("file delete", "删除知识库文件", "POST", "/removeFile",
                             _schema(sessionId=("string", True), resourceId=("string", True), path=("string", True)), "null"),
    "file download": _contract("file download", "下载知识库文件", "GET", "/download",
                               _schema(sessionId=("string", True), resourceId=("string", True),
                                       path=("string", True), output=("path", True)), "DownloadResult"),
    "file read": _contract("file read", "读取 Markdown 内容", "POST", "/readFile",
                           _schema(sessionId=("string", True), resourceId=("string", True),
                                   path=("string", True), startLine=("integer", False),
                                   endLine=("integer", False)), "KbFileReadResult",
                           notes=["path 是以 / 开头的 Markdown 文件完整路径；不传行号表示读取完整文件"]),
    "build start": _contract("build start", "触发知识库文件构建", "POST", "/build",
                             _schema(sessionId=("string", True), resourceId=("string", True),
                                     path=("string", True)), "BuildAccepted",
                             notes=["path 是已入库文件的完整路径；写操作只执行一次，不自动重试"]),
    "build convert": _contract("build convert", "将本地原始文件转换为 Markdown", "POST",
                               "/fileToMarkdown",
                               _schema(sessionId=("string", True), file=("path", True),
                                       output=("path", True), force=("boolean", False)),
                               "MarkdownConversionResult",
                               notes=["只转换并写入本地 output，不上传知识库、不构建"]),
    "build from-doc": _contract("build from-doc", "将 Markdown 文本写入知识库并立即构建", "GET",
                                "/buildKnowledgeFromDoc",
                                _schema(sessionId=("string", True), resourceId=("string", True),
                                        directory=("string", False), docName=("string", False),
                                        doc=("string", False), docFile=("path", False),
                                        language=("string", False)),
                                "BuildKnowledgeFromDocResult",
                                notes=["doc 与 docFile 必须且只能提供一个；directory 默认为 /"]),
    "build result": _contract("build result", "查询文件完整构建结果", "POST", "/buildResult",
                              _schema(sessionId=("string", True), resourceId=("string", True),
                                      path=("string", True), chunkPage=("integer", False),
                                      chunkPageSize=("integer", False), includeMarkdown=("boolean", False)),
                              "KnowledgeBuildResult"),
    "build status": _contract("build status", "查询文件构建状态", "GET", "/fileBuildStatus",
                              _schema(sessionId=("string", True), resourceId=("string", True),
                                      path=("string", True)), "ProcessStatus"),
    "search chunks": _contract("search chunks", "Chunk 级知识检索", "POST", "/knowledgeItems/search",
                               _search_schema(),
                               "KnowledgeSearchResult"),
    "search files": _contract("search files", "文件级语义检索", "POST", "/knowledgeItems/searchFile",
                              _search_schema(),
                              "KnowledgeFileSearchResult"),
    "search metadata": _contract("search metadata", "文件元数据检索", "POST", "/knowledgeItems/metadataSearch",
                                 _schema(sessionId=("string", True), input=("KnowledgeMetadataSearchRequest", True)),
                                 "KnowledgeMetadataSearchResult"),
}


def get_contract(group: str, action: str) -> dict:
    return deepcopy(CONTRACTS[f"{group} {action}"])


def list_contracts() -> list[dict]:
    return [deepcopy(CONTRACTS[key]) for key in sorted(CONTRACTS)]


def help_epilog(contract: dict) -> str:
    return (
        "Output contract:\n"
        f"  JSON envelope: ok, operation, data, meta\n"
        f"  data: {contract['output']['dataType']}\n"
        f"  Inspect full schema: kbcli describe {contract['command']} --format json"
    )
