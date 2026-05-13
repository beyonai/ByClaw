package com.iwhalecloud.byai.gateway.sandbox.client.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Volume {

    private String key;

    private String name;

    private HostVolume host;

    private String mountPath;

    private Boolean readOnly;

    private String subPath;

    private String scope;
}
