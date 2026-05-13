package com.iwhalecloud.byai.manager.vo.searchask;

import com.iwhalecloud.byai.manager.entity.file.Files;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-09 12:21:06
 * @description TODO
 */
@Getter
@Setter
public class ImportFilesVo {

    private Long sessionId;

    private List<Files> importResults;
}
