package com.iwhalecloud.byai.manager.dto.session;

import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-04-21 16:39:19
 * @description TODO
 */
@Getter
@Setter
public class SessionUploadResult extends UploadResult {

    private Long sessionId;
}
