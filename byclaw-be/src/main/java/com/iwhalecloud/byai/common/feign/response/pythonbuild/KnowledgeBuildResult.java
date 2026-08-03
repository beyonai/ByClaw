package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 知识库文件构建结果，包括 Markdown、分块和向量/检索摘要。
 *
 * @author qin.guoquan
 * @date 2026-08-03 19:38:38
 */
@Getter
@Setter
public class KnowledgeBuildResult {

    private String knCode;
    private String filePath;
    private String fileName;
    private String fileType;
    private Long fileSize;
    private String mimeType;
    private BuildInfo build;
    private MarkdownInfo markdown;
    private ChunkPage chunks;
    private EmbeddingInfo embedding;
    private RetrievalInfo retrieval;

    @Getter
    @Setter
    public static class BuildInfo {
        private String status;
        private String currentStep;
        private String errorMessage;
        private String startedAt;
        private String finishedAt;
        private Long durationMs;
        private List<StatusDict> statusDict;
        private List<StepDict> stepDict;
    }

    @Getter
    @Setter
    public static class MarkdownInfo {
        private Boolean available;
        private String data;
        private Integer lineCount;
        private Integer characterCount;
        private Integer byteCount;
    }

    @Getter
    @Setter
    public static class ChunkPage {
        private List<ChunkInfo> data;
        private Integer page;
        private Integer pageSize;
        private Integer total;
        private Boolean reachedEof;
    }

    @Getter
    @Setter
    public static class ChunkInfo {
        private Integer chunkNo;
        private Integer startLine;
        private Integer endLine;
        private String content;
        private Integer characterCount;
        private Boolean hasEmbedding;
        private Boolean retrievalIndexed;
    }

    @Getter
    @Setter
    public static class EmbeddingInfo {
        private Integer dimension;
        private Integer embeddedChunkCount;
        private Double coverageRate;
    }

    @Getter
    @Setter
    public static class RetrievalInfo {
        private Integer indexedChunkCount;
        private Double coverageRate;
    }
}
