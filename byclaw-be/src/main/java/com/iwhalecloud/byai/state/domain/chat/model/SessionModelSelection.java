package com.iwhalecloud.byai.state.domain.chat.model;

import java.util.LinkedHashMap;
import java.util.Map;

import lombok.Getter;
import lombok.Setter;

/**
 * 一轮对话实际使用的模型（用户会话级选择，或回退到数字员工配置模型/系统默认模型）。
 *
 * <p>该对象既用于写入 Redis 会话级覆盖键，也用于写入助手消息 metadata 的 {@code usedModel} 字段，
 * 因此字段名与前端角标读取的键保持一致。
 *
 * <p>作为 Redis 会话覆盖记录时是「双轴」结构：模型轴字段只在用户显式选择模型时存在，
 * 档位轴字段（{@code thinkingLevel}/{@code thinkingSource}）每轮写入最终档位；
 * 两轴可在同一键内独立清除，互不误删。
 */
@Getter
@Setter
public class SessionModelSelection {

    /** 模型主键（byai_aimodel.model_id），同时是 Redis byai:aimodel:config 的 hash field。 */
    private String modelId;

    /** 模型编码，运行时调用使用。 */
    private String modelCode;

    /** 展示名称，角标显示使用；缺失时回退 modelCode。 */
    private String modelName;

    /** 服务商名称，可空。 */
    private String providerName;

    /** 本轮实际使用的思考强度档位；词表见 SessionModelSelectionService.THINKING_LEVELS。 */
    private String thinkingLevel;

    /** 档位来源：session=用户显式选择（可作为下一轮覆盖候选），model_default=模型配置默认，off=关闭。 */
    private String thinkingSource;

    /** Redis 中会话运行状态的单调版本，仅在有效确认发生变化时递增。 */
    private Long revision;

    public SessionModelSelection() {
    }

    public SessionModelSelection(String modelId, String modelCode, String modelName, String providerName) {
        this.modelId = modelId;
        this.modelCode = modelCode;
        this.modelName = modelName;
        this.providerName = providerName;
    }

    /**
     * 转换为助手消息 metadata 中的 usedModel 结构。
     *
     * @return 可被 JSON 序列化的有序 Map
     */
    public Map<String, Object> toMetadata() {
        Map<String, Object> metadata = new LinkedHashMap<>(6);
        metadata.put("id", modelId);
        metadata.put("code", modelCode);
        metadata.put("name", modelName);
        metadata.put("provider", providerName);
        metadata.put("thinkingLevel", thinkingLevel);
        return metadata;
    }
}
