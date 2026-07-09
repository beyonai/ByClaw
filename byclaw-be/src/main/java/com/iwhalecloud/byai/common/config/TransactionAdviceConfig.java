package com.iwhalecloud.byai.common.config;

/**
 * @author he.duming
 * @date 2025-04-24 16:16:15
 * @description TODO
 */
import org.aspectj.lang.annotation.Aspect;
import org.springframework.aop.framework.autoproxy.BeanNameAutoProxyCreator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.interceptor.NameMatchTransactionAttributeSource;
import org.springframework.transaction.interceptor.RollbackRuleAttribute;
import org.springframework.transaction.interceptor.RuleBasedTransactionAttribute;
import org.springframework.transaction.interceptor.TransactionAttribute;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.Logger;

/**
 * 全局事务配置，只代理*Service的类,代理方式cglib
 *
 * @author 何杜明
 */
@Aspect
@Configuration
public class TransactionAdviceConfig {

    private static final Logger logger = Logger.getLogger(TransactionAdviceConfig.class.getName());

    /**
     * 连接发超时时间
     */
    private static final int TX_METHOD_TIMEOUT = 300 * 1000;

    @Autowired
    private DataSourceTransactionManager transactionManager;

    /**
     * 创建事务通知
     *
     * @return TransactionInterceptor
     */
    @Bean(name = "txAdvice")
    public TransactionInterceptor getAdvisor() {

        // 如果当前方法已经在事务中，那么就以当前事务执行；如果当前方法不再事务中，那么就以非事务方式运行。如果运行在事务中，那么只要出现异常都会回滚
        RuleBasedTransactionAttribute readOnlyTx = new RuleBasedTransactionAttribute();
        readOnlyTx.setReadOnly(true);
        readOnlyTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);

        // 如果当前方法已经在事务中，那么就以父事务执行，不需要新建事务；如果当前方法不在事务中，那么就为当前方法新建事务。回滚情况：父子方法中任何地方出现问题，都会全部回滚
        RuleBasedTransactionAttribute requiredTx = new RuleBasedTransactionAttribute();
        requiredTx.setRollbackRules(Collections.singletonList(new RollbackRuleAttribute(Exception.class)));
        requiredTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        requiredTx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        requiredTx.setTimeout(TX_METHOD_TIMEOUT);

        // 如果当前方法已经在事务中，那么就挂起当前事务，以非事务方式运行，方法执行完毕后，恢复事务；如果当前方法不再事务中，那么就以非事务方式执行
        RuleBasedTransactionAttribute notSurpportedTx = new RuleBasedTransactionAttribute();
        notSurpportedTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);

        Map<String, TransactionAttribute> txMap = new LinkedHashMap<String, TransactionAttribute>(10);
        // select,count开头的方法,开启只读,提高数据库访问性能
        txMap.put("select*", readOnlyTx);
        txMap.put("get*", readOnlyTx);
        txMap.put("query*", readOnlyTx);
        txMap.put("qry*", readOnlyTx);
        txMap.put("list*", readOnlyTx);
        txMap.put("count*", readOnlyTx);
        txMap.put("find*", readOnlyTx);
        txMap.put("search*", readOnlyTx);
        txMap.put("createDatasetIfNotExists", notSurpportedTx);
        txMap.put("createDefaultResourcesIfNotExists", notSurpportedTx);
        // 记忆引擎同步属于数字员工保存的可选旁路能力。若调用失败会被业务层捕获并继续，
        // 因此不能加入主事务，否则会把主事务标记为 rollback-only，最终导致 UnexpectedRollbackException。
        txMap.put("createOrGetMemoryLibraryForDigitalEmployee", notSurpportedTx);
        txMap.put("saveMemoryScene", notSurpportedTx);
        // 开放资源目录/Redis 同步在业务层已声明为失败不阻断主流程；这里必须挂起事务，
        // 否则内部同步异常即使被捕获，也会在方法返回时触发 rollback-only 提交异常。
        txMap.put("synOpenClawWorkSpace", notSurpportedTx);
        txMap.put("syncResourceJsonByBizType", notSurpportedTx);
        txMap.put("upsertStandardJsonArtifact", notSurpportedTx);
        txMap.put("prewarmDueCronSandboxes", notSurpportedTx);
        txMap.put("callAsUser", notSurpportedTx);
        txMap.put("runAsUser", notSurpportedTx);
        // 元提示词生成链路只读取上下文并调用外部大模型。大模型调用失败会在业务层降级处理，
        // 因此不要加入事务，避免内部异常被捕获后仍把外层事务标记为 rollback-only。
        txMap.put("generateV3", notSurpportedTx);
        txMap.put("generateV3Stream", notSurpportedTx);
        txMap.put("generateText", notSurpportedTx);
        txMap.put("generateTextStream", notSurpportedTx);
        txMap.put("*", requiredTx);

        /* 事务管理规则，声明具备事务管理的方法名 **/
        NameMatchTransactionAttributeSource source = new NameMatchTransactionAttributeSource();
        source.setNameMap(txMap);
        TransactionInterceptor txAdvice = new TransactionInterceptor(transactionManager, source);
        logger.info("Transaction advice configured successfully.");
        return txAdvice;
    }

    @Bean
    public BeanNameAutoProxyCreator txProxy() {
        BeanNameAutoProxyCreator creator = new BeanNameAutoProxyCreator();
        creator.setInterceptorNames("txAdvice");
        creator.setBeanNames("*Service", "*ServiceImpl", "*Runner", "*Dao");
        creator.setProxyTargetClass(true);
        logger.info("BeanNameAutoProxyCreator configured successfully.");
        return creator;
    }
}
