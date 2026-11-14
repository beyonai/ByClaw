package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.serializer.SerializerFeature;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
/** Shared business checks; persisted revisions, rather than UI state, decide whether a write is valid. */

public final class HumanTaskRules {

    private HumanTaskRules() {
    }

    public static void require(boolean condition, String code) {
        if (!condition) throw new ResponseStatusException(HttpStatus.CONFLICT, "HUMAN_TASK_" + code);
    }

    public static void writable(JSONObject task) {
        require(!"ACCEPTED".equals(task.getString("status")), "ACCEPTED");
    }

    public static void content(JSONObject body) {
        String text  =  body.getString("text");
        require(text != null && !text.isBlank() || body.getJSONArray("files") != null && !body.getJSONArray("files").isEmpty(), "CONTENT_REQUIRED");
    }

    public static void review(JSONObject task, JSONObject body) {
        require("PENDING_REVIEW".equals(task.getString("status")), "NOT_PENDING_REVIEW");
        require(Objects.equals(task.getString("latestSubmissionId"), body.getString("submissionId")) && body.containsKey("expectedRevision") && task.getLongValue("revision") == body.getLongValue("expectedRevision"), "STALE_VERSION");
        require("ACCEPT".equals(body.getString("decision")) || "RETURN".equals(body.getString("decision")), "INVALID_DECISION");
        require(!"RETURN".equals(body.getString("decision")) || body.getString("opinion") != null && !body.getString("opinion").isBlank(), "OPINION_REQUIRED");
    }

    public static String requestId(JSONObject body) {
        String value  =  body.getString("requestId");
        require(value != null && value.matches("[A-Za-z0-9:_-]{1,128}"), "REQUEST_ID_REQUIRED");
        return value;
    }

    public static Long id(JSONObject body, String key) {
        String value  =  body.getString(key);
        require(value != null && value.matches("[1-9][0-9]{0,18}"), "INVALID_" + key);
        try {
            return Long.valueOf(value);
        }
        catch (NumberFormatException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "HUMAN_TASK_INVALID_ID");
        }
    }

    public static String hash(Object object) {
        return hash(object, SerializerFeature.MapSortField);
    }

    /** Creation hashes include explicit absent source fields and only server-normalized business input. */
    public static String creationHash(JSONObject object) {
        return hash(object, SerializerFeature.MapSortField, SerializerFeature.WriteMapNullValue);
    }

    private static String hash(Object object, SerializerFeature... features) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(
            JSON.toJSONString(object, features).getBytes(StandardCharsets.UTF_8)));
        }
        catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
