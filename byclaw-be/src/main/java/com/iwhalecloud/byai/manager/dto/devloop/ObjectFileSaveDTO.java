package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

/**
 * 批量保存/更新项目业务对象关联文件请求。
 */
@Data
public class ObjectFileSaveDTO {

    /** 待保存的对象文件列表 */
    private List<ObjectFileDTO> objectFiles;
}
