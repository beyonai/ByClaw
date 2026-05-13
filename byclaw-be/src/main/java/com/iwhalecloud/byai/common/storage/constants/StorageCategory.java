package com.iwhalecloud.byai.common.storage.constants;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 存储类别枚举 定义不同类型的文件存储路径模板和描述
 *
 * @author hux
 * @date 2025-08-26
 */
@Getter
@AllArgsConstructor
public enum StorageCategory {
    /**
     * 各类资源图标
     */
    ICON("/icon/user_{userId}/{date}", "各类资源图标"),

    /**
     * 上传的图片和媒体文件
     */
    CHAT_FILE("/chat/user_{userId}/file/{date}", "上传的图片和媒体文件"),

    /**
     * 上传的图片和媒体文件
     */
    CHAT_PICTURE("/chat/user_{userId}/picture/{date}", "上传的图片和媒体文件"),

    /**
     * 普通文件，无业务标识的文件
     */
    FILE("/file/user_{userId}/{date}", "普通文件，无业务标识的文件"),

    /**
     * 知识库文档、图片等资源文件
     */
    DATASET("/byai/{datasetId}/file/{fileId}", "知识库文档、图片等资源文件"),

    /**
     * 工作流配置和相关文件
     */
    SCRIPT_APP("/script/app/{appId}", "工作流配置和相关文件"),

    /**
     * 工作流配置和相关文件
     */
    SCRIPT_TEMPLATE("/script/template/{scriptId}", "工作流配置和相关文件"),

    /**
     * 会话聊天记录和临时文件
     */
    SESSION("/sessions/{chatId}/{type}", "会话聊天记录和临时文件"),

    /**
     * 搜索文件
     */
    SEARCH_FILE("/sessions/{sessionId}/{requestId}", "搜索文件"),

    /**
     * 搜问导入文件
     */
    SEARCH_IMPORT("/sessions/{sessionId}/{fileId}", "搜问导入"),

    /**
     * 超级助手会话导入文件
     */
    SESSION_IMPORT("/.sessions/{sessionId}", "会话导入文件");

    /**
     * 路径模板
     */
    private final String pathTemplate;

    /**
     * 描述信息
     */
    private final String description;
}
