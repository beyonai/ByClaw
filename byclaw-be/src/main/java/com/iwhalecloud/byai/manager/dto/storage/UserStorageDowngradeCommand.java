package com.iwhalecloud.byai.manager.dto.storage;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageDowngradeCommand {

    private Long grantId;

    private List<Long> grantIds;

    private Long packageId;

    private Long downgradeId;

    private String reason;

    private String reviewRemark;

}
