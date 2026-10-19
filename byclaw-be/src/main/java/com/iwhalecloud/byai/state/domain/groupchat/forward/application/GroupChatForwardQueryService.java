package com.iwhalecloud.byai.state.domain.groupchat.forward.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardSourceRead;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardRuntimeProjection;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.ItemPage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.util.function.Consumer;

/** Target snapshot records are read in a short owning-store transaction. */
@Service
public class GroupChatForwardQueryService {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final TenantGroupForwardService tenant;
    private final ForwardPlatformPolicy policy;

    public GroupChatForwardQueryService(JdbcTemplate db, PlatformTransactionManager manager, ObjectMapper json,
        TenantGroupForwardService tenant, ForwardPlatformPolicy policy) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.json=json; this.tenant=tenant; this.policy=policy;
    }
    private boolean tenant(ForwardActor actor) {
        var context=TenantRequestContextHolder.get();
        if(context==null) { policy.requireNewWork(actor,ForwardBackend.LEGACY); return false; }
        if(context.userId()!=actor.userId() || context.enterpriseId()!=actor.enterpriseId()) throw denied();
        return true;
    }
    private static IllegalArgumentException denied() { return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"); }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("FORWARD_INVALID_REQUEST"); }
    private JsonNode parse(String value) {
        try { var node=json.readTree(value); if(node==null)throw denied(); return node; }
        catch(Exception error) { throw denied(); }
    }
    private record Bound(ForwardItem item, long target, int version, JsonNode checkpoint) { }
    private List<Bound> bound(ForwardActor actor,long group,long message) {
        if(group<=0 || message<=0) throw invalid();
        return tx.execute(status -> {
            var current=db.queryForList("SELECT s.session_id FROM byai.byai_session s JOIN byai.byai_message m ON m.session_id=s.session_id AND m.enterprise_id=s.enterprise_id WHERE s.session_id=? AND s.enterprise_id=? AND s.session_type='hs_as' AND (s.state IS NULL OR s.state NOT IN ('CLOSED','GROUP_DISSOLVED','GROUP_CHAT_ROUTING','GROUP_CHAT_DISPATCH')) AND m.message_id=? AND m.usage IN (1,2) AND m.recalled_at IS NULL AND m.archived_at IS NULL AND EXISTS(SELECT 1 FROM byai.byai_session_member u WHERE u.session_id=s.session_id AND u.mem_obj_type='USER' AND u.mem_obj_id=?)",group,actor.enterpriseId(),message,actor.userId());
            if(current.size()!=1) throw denied();
            // The successful branch and actual outer message bind the item; source provenance is passive data only.
            var found=db.query("SELECT i.*,t.checkpoint_json,t.message_ids_json,r.snapshot_version FROM byai.byai_group_chat_forward_item i JOIN byai.byai_group_chat_forward_target t ON t.enterprise_id=i.enterprise_id AND t.target_id=i.target_id AND t.request_id=i.request_id JOIN byai.byai_group_chat_forward_request r ON r.enterprise_id=t.enterprise_id AND r.request_id=t.request_id WHERE i.enterprise_id=? AND t.target_session_id=? AND i.bound_message_id=? AND t.state='SUCCEEDED' AND r.backend='LEGACY' ORDER BY i.ordinal,i.item_id LIMIT 101",(rs,index)->{
                var ids=parse(rs.getString("message_ids_json")); boolean contains=false;
                if(ids.isArray())for(var id:ids)if(id.isTextual() && Long.toString(message).equals(id.textValue()))contains=true;
                if(!contains)throw denied();
                var speaker=parse(rs.getString("speaker_json"));
                var refs=json.createObjectNode(); refs.set("resourceList",parse(rs.getString("references_json")));
                var rawAttachments=parse(rs.getString("attachments_json")); if(!rawAttachments.isArray() || rawAttachments.size()>100)throw denied();
                List<ForwardAttachment> attachments=new ArrayList<>();
                for(var a:rawAttachments) attachments.add(json.convertValue(a,ForwardAttachment.class));
                var item=new ForwardItem(rs.getString("item_id"),rs.getLong("selected_message_id"),rs.getBoolean("selected_merged_card"),rs.getLong("source_message_id"),rs.getInt("ordinal"),rs.getString("content"),new ForwardSpeaker(SpeakerType.valueOf(speaker.path("type").asText()),speaker.path("id").asText(),speaker.path("name").asText()),rs.getTimestamp("source_created_at").toInstant().toString(),ForwardRuntimeProjection.references(refs),attachments);
                return new Bound(item,rs.getLong("target_id"),rs.getInt("snapshot_version"),parse(rs.getString("checkpoint_json")));
            },actor.enterpriseId(),group,message);
            if(found.isEmpty() || found.size()>100 || found.stream().anyMatch(b->b.target()!=found.getFirst().target() || b.version()!=found.getFirst().version()))throw denied();
            return found;
        });
    }
    public ItemPage items(ForwardActor actor,long targetSessionId,long messageId,Integer requestedSize,String cursor) {
        int size=requestedSize==null?20:requestedSize;
        if(size<1 || size>100)throw invalid();
        if(tenant(actor))return tenant.items(actor,targetSessionId,messageId,size,cursor);
        var rows=bound(actor,targetSessionId,messageId); int offset=0;
        if(cursor!=null) {
            if(!cursor.matches("[A-Za-z0-9_-]{1,512}"))throw invalid();
            JsonNode value;
            try { value=json.readTree(Base64.getUrlDecoder().decode(cursor)); }
            catch(Exception error) { throw invalid(); }
            if(!value.isArray() || value.size()!=7 || !value.get(0).isInt() || value.get(0).intValue()!=1)throw invalid();
            if(!Long.toString(actor.enterpriseId()).equals(value.get(1).asText()) || !Long.toString(targetSessionId).equals(value.get(2).asText()) || !Long.toString(messageId).equals(value.get(3).asText()) || !value.get(4).isInt() || value.get(4).intValue()!=rows.getFirst().version())throw denied();
            int index=-1; for(int i=0;i<rows.size();i++)if(value.get(5).isInt() && rows.get(i).item().ordinal()==value.get(5).intValue() && rows.get(i).item().itemId().equals(value.get(6).asText()))index=i;
            if(index<0)throw denied(); offset=index+1;
        }
        var page=rows.subList(offset,Math.min(rows.size(),offset+size)); boolean more=offset+size<rows.size(); String next=null;
        if(more) {
            var last=page.getLast();
            try { next=Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(List.of(1,Long.toString(actor.enterpriseId()),Long.toString(targetSessionId),Long.toString(messageId),last.version(),last.item().ordinal(),last.item().itemId()))); }
            catch(Exception error) { throw new IllegalStateException("FORWARD_ENCODING_FAILED",error); }
        }
        return new ItemPage(page.stream().map(Bound::item).toList(),size,more,next);
    }
}
