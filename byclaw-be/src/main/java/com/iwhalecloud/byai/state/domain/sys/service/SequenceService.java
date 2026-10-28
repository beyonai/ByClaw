package com.iwhalecloud.byai.state.domain.sys.service;

import java.util.concurrent.atomic.AtomicLong;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

import cn.hutool.core.util.IdUtil;
import com.iwhalecloud.byai.manager.mapper.system.SequenceMapper;
import com.iwhalecloud.byai.state.domain.sys.model.SequenceId;
import com.iwhalecloud.byai.state.database.ByaiDruidProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-07-30 11:23:17
 * @description TODO
 */
@Service
public class SequenceService {

    /**
     * 设置起始时间为纳秒
     */
    private static final AtomicLong atomicLong = new AtomicLong(System.nanoTime());

    private static final String DS_MYSQL = "mysql";

    private static final String DS_TELEDB = "teledb";

    private static final String DS_ORACLE = "oracle";

    private static final String DS_OPENGAUSS = "opengauss";

    private static final String DS_POSTGRESQL = "postgresql";

    @Autowired
    private SequenceMapper sequenceMapper;

    @Autowired
    private ByaiDruidProperties byaiDruidProperties;

    /***
     * 默认序列名称，不配置默认全局用此序列
     */
    @Value("${spring.datasource.byai.defaultSequenceName:seq_any_table}")
    private String defaultSequenceName;

    /**
     * 默认序列
     * 
     * @return Long
     */
    public Long nextVal() {
        return this.nextVal(this.defaultSequenceName);
    }

    /** 按需从原序列获取一批主键；回滚可能留下序列空号，不复用已分配的 ID。 */
    public List<Long> nextValues(int count) {
        if (count < 0) throw new IllegalArgumentException("Sequence count must not be negative");
        if (count == 0) return List.of();
        String dbType = byaiDruidProperties.getDbType();
        List<Long> values;
        if (DS_POSTGRESQL.equalsIgnoreCase(dbType) || DS_OPENGAUSS.equalsIgnoreCase(dbType)) {
            values = sequenceMapper.nextValuesForPostgreSql(defaultSequenceName, count);
        } else {
            // 其他数据库沿用现有取号契约，避免改变跨库主键生成规则。
            values = new ArrayList<>(count);
            for (int i = 0; i < count; i++) values.add(nextVal());
        }
        if (values == null || values.size() != count || values.stream().anyMatch(java.util.Objects::isNull)
            || new HashSet<>(values).size() != count) {
            throw new IllegalStateException("Sequence returned an incomplete or duplicate ID batch");
        }
        return values;
    }

    /**
     * 指定序列名获取序列标识,暂不对外暴露
     * 
     * @param sequenceName 序列名称
     * @return Long
     */
    private Long nextVal(String sequenceName) {
        String dbType = byaiDruidProperties.getDbType();

        if (DS_TELEDB.equalsIgnoreCase(dbType)) {
            return sequenceMapper.nextValForUdal(sequenceName);
        }
        else if (DS_ORACLE.equalsIgnoreCase(dbType)) {
            return sequenceMapper.nextValForOracle(sequenceName);
        }
        else if (DS_POSTGRESQL.equalsIgnoreCase(dbType) || DS_OPENGAUSS.equalsIgnoreCase(dbType)) {
            return sequenceMapper.nextValForPostgreSql(sequenceName);
        }
        else if (DS_MYSQL.equalsIgnoreCase(dbType)) {
            SequenceId sequenceId = new SequenceId();
            sequenceMapper.nextValForMySqlIncrement();
            if (sequenceId.getId() % 10000 == 0) {
                sequenceMapper.clearMySqlIncrement(sequenceId.getId());
            }
            return sequenceId.getId();
        }
        else {
            // 默认原子自增策略
            return defaultNextId();
        }
    }

    /**
     * 自动获取纳秒生成的序列
     *
     * @return Long
     */
    private Long defaultNextId() {
        return atomicLong.incrementAndGet();
    }

    /**
     * 雪花模型
     *
     * @return Long
     */
    public Long nextSnowId() {
        return IdUtil.getSnowflakeNextId();
    }

}
