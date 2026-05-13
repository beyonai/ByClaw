package com.iwhalecloud.byai.manager.dto.file;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-03 16:59:32
 * @description TODO
 */

@Getter
@Setter
public class UploadFilesRespListDto {

    private List<UploadFilesRespDto> files;
}
