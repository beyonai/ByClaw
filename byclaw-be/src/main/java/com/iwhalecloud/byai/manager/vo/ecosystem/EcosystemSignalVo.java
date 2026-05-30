package com.iwhalecloud.byai.manager.vo.ecosystem;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 生态采集分层信号。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EcosystemSignalVo {

    /**
     * 信号类型，例如 source、object、topic、privacy。
     */
    private String signalType;

    /**
     * 信号类型展示名称。
     */
    private String signalTypeName;

    /**
     * 信号编码，用于检索、聚类和去重。
     */
    private String signalCode;

    /**
     * 信号展示名称。
     */
    private String signalName;

    /**
     * 信号置信度，用户手工标注通常高于规则推断。
     */
    private Double confidence;

    /**
     * 信号来源，例如 user、rule、connector。
     */
    private String source;
}
