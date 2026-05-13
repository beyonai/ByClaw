package com.iwhalecloud.byai.manager.entity.station;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.manager.validate.station.annotation.ParentStationIdValidator;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 驻地信息表结构
 * 对应表：po_station
 */
@Getter
@Setter
@TableName("po_station")
public class Station {
    /**
     * 驻地标识
     */
    @TableId(value = "station_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{station.stationid.notnull}")
    private Long stationId;

    /**
     * 驻地名称
     */
    @Size(groups = {
            Add.class, Mod.class
    }, max = 200, message = "{station.stationname.size}")
    @NotEmpty(groups = {
            Add.class, Mod.class
    }, message = "{station.stationname.notempty}")
    private String stationName;

    /**
     * 1:国家，2：省级，3：城市（暂时没用）
     */
    private Integer stationType;

    /**
     * 驻地标识路径
     */
    private String stationIdPath;

    /**
     * 父驻地ID
     */
    @ParentStationIdValidator(groups = Add.class, message = "{station.pstationid.valid}")
    @NotNull(groups = Add.class, message = "{station.pstationid.notnull}")
    private Long pStationId;

    /**
     * 是否国外驻地:0：否，1：是
     */
    @NotNull(groups = Add.class, message = "{station.isabroad.notnull}")
    private Integer isAbroad;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /**
     * 所属企业
     */
    private Long comAcctId;


}
