package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;

/** Rebuild normal references from destination uploads and replace source tokens exactly once. */
public final class ForwardUploadedFiles {
    private ForwardUploadedFiles() { }
    public static ForwardAttachment attachment(ForwardUploadedFile object) {
        Map<String,Object> file=object.uploadedFile();
        if(file.isEmpty() || text(file,"fileName")==null || text(file,"filePath")==null)
            throw new IllegalArgumentException("FORWARD_ATTACHMENTS_INCOMPLETE");
        return new ForwardAttachment(text(file,"fileId"),text(file,"fileName"),text(file,"filePath"),text(file,"fileUrl"),
            text(file,"cloudResourceId"),text(file,"mediaType"),object.size());
    }
    public static ForwardReference reference(ForwardAttachment file) {
        boolean knowledge=file.cloudResourceId()!=null;
        String type=knowledge?"KG_DOC_FILE":"COMMON_FILE";
        String resource=knowledge?file.filePath():file.filePath().startsWith("/by/")?file.filePath():"/by"+file.filePath();
        String code=knowledge?JSON.toJSONString(Map.of("datasetId",file.cloudResourceId(),"directoryPath",file.filePath())):null;
        String selector=file.fileId();
        if(selector==null)try {
            selector=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((file.cloudResourceId()+":"+file.filePath()).getBytes(StandardCharsets.UTF_8)));
        } catch(java.security.NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
        return new ForwardReference(type+"_"+selector,resource,file.fileName(),type,code,null);
    }
    public static String replaceTokens(String content,Map<String,String> ids) {
        return Pattern.compile("\\{\\{([^{}]+)}}").matcher(content).replaceAll(match ->
            Matcher.quoteReplacement(ids.containsKey(match.group(1))?"{{"+ids.get(match.group(1))+"}}":match.group()));
    }
    private static String text(Map<String,Object> map,String key) {return map.get(key) instanceof String text&&!text.isBlank()?text:null;}
}
