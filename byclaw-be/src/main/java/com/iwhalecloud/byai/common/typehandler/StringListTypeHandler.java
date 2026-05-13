package com.iwhalecloud.byai.common.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 字符串列表类型处理器
 * 用于将数据库中的逗号分隔字符串转换为 List<String>
 * @author zzh
 */
@MappedTypes(List.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public class StringListTypeHandler extends BaseTypeHandler<List<String>> {

    /**
     * 设置非空参数
     * 
     * @param ps PreparedStatement
     * @param i 参数索引
     * @param parameter 参数值（List<String>）
     * @param jdbcType JDBC类型
     * @throws SQLException SQL异常
     */
    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, List<String> parameter, JdbcType jdbcType)
            throws SQLException {
        // 将 List 转换为逗号分隔的字符串
        String value = parameter == null || parameter.isEmpty() 
            ? null 
            : String.join(",", parameter);
        ps.setString(i, value);
    }

    /**
     * 获取可空结果
     * 
     * @param rs ResultSet
     * @param columnName 列名
     * @return List<String>
     * @throws SQLException SQL异常
     */
    @Override
    public List<String> getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return convertStringToList(value);
    }

    /**
     * 根据列索引获取可空结果
     * 
     * @param rs ResultSet
     * @param columnIndex 列索引
     * @return List<String>
     * @throws SQLException SQL异常
     */
    @Override
    public List<String> getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return convertStringToList(value);
    }

    /**
     * 从存储过程获取可空结果
     * 
     * @param cs CallableStatement
     * @param columnIndex 列索引
     * @return List<String>
     * @throws SQLException SQL异常
     */
    @Override
    public List<String> getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return convertStringToList(value);
    }

    /**
     * 将逗号分隔的字符串转换为 List<String>
     * 
     * @param value 逗号分隔的字符串
     * @return List<String>
     */
    private List<String> convertStringToList(String value) {
        if (value == null || value.trim().isEmpty()) {
            return new ArrayList<>();
        }
        
        // 按逗号分割，去除空白字符，过滤空字符串
        return Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());
    }
}

