package com.iwhalecloud.byai.manager.vo.ecosystem;

import java.util.Date;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 生态采集运行视图。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemRunVo {

    /**
     * 一次采集运行 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long runId;

    /**
     * 归属的采集任务 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;

    /**
     * 运行状态，例如 CREATED、SUCCESS、FAILED、SKIPPED。
     */
    private String status;

    /**
     * 当前所在流水线步骤编码。
     */
    private String currentStep;

    /**
     * 本次采集识别到的总条目数。
     */
    private Integer totalCount;

    /**
     * 本次生成的 Markdown 数量。
     */
    private Integer markdownCount;

    /**
     * 本次归档的图片、附件等资产数量。
     */
    private Integer assetCount;

    /**
     * 本次失败条目数。
     */
    private Integer failedCount;

    /**
     * 需要用户处理的动作类型，例如 LOGIN_REQUIRED、BROWSER_BRIDGE_REQUIRED。
     */
    private String needActionType;

    /**
     * 需要用户处理时展示的提示信息。
     */
    private String needActionMessage;

    /**
     * 用户处理动作的状态，例如 ACKED、SKIPPED。
     */
    private String needActionStatus;

    /**
     * 本次采集产物的对象存储路径前缀。
     */
    private String storagePath;

    /**
     * 入库目标展示名称。
     */
    private String targetName;

    /**
     * 运行开始时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date startedAt;

    /**
     * 运行结束时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date finishedAt;

    /**
     * 流水线步骤明细。
     */
    private List<StepVo> steps;

    /**
     * 本次采集落地的产物清单。
     */
    private List<ArtifactVo> artifacts;

    /**
     * 本次采集关联的分层信号。
     */
    private List<EcosystemSignalVo> signals;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StepVo {

        /**
         * 步骤编码，例如 CONNECT_SOURCE、PULL_RAW、IMPORT_KNOWLEDGE。
         */
        private String stepCode;

        /**
         * 步骤展示名称。
         */
        private String stepName;

        /**
         * 步骤状态编码。
         */
        private String status;

        /**
         * 步骤状态展示名称。
         */
        private String statusName;

        /**
         * 步骤执行说明或失败原因。
         */
        private String message;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ArtifactVo {

        /**
         * 产物类型，MARKDOWN / ASSET / RAW / MANIFEST。
         */
        private String artifactType;

        /**
         * 产物展示名称。
         */
        private String artifactName;

        /**
         * 产物存储路径或文件访问地址。
         */
        private String storagePath;

        /**
         * 该产物包含的条目数量。
         */
        private Integer itemCount;

        /**
         * files 表中的文件 ID。
         */
        @JsonSerialize(using = ToStringSerializer.class)
        private Long fileId;

        /**
         * 文件存储访问地址。
         */
        private String fileUrl;

        /**
         * 文件 MIME 类型。
         */
        private String contentType;

        /**
         * 文件存储后端类型，例如 minio、local、ftp。
         */
        private String fileSystemType;

        /**
         * 原始来源链接。
         */
        private String sourceUrl;

        /**
         * 兼容旧调用方的轻量构造方法。
         */
        public ArtifactVo(String artifactType, String artifactName, String storagePath, Integer itemCount) {
            this.artifactType = artifactType;
            this.artifactName = artifactName;
            this.storagePath = storagePath;
            this.itemCount = itemCount;
        }
    }
}
