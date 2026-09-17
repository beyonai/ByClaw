package com.iwhalecloud.byai.manager.vo.users;

import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import lombok.Getter;
import lombok.Setter;

/** Public connection-check result matching the personal-email frontend contract. */
@Getter
@Setter
public class MailConnectionCheckResultVO {

    private static final List<String> CAPABILITY_ORDER = List.of(
        "list", "get", "search", "downloadAttachment", "send", "reply", "delete");

    private String connectionState;

    private Date lastCheckTime;

    private String status;

    private Map<String, String> capabilityStatus = Map.of();

    public void setCapabilityStatus(Map<String, String> capabilityStatus) {
        if (capabilityStatus == null || capabilityStatus.isEmpty()) {
            this.capabilityStatus = Map.of();
            return;
        }
        if (!capabilityStatus.keySet().equals(Set.copyOf(CAPABILITY_ORDER))) {
            throw new IllegalArgumentException("Invalid mail capability status");
        }
        Map<String, String> ordered = new LinkedHashMap<>();
        for (String capability : CAPABILITY_ORDER) {
            ordered.put(capability, capabilityStatus.get(capability));
        }
        this.capabilityStatus = Collections.unmodifiableMap(ordered);
    }
}
