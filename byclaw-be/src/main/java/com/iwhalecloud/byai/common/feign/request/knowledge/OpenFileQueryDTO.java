package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-08-08 00:52:50
 * @description TODO
 */
@Getter
@Setter
public class OpenFileQueryDTO {

    private Long chatId;

    private String tags;

    private String matchMode = "all";

}
