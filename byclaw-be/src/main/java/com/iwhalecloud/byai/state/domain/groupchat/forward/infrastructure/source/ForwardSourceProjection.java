package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.util.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;

/** Bounded transient projection shared by owning Java rows and authenticated Node replies. */
public final class ForwardSourceProjection {
    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());
    private ForwardSourceProjection() { }
    public static Map<String,Object> map(String value) {
        if (value == null || value.isBlank()) return Map.of();
        if (value.length() > 1048576) throw unresolved();
        try { return JSON.parseObject(value); } catch (RuntimeException error) { throw unresolved(); }
    }
    public static List<Map<String,Object>> entries(Object value) { return entries(value,100); }
    public static List<Map<String,Object>> references(Object value) { return entries(value,Integer.MAX_VALUE); }
    private static List<Map<String,Object>> entries(Object value,int maximum) {
        if (value == null) return List.of();
        if (value instanceof String text) { if (text.length() > 1048576) throw unresolved(); value=JSON.parse(text); }
        if (!(value instanceof List<?> list) || list.size() > maximum) throw unresolved();
        return list.stream().map(entry -> { if (!(entry instanceof Map<?,?> map)) throw unresolved(); return safeEntry(stringMap(map)); }).toList();
    }
    /** A surviving checkpoint is historical evidence only for the exact publication generation and uploaded path. */
    public static List<Map<String,Object>> publicationFiles(
            com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication publication,
            com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication pending) {
        var files=entries(publication.getFilesJson());
        if(pending==null || publication.getPendingPublicationId()==null || !publication.getPendingPublicationId().equals(pending.getPendingPublicationId())
            || !publication.getTaskSessionId().equals(pending.getTaskSessionId()) || pending.getCloudResourceId()==null) return files;
        String cloud=Long.toString(id(pending.getCloudResourceId()));
        var uploaded=map(pending.getUploadedFilesJson());if(uploaded.size()>100) throw unresolved();
        var checkpointFiles=uploaded.values().stream().flatMap(value -> entries(value).stream()).toList();
        if(checkpointFiles.size()>100) throw unresolved();
        return files.stream().map(file -> {
            if(file.containsKey("cloudResourceId")) return file;
            var matches=checkpointFiles.stream().filter(candidate -> Objects.equals(file.get("filePath"),candidate.get("filePath"))
                && (candidate.get("cloudResourceId")==null || cloud.equals(candidate.get("cloudResourceId")))).toList();
            if(matches.size()!=1) return file;
            var resolved=new LinkedHashMap<>(file);resolved.put("cloudResourceId",cloud);return Collections.unmodifiableMap(resolved);
        }).toList();
    }
    public static SourceMessage fromNode(com.fasterxml.jackson.databind.JsonNode node, ForwardActor actor) {
        if (node == null || node.toString().length() > 2097152) throw unresolved();
        try {
            SourceAuthority authority = MAPPER.treeToValue(node.path("authority"), SourceAuthority.class);
            if (!authority.actor().equals(actor) || authority.backend() != ForwardBackend.TENANT) throw unresolved();
            SourceMessage source = MAPPER.treeToValue(node, SourceMessage.class);
            List<SourceMessage> children = new ArrayList<>();
            for (var child : node.path("mergedItems")) children.add(fromNode(child, actor));
            return new SourceMessage(source.id(), source.timelineOrdinal(), source.content(), source.speaker(), source.createdAt(),
                source.resourceList(), source.relatedResources(), source.metadata(), children, authority);
        } catch (Exception error) { throw unresolved(); }
    }
    public static ForwardUploadedFile object(Object raw) {
        try { return MAPPER.convertValue(raw, ForwardUploadedFile.class); } catch (RuntimeException error) { throw unresolved(); }
    }
    public static ForwardSpeaker speaker(String json) {
        try { return MAPPER.readValue(json, ForwardSpeaker.class); } catch (Exception error) { throw unresolved(); }
    }
}
