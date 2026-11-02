package com.iwhalecloud.byai.state.common.exception;
import java.util.*;
/** Structured storage error crossing HTTP and chat streams. */
public final class NasQuotaExceededException extends BdpRuntimeException {
    private final Map<String,Object> details;
    private NasQuotaExceededException(Map<?,?> source) {
        super(ResourceBundle.getBundle("i18n.messages",org.springframework.context.i18n.LocaleContextHolder.getLocale()).getString("nas.quota.exceeded"));
        Map<String,Object> safe=new LinkedHashMap<>();safe.put("errorType","NAS_QUOTA_EXCEEDED");
        for(String key:List.of("quotaBytes","usedBytes","requestedBytes","exceededBytes","usageObservedAt")) {
            Object value=source.get(key);
            if(value instanceof Number number && number.doubleValue()>=0 && Double.isFinite(number.doubleValue())) safe.put(key,number.longValue());
        }
        if(source.get("operation") instanceof String operation && Set.of("CHAT","UPLOAD","WRITE","CREATE_DIRECTORY","COPY","MOVE").contains(operation)) safe.put("operation",operation);
        safe.put("actualRejection",Boolean.TRUE.equals(source.get("actualRejection")));
        details=Collections.unmodifiableMap(safe);
    }
    public Map<String,Object> details(){return details;}
    public static NasQuotaExceededException from(Object envelope) {
        if(!(envelope instanceof Map<?,?> response))return null;
        Object data=response.get("data");
        if(data instanceof Map<?,?> quota && "NAS_QUOTA_EXCEEDED".equals(quota.get("errorType")))return new NasQuotaExceededException(quota);
        return null;
    }
    public static NasQuotaExceededException from(feign.FeignException failure) {
        if(failure.status()!=507)return null;
        try {return from(new com.fasterxml.jackson.databind.ObjectMapper().readValue(failure.contentUTF8(),Map.class));}
        catch(Exception invalid){return null;}
    }
}
