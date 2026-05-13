package com.iwhalecloud.byai.manager.infrastructure.embedding.config;

import lombok.Getter;
import lombok.Setter;

/**
 * @author xuweibin
 * @create 2023/12/11 16:40 faas相关配置
 */
@Getter
@Setter
public class FaasConfig {
    /**
     * 知识拆分清洗url
     */
    private String segmentationUrl;

    private String embeddingUrl;

    private String segmentationNewUrl;

    /**
     * 文件转换服务url
     */
    private String convertFileUrl;

    /**
     * 获取图片url
     */
    private String getImageUrl;

    /**
     * 获取文档url
     */
    private String docReadUrl;

    /**
     * 获取docchain 文档摘要是否生成完成
     */
    private String summaryState;

    // 切分参数模板信息接口url
    private String splitParamsUrl;

    // 异步切分参数模板信息接口url
    private String segmentationAsyncUrl;

    // 用户名，需校验版本必须参数
    private String username;

    // 用户密码，需校验版本必须参数（base64)
    private String password;

    // 获取token url，需校验版本必须参数
    private String tokenUrl;

    // 校验 token url，需校验版本必须参数
    private String checkTokenUrl;

    // 混合召回接口，对接马驰
    private String knowledgeQueryUrl;

    // 全文、语义召回接口，对接马驰
    private String knowledgeSimpleQueryUrl;

    // 召回接口，对接马驰
    private String enhancementAsyncUrl;

    // 查询增强状态接口，对接马驰
    private String enhancementStatusUrl;

    // 大模型问答切分接口
    private String qaLLmSplitUrl;

    // es服务接口
    private String chunkRetrieverApiUrl;

    // es服务token
    private String chunkRetrieverApiKey;

    // 增强sdk默认重排模型
    private String rerankerModel;

    // 增强sdk默认token
    private String rerankerApiKey;

    // 增强sdk默认接口
    private String rerankerApiUrl;

}
