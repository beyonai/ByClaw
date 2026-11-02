package com.iwhalecloud.byai.state.application.service.upload;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Policy from the existing global upload system parameter; each platform session snapshots its result. */
public record ResumableUploadPolicy(long maxSize, long chunkSize, long globalMaxSize) {
    public static final String CONFIG_CODE = "DIG_EMPLOYEE_FILE_UPLOAD_CONFIG";
    private static final long MB = 1024L * 1024;
    private static final ObjectMapper JSON = new ObjectMapper();

    public static ResumableUploadPolicy fromJson(String source) {
        try {
            JsonNode config = source == null || source.isBlank() ? JSON.createObjectNode() : JSON.readTree(source);
            if (config == null || !config.isObject()) throw new IllegalArgumentException("Upload config must be a JSON object");
            long max = positiveInteger(config, "resumableMaxFileSizeMB", 4096);
            long chunk = positiveInteger(config, "resumableChunkSizeMB", 4);
            if (chunk > 16 || max > Long.MAX_VALUE / MB) throw new IllegalArgumentException("Invalid resumable upload policy range");
            long global = config.path("maxFileSize").asLong(0);
            global = global > 0 && global <= Long.MAX_VALUE / MB ? global * MB : 0;
            return new ResumableUploadPolicy(max * MB, chunk * MB, global);
        } catch (IllegalArgumentException invalid) {
            throw invalid;
        } catch (Exception invalid) {
            throw new IllegalArgumentException("Invalid global upload configuration", invalid);
        }
    }

    private static long positiveInteger(JsonNode config, String field, long fallback) {
        JsonNode value = config.get(field);
        if (value == null) return fallback;
        if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() <= 0) {
            throw new IllegalArgumentException(field + " must be a positive integer");
        }
        return value.longValue();
    }

    public ResumableUploadPolicy effective(long technicalMax, long minChunk, long maxChunk, long maxChunks) {
        if (technicalMax <= 0 || minChunk <= 0 || maxChunk < minChunk || maxChunks <= 0) {
            throw new IllegalArgumentException("Invalid platform upload bounds");
        }
        long chunk = Math.max(minChunk, Math.min(chunkSize, maxChunk));
        long chunkBudget = chunk > Long.MAX_VALUE / maxChunks ? Long.MAX_VALUE : chunk * maxChunks;
        long max = Math.min(maxSize, Math.min(technicalMax, chunkBudget));
        if (globalMaxSize > 0) max = Math.min(max, globalMaxSize);
        return new ResumableUploadPolicy(max, chunk, globalMaxSize);
    }
}
