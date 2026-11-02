package com.iwhalecloud.byai.common.storage.model;

import lombok.Getter;
import lombok.Setter;

/** One physical filesystem lookup; absent targets do not change metadata() semantics. */
@Getter
@Setter
public class FileStat {
    private Boolean exists;
    private Boolean directory;
    private Long size;
    private String lastModified;
}
