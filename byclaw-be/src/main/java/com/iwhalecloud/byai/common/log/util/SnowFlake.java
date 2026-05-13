package com.iwhalecloud.byai.common.log.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


/**
 * twitter的snowflake算法 -- java实现
 *
 * @author hklv
 * @date 2017/07/25
 */

public final class SnowFlake {

    private static final Logger logger = LoggerFactory.getLogger(SnowFlake.class);
    /**
     * 起始的时间戳
     */
    private static final long START_STAMP = 1403854494756L;
//    private static final Random RANDOM = new Random();
    // 默认0, TODO：需要传入进来指定machineID
    private static final Long MECHINEID = 0L;
    /**
     * 序列号占用的位数
     */
    private static final long SEQUENCE_BIT = 12;
    /**
     * 机器标识占用的位数
     */
    private static final long MACHINE_BIT = 5;
    /**
     * 数据中心占用的位数
     */
    private static final long DATA_CENTER_BIT = 5;

    /**
     * 每一部分的最大值
     */
    private static final long MAX_DATA_CENTER_NUM = ~(-1L << DATA_CENTER_BIT);
    private static final long MAX_MACHINE_NUM = ~(-1L << MACHINE_BIT);
    private static final long MAX_SEQUENCE = ~(-1L << SEQUENCE_BIT);

    /**
     * 每一部分向左的位移
     */
    private static final long MACHINE_LEFT = SEQUENCE_BIT;
    private static final long DATA_CENTER_LEFT = SEQUENCE_BIT + MACHINE_BIT;
    private static final long TIMESTAMP_LEFT = DATA_CENTER_LEFT + DATA_CENTER_BIT;
    /**
     * 数据中心
     */
    public long dataCenterId;
    /**
     * 机器标识
     */
    private long machineId;
    /**
     * 序列号
     */
    private static long sequence = 0L;
    /**
     * 上一次时间戳
     */
    private static long lastStamp = -1L;

    private SnowFlake(long dataCenterId, long machineId) {
        if (dataCenterId > MAX_DATA_CENTER_NUM || dataCenterId < 0) {
            throw new IllegalArgumentException("snowflake.datacenter.id.invalid");
        }
        if (machineId > MAX_MACHINE_NUM || machineId < 0) {
            throw new IllegalArgumentException("snowflake.machine.id.invalid");
        }
        this.dataCenterId = dataCenterId;
        this.machineId = machineId;
    }

//    public static synchronized void setDataCenterId(int dataCenterId) {
//        SnowFlake.dataCenterId = dataCenterId;
//    }
//
//    public static synchronized void setMachineId(int machineId) {
//        SnowFlake.dataCenterId = machineId;
//    }

    private static SnowFlake idGenerator = new SnowFlake(1, 1);

    public static SnowFlake getIdGeneratorInstance() {
        return idGenerator;
    }

//    public static long getMachineId() {
//        return machineId;
//    }

//    public static void setMachineId(long machineId) {
//        SnowFlake.machineId = machineId;
//    }

    /**
     * 产生下一个ID
     *
     * @return
     */
    public synchronized static long nextId() {
        long currStamp = getNewStamp();
        if (currStamp < lastStamp) {
            throw new RuntimeException("snowflake.clock.moved.backwards");
        }

        if (currStamp == lastStamp) {
            //相同毫秒内，序列号自增
            sequence = (sequence + 1) & MAX_SEQUENCE;
            //同一毫秒的序列数已经达到最大
            if (sequence == 0L) {
                currStamp = getNextMill();
            }
        }
        else {
            //不同毫秒内，序列号置为0
            sequence = 0L;
        }

        lastStamp = currStamp;
        //时间戳部分
        return (currStamp - START_STAMP) << TIMESTAMP_LEFT
//                | 1 << DATA_CENTER_LEFT       //数据中心部分
                //机器标识部分
                | MECHINEID << MACHINE_LEFT
                | sequence;                             //序列号部分
    }

    private static long getNextMill() {
        long mill = getNewStamp();
        while (mill <= lastStamp) {
            mill = getNewStamp();
        }
        return mill;
    }

    private static long getNewStamp() {
        return System.currentTimeMillis();
    }
}
