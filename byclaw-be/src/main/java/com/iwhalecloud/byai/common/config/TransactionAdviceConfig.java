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
