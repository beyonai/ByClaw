# SMS verification

`POST /system/session/sms/send` accepts business type `1` (login) or `2`
(registration), an encrypted mainland China mobile number (`1[3-9][0-9]{9}`),
and a same-session image captcha. The existing response envelope is retained.

## Phone quotas

There is no IP-based limit and no trusted-proxy setting for SMS. All source IPs
and both business types share the same phone quota. Defaults:
- `sms.rate.limit.max-count=3` attempts
- `sms.rate.limit.interval-minutes=5` fixed window
- `sms.rate.limit.repeated-interval=1` minute cooldown

Redis Lua atomically reserves an attempt at `sms:phone:count:<phone>`.
SET NX with expiry reserves `sms:phone:cooldown:<phone>` across instances.
Failures after reservation consume quota; Redis failures prevent sending.
Counters are intentionally not separated by business type, so switching from
registration to login cannot bypass the phone quota. Protect access to Redis,
whose keys contain phone numbers.

## Delivery and verification

A non-usable record is persisted before contacting the provider. Only successful
delivery acceptance followed by a successful database update activates the code.
Insert and update must each affect exactly one row; zero-row writes fail.
If the post-send database update fails, the SMS may have arrived but its code is
unusable. The request fails and cooldown remains; there is no automatic resend.
Existing state 2 is used for non-usable records; no schema migration is needed.

Hacu frontend changes live in /Users/lijiahui/Desktop/byclaw-hacu/extensions/.
It clears/refreshes the image captcha after every send attempt, including network
failures. Final login/registration validates phone and SMS code; a fresh image
captcha is required only when requesting another SMS.

## Kubernetes

All backend Pods must connect to the same logical Redis deployment/database and
use the same key scheme. Each JVM's static RedisUtil instance holds a client,
not the counters. Single-key Lua and SET NX execute on Redis and are compatible
with Redis Cluster routing (Cluster uses database 0). Redis ACLs must allow the
script and its commands. Shared Spring Session is also required for captcha
requests and send requests routed to different Pods.
Redis asynchronous replication/failover can lose recent quota writes; this is
not a guarantee of strict exactly-once delivery under failover. Real Cluster
and Kubernetes networking/failover are not covered by the local tests.

Focused tests: CaptchaServiceTest, AnonymousSmsFlowTest, SmsLoginFlowTest,
SafeAccountMsgServiceTest, AccessTokenVerifyInterceptorTest, AliyunSmsServiceTest,
SmsRateLimitRedisTest. Set `-Dtest.redis.server=/absolute/path/to/redis-server`
to run the disposable Redis concurrency/expiry test; otherwise it is skipped.
