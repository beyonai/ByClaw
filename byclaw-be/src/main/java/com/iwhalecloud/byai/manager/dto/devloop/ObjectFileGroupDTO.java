package com.iwhalecloud.byai.manager.dto.devloop;

import com.iwhalecloud.byai.manager.entity.devloop.ProjectObjectFile;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 按业务对象归类的关联文件组。
 */
@Getter
@Setter
public class ObjectFileGroupDTO {

    /** 业务对象编码 */
    private String objectCode;

    /** 业务对象名称 */
    private String objectName;

    /** 同对象下的关联文件列表 */
    private List<ProjectObjectFile> projectObjectFiles;
}
