package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Candidate data selects an owning association; no URL, author or opaque key grants file access. */
public final class ForwardSourceFacts {
    private ForwardSourceFacts() { }
    public static IllegalArgumentException unresolved() { return new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE"); }
    public static String text(Object value) { return value == null ? null : value instanceof String || value instanceof Number ? value.toString() : null; }
    public static long id(Object value) {
        String text = text(value);
        if (text == null || !text.matches("[1-9][0-9]{0,18}")) throw unresolved();
        try { return Long.parseLong(text); } catch (NumberFormatException error) { throw unresolved(); }
    }
    public static Map<String,Object> association(ForwardActor actor, SourceMessage source, SourceCandidate candidate) {
        var authority = source.authority(); var address = candidate.address();
        if (authority == null || !authority.actor().equals(actor) || address == null
            || candidate.selectedMessageId() != authority.selectedMessageId()
            || !Objects.equals(address.currentItemId(), authority.currentItemId())) throw unresolved();
        if (address.origin() == CandidateAddress.Origin.RESOURCE_REFERENCE) {
            var found = source.resourceList().stream().filter(ref -> Objects.equals(text(ref.get("id")), address.key())
                || ref.get("id") == null && Objects.equals(text(ref.get("resourceType")) + "_" + text(ref.get("resourceId")), address.key())).toList();
            if (found.size() != 1) throw unresolved();
            return found.getFirst();
        }
        Object raw = (address.origin() == CandidateAddress.Origin.RELATED_FILE ? source.relatedResources() : source.metadata()).get("files");
        if (!(raw instanceof List<?> entries) || !address.key().matches("0|[1-9][0-9]{0,3}")) throw unresolved();
        int index = Integer.parseInt(address.key());
        if (index >= entries.size() || !(entries.get(index) instanceof Map<?,?> map)) throw unresolved();
        return stringMap(map);
    }
    public static Map<String,Object> stringMap(Map<?,?> map) {
        Map<String,Object> result = new LinkedHashMap<>();
        map.forEach((key,value) -> { if (!(key instanceof String)) throw unresolved(); result.put((String) key, value); });
        return result;
    }
    public static String path(String value) {
        if (value == null || value.isBlank() || value.length() > 4096 || value.contains(":") || value.contains("?") || value.contains("#")
            || value.indexOf('%') >= 0 || value.chars().anyMatch(Character::isISOControl)) throw unresolved();
        String normalized = value.replace('\\','/').replaceAll("/+", "/");
        for (String part : normalized.split("/")) if (part.equals("..") || part.equals(".")) throw unresolved();
        if (!normalized.startsWith("/")) normalized = "/" + normalized;
        if (normalized.equals("/") || normalized.endsWith("/")) throw unresolved();
        return normalized;
    }
    public static String workspacePath(String value) {
        String result = path(value);
        return result.startsWith("/by/") ? result : "/by" + result;
    }
    /** Existing upload records store a relative preview route with an explicit bucket/path pair. */
    public static String uploadPath(String value, String bucket) {
        if (value != null && value.startsWith("/commonFile/preview?")) {
            URI uri = URI.create(value); Map<String,String> query = new HashMap<>();
            for (String part : uri.getRawQuery().split("&")) {
                String[] entry = part.split("=",2);
                if (entry.length != 2 || query.put(entry[0], URLDecoder.decode(entry[1], StandardCharsets.UTF_8)) != null) throw unresolved();
            }
            if (!bucket.equals(query.get("bucketName"))) throw unresolved();
            return workspacePath(query.get("filePath"));
        }
        return workspacePath(value);
    }
    /** Preserve only stable selector fields. Raw resourceCode can contain credentials and must not cross stores. */
    public static Map<String,Object> safeEntry(Map<String,Object> raw) {
        Map<String,Object> safe = new LinkedHashMap<>();
        for (String field : List.of("id", "resourceId", "resourceName", "resourceType", "attachmentId", "fileId", "fileName", "filePath", "directoryPath", "datasetId", "cloudResourceId")) {
            String value = text(raw.get(field)); if (value != null && value.length() <= 4096) safe.put(field, value);
        }
        Object code = raw.get("resourceCode");
        if (code instanceof String text && text.length() <= 16384 && text.startsWith("{")) {
            try { Map<String,Object> parsed = JSON.parseObject(text); for (String field : List.of("datasetId", "directoryPath")) {
                String value = text(parsed.get(field)); if (value != null && value.length() <= 4096) safe.putIfAbsent(field, value);
            } } catch (RuntimeException ignored) { /* Malformed hints never authorize a source. */ }
        }
        return Collections.unmodifiableMap(safe);
    }
}
