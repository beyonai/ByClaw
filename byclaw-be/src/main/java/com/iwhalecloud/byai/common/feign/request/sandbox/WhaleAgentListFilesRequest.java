package com.iwhalecloud.byai.common.feign.request.sandbox;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class WhaleAgentListFilesRequest {

    private String filePath;

    private String fileShareType;
}
