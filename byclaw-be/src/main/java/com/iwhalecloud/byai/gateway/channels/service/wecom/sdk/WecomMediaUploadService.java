package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;

/**
 * Three-step WeCom media upload over the long connection, ported from the
 * reference SDK {@code client.ts uploadMedia}: {@code aibot_upload_media_init}
 * → {@code aibot_upload_media_chunk} × N → {@code aibot_upload_media_finish}.
 *
 * <p>Constraints (plan §Task 11): chunk ≤ 512KB (pre-base64), ≤ 100 chunks
 * (~50MB), MD5 sent in init, dynamic concurrency (≤4 all-parallel, 5-10 → 3,
 * &gt;10 → 2) to avoid the server "system error" on many parallel chunks,
 * per-chunk retry 2× with {@code 500*(attempt+1)}ms backoff. Every frame uses a
 * FRESH req_id (not a callback req_id) and goes through the per-connection
 * {@link WecomReplyQueue} so sends are serialized behind their ACKs.
 *
 * <p>chunk_index base: the reference SDK type comment says "from 1" but the
 * runtime sends 0-based. This uses 0-based (matching the runtime) but exposes
 * {@link #setChunkIndexBase(int)} until the server contract is confirmed.
 */
public class WecomMediaUploadService {

    private static final Logger logger = LoggerFactory.getLogger(WecomMediaUploadService.class);

    private static final int CHUNK_SIZE = 512 * 1024;
    private static final int MAX_CHUNKS = 100;
    private static final int MAX_CHUNK_RETRIES = 2;

    private final ObjectMapper objectMapper;
    private final WecomReplyQueue replyQueue;
    private final ExecutorService uploadExecutor;
    private int chunkIndexBase = 0;

    public WecomMediaUploadService(ObjectMapper objectMapper,
                                   WecomReplyQueue replyQueue,
                                   ExecutorService uploadExecutor) {
        this.objectMapper = objectMapper;
        this.replyQueue = replyQueue;
        this.uploadExecutor = uploadExecutor;
    }

    /** Override the chunk_index base (0 or 1) once the server contract is confirmed. */
    public void setChunkIndexBase(int base) {
        this.chunkIndexBase = base;
    }

    public static final class UploadResult {
        public final String type;
        public final String mediaId;

        UploadResult(String type, String mediaId) {
            this.type = type;
            this.mediaId = mediaId;
        }
    }

    /**
     * Upload a file and return its {@code media_id} (3-day validity).
     *
     * @param type file/image/voice/video
     * @param filename display filename
     * @param bytes file bytes (≤ ~50MB)
     */
    public UploadResult upload(String type, String filename, byte[] bytes) throws Exception {
        int totalSize = bytes.length;
        int totalChunks = (int) Math.ceil((double) totalSize / CHUNK_SIZE);
        if (totalChunks == 0) {
            totalChunks = 1;
        }
        if (totalChunks > MAX_CHUNKS) {
            throw new IllegalArgumentException(
                    "File too large: " + totalChunks + " chunks exceeds max " + MAX_CHUNKS);
        }
        String md5 = md5Hex(bytes);

        // Step 1: init
        String uploadId = doInit(type, filename, totalSize, totalChunks, md5);

        // Step 2: chunks with dynamic concurrency + retry
        uploadChunks(uploadId, bytes, totalSize, totalChunks);

        // Step 3: finish
        return doFinish(uploadId, type);
    }

    private String doInit(String type, String filename, int totalSize, int totalChunks, String md5)
            throws Exception {
        String reqId = WecomWsClient.generateReqId(WecomWsCmd.UPLOAD_MEDIA_INIT);
        ObjectNode frame = baseFrame(WecomWsCmd.UPLOAD_MEDIA_INIT, reqId);
        ObjectNode body = frame.putObject("body");
        body.put("type", type);
        body.put("filename", filename);
        body.put("total_size", totalSize);
        body.put("total_chunks", totalChunks);
        body.put("md5", md5);

        WecomWsFrame ack = replyQueue.send(reqId, frame.toString()).get();
        String uploadId = ack.getBody() == null ? null : ack.getBody().path("upload_id").asText(null);
        if (uploadId == null || uploadId.isBlank()) {
            throw new IllegalStateException("Upload init failed: no upload_id returned");
        }
        return uploadId;
    }

