package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-01-13 17:52:59
 * @description TODO
 */
@Getter
@Setter
public class PrologueDto {

    private Long modelId;

    private ModelInfoDto modelInfo;

    private FileUploadDto fileUpload;

}
