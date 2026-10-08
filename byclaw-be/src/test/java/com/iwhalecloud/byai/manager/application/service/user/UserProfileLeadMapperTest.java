package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import com.iwhalecloud.byai.manager.mapper.customer.ByaiCustomerLeadsMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** 执行真实 Mapper SQL，验证回读、账户隔离和更新时保留历史咨询内容。 */
class UserProfileLeadMapperTest {
    @Test
    void profileSqlPreservesConsultationAndOnlyUpdatesTheLinkedAccount() throws Exception {
        var dataSource = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:profile_mapper;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE", "sa", "");
        var configuration = new Configuration(new Environment("test", new JdbcTransactionFactory(), dataSource));
        String resource = "/com/iwhalecloud/byai/manager/mapper/customer/ByaiCustomerLeadsMapper.xml";
        try (var input = getClass().getResourceAsStream(resource)) {
            assertThat(input).isNotNull();
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession(true)) {
            try (var statement = session.getConnection().createStatement()) {
                statement.execute("CREATE TABLE byai_customer_leads(id BIGINT, user_id BIGINT UNIQUE, company_name VARCHAR(100), contact_name VARCHAR(100), industry VARCHAR(100), phone VARCHAR(20), wechat VARCHAR(50), demand TEXT, create_time TIMESTAMP, profile_role VARCHAR(50), profile_interests TEXT)");
            }
            ByaiCustomerLeadsMapper mapper = session.getMapper(ByaiCustomerLeadsMapper.class);
            ByaiCustomerLeads historical = new ByaiCustomerLeads();
            historical.setId(12L);
            historical.setUserId(999L); // 旧留资入口忽略客户端尝试指定的账户关联。
            historical.setCompanyName("历史公司");
            historical.setPhone("13900000000");
            historical.setIndustry("教育");
            historical.setDemand("历史咨询");
            assertThat(mapper.insertLead(historical)).isEqualTo(1);
            assertThat(mapper.selectLegacyProfileByPhone(historical.getPhone()).getUserId()).isNull();
            assertThat(mapper.selectProfileByUserId(999L)).isNull();

            ByaiCustomerLeads profile = new ByaiCustomerLeads();
            profile.setId(20L);
            profile.setUserId(42L);
            profile.setCompanyName("鲸智科技");
            profile.setContactName("吴杰");
            profile.setIndustry("教育");
            profile.setDemand("原咨询内容");
            profile.setProfileRole("学生");
            profile.setProfileInterests("[\"教育学习\"]");
            assertThat(mapper.insertProfile(profile)).isEqualTo(1);
            ByaiCustomerLeads saved = mapper.selectProfileByUserId(42L);
            assertThat(saved.getProfileRole()).isEqualTo("学生");
            assertThat(saved.getProfileInterests()).isEqualTo("[\"教育学习\"]");

            saved.setCompanyName("个人");
            saved.setProfileRole("");
            saved.setProfileInterests("[]");
            saved.setIndustry("不能修改原行业");
            saved.setDemand("不能覆盖原咨询");
            assertThat(mapper.updateProfileLead(saved)).isEqualTo(1);
            ByaiCustomerLeads updated = mapper.selectProfileByUserId(42L);
            assertThat(updated.getCompanyName()).isEqualTo("个人");
            assertThat(updated.getProfileInterests()).isEqualTo("[]");
            assertThat(updated.getIndustry()).isEqualTo("教育");
            assertThat(updated.getDemand()).isEqualTo("原咨询内容");
            saved.setUserId(43L);
            assertThat(mapper.updateProfileLead(saved)).isZero();
            assertThat(mapper.selectProfileByUserId(43L)).isNull();
            assertThat(mapper.selectLegacyProfileByPhone(historical.getPhone()).getCompanyName()).isEqualTo("历史公司");
        }
    }
}
