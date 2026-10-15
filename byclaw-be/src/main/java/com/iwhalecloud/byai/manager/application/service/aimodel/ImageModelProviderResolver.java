package com.iwhalecloud.byai.manager.application.service.aimodel;

import java.util.Locale;

/** 图片配置允许省略提供商，但保存给旧运行端的元数据仍需包含可确定的提供商。 */
final class ImageModelProviderResolver {

    private ImageModelProviderResolver() {
    }

    static String resolve(String providerName, String modelProtocol) {
        // 已填写的提供商（包括旧别名和自定义值）原样保留，不能按协议覆盖。
        if (providerName != null && !providerName.isBlank()) {
            return providerName;
        }
        if (modelProtocol == null) {
            return null;
        }
        String protocol = modelProtocol.trim().toUpperCase(Locale.ROOT).replace('-', '_').replace(' ', '_');
        // 仅匹配已知图片协议；Qwen、OpenAI 等通用协议不能唯一确定图片提供商。
        return switch (protocol) {
            case "COMFY_IMAGE" -> "COMFYUI";
            case "DEEPINFRA_IMAGE" -> "DEEPINFRA";
            case "FAL_IMAGE" -> "FAL";
            case "GOOGLE_IMAGE" -> "GOOGLE";
            case "LITELLM_IMAGE" -> "LITELLM";
            case "MICROSOFT_FOUNDRY_IMAGE" -> "MICROSOFT_FOUNDRY";
            case "MINIMAX_IMAGE" -> "MINIMAX";
            case "OPENAI_IMAGE" -> "OPENAI";
            case "OPENROUTER_IMAGE" -> "OPENROUTER";
            case "VYDRA_IMAGE" -> "VYDRA";
            case "XAI_IMAGE" -> "XAI";
            case "VOLCENGINE_IMAGE" -> "VOLCENGINE";
            default -> null;
        };
    }
}
