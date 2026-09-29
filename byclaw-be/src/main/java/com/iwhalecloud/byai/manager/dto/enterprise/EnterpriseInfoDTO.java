package com.iwhalecloud.byai.manager.dto.enterprise;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 企业信息新增/修改入参。
 */
@Getter
@Setter
public class EnterpriseInfoDTO {

    /**
     * 企业标识（修改时必填）
     */
    @NotNull(groups = Mod.class, message = "{enterprise.id.required}")
    private Long enterpriseId;

    /**
     * 企业名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{enterprise.name.required}")
    @Size(max = 200, groups = {Add.class, Mod.class}, message = "{enterprisecontroller.comacctname.size}")
    private String comAcctName;

    /**
     * 企业编码
     */
    private String comAcctCode;

    /**
     * 企业地址
     */
    private String comAcctAddress;

    /**
     * 系统名称
     */
    @Size(max = 255, groups = {Add.class, Mod.class}, message = "{enterprisecontroller.systemname.size}")
    private String systemName;

    /**
     * 企业 Logo（JSON 中传 base64）
     */
    private byte[] logoData;
}
