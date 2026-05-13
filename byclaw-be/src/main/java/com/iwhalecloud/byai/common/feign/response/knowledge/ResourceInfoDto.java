package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Data;

@Data
public class ResourceInfoDto {
        private String resourceId;
        private String resourceType;
        private String id;
        private String resourceName;
}