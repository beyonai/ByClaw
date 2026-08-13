package com.iwhalecloud.byai.manager.entity.resource;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai_user_mcp_tool_snapshot")
public class UserMcpToolSnapshot {

    @TableId(value = "snapshot_id", type = IdType.INPUT)
    private Long snapshotId;
    private Long resourceId;
    private Long definitionRevision;
    private Long snapshotVersion;
    private String toolName;
    private String description;
    private String inputSchema;
    private String schemaHash;
    private String riskLevel;
    private String riskSource;
    private String statusCd;
    private Date createTime;
}
