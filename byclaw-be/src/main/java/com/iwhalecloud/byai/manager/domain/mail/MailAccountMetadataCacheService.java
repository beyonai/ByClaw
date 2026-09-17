package com.iwhalecloud.byai.manager.domain.mail;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;

/** Non-transactional facade which always reaches the independent cache transaction bean. */
@Service
public class MailAccountMetadataCacheService {
    private static final Logger log = LoggerFactory.getLogger(MailAccountMetadataCacheService.class);
    private final MailAccountMetadataCacheTransactionService transactions;

    public MailAccountMetadataCacheService(MailAccountMetadataCacheTransactionService transactions) {
        this.transactions = transactions;
    }

    public void refresh(Long userId) {
        try {
            transactions.refreshRequired(userId);
        } catch (RuntimeException | JsonProcessingException e) {
            log.warn("Mail metadata cache refresh failed for userId={}: {}", userId, e.getMessage());
        }
    }

    public void refreshRequired(Long userId) throws JsonProcessingException {
        transactions.refreshRequired(userId);
    }

    public String buildJson(List<UserMailAccount> accounts) throws JsonProcessingException {
        return transactions.buildJson(accounts);
    }

    public static String buildRedisKey(String userCode) {
        return MailAccountMetadataCacheTransactionService.buildRedisKey(userCode);
    }
}