    private void uploadChunks(String uploadId, byte[] bytes, int totalSize, int totalChunks)
            throws Exception {
        int concurrency = totalChunks <= 4 ? totalChunks : (totalChunks <= 10 ? 3 : 2);
        if (totalChunks <= 1) {
            uploadOneChunk(uploadId, bytes, totalSize, 0);
            return;
        }

        // Bounded concurrency via a simple worker pool over a shared index.
        java.util.concurrent.atomic.AtomicInteger next = new java.util.concurrent.atomic.AtomicInteger(0);
        List<CompletableFuture<Void>> workers = new ArrayList<>();
        List<Exception> errors = new java.util.concurrent.CopyOnWriteArrayList<>();
        for (int w = 0; w < concurrency; w++) {
            workers.add(CompletableFuture.runAsync(() -> {
                int idx;
                while ((idx = next.getAndIncrement()) < totalChunks) {
                    try {
                        uploadOneChunk(uploadId, bytes, totalSize, idx);
                    } catch (Exception e) {
                        errors.add(e);
                        return;
                    }
                }
            }, uploadExecutor));
        }
        CompletableFuture.allOf(workers.toArray(new CompletableFuture[0])).join();
        if (!errors.isEmpty()) {
            throw new IllegalStateException(
                    "Upload failed: " + errors.size() + " chunk(s) failed. First: " + errors.get(0).getMessage());
        }
    }

    private void uploadOneChunk(String uploadId, byte[] bytes, int totalSize, int chunkIndex)
            throws Exception {
        int start = chunkIndex * CHUNK_SIZE;
        int end = Math.min(start + CHUNK_SIZE, totalSize);
        byte[] chunk = new byte[end - start];
        System.arraycopy(bytes, start, chunk, 0, end - start);
        String base64 = Base64.getEncoder().encodeToString(chunk);

        Exception last = null;
        for (int attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
            try {
                String reqId = WecomWsClient.generateReqId(WecomWsCmd.UPLOAD_MEDIA_CHUNK);
                ObjectNode frame = baseFrame(WecomWsCmd.UPLOAD_MEDIA_CHUNK, reqId);
                ObjectNode body = frame.putObject("body");
                body.put("upload_id", uploadId);
                body.put("chunk_index", chunkIndexBase + chunkIndex);
                body.put("base64_data", base64);
                replyQueue.send(reqId, frame.toString()).get();
                return;
            } catch (Exception e) {
                last = e;
                if (attempt < MAX_CHUNK_RETRIES) {
                    Thread.sleep(500L * (attempt + 1));
                }
            }
        }
        throw new IllegalStateException("Chunk " + chunkIndex + " upload failed after "
                + (MAX_CHUNK_RETRIES + 1) + " attempts", last);
    }

    private UploadResult doFinish(String uploadId, String type) throws Exception {
        String reqId = WecomWsClient.generateReqId(WecomWsCmd.UPLOAD_MEDIA_FINISH);
        ObjectNode frame = baseFrame(WecomWsCmd.UPLOAD_MEDIA_FINISH, reqId);
        frame.putObject("body").put("upload_id", uploadId);

        WecomWsFrame ack = replyQueue.send(reqId, frame.toString()).get();
        String mediaId = ack.getBody() == null ? null : ack.getBody().path("media_id").asText(null);
        if (mediaId == null || mediaId.isBlank()) {
            throw new IllegalStateException("Upload finish failed: no media_id returned");
        }
        String resolvedType = ack.getBody().path("type").asText(type);
        return new UploadResult(resolvedType, mediaId);
    }

    private ObjectNode baseFrame(String cmd, String reqId) {
        ObjectNode frame = objectMapper.createObjectNode();
        frame.put("cmd", cmd);
        frame.putObject("headers").put("req_id", reqId);
        return frame;
    }

    private String md5Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
