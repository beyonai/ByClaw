-- Replace one tenant's complete config snapshot only when it is not stale.
-- KEYS[1] = TENANT_CONFIG_E; ARGV[1] = new state JSON; ARGV[2] = credential version;
-- ARGV[3..] = alternating params_code and params_value pairs.
local nextState = cjson.decode(ARGV[1])
local nextGeneration = tonumber(nextState.generation)
local nextFence = tonumber(nextState.fencingToken)
local nextCredentialVersion = tonumber(ARGV[2])
if not nextGeneration or not nextFence or not nextCredentialVersion then
    return redis.error_reply('invalid tenant config version')
end

local oldStateJson = redis.call('HGET', KEYS[1], 'PROVISION_STATE')
if oldStateJson then
    local oldState = cjson.decode(oldStateJson)
    local oldGeneration = tonumber(oldState.generation)
    local oldFence = tonumber(oldState.fencingToken)
    local oldCredentialVersion = tonumber(redis.call('HGET', KEYS[1], 'DB_CREDENTIAL_VERSION'))
    if not oldGeneration or not oldFence or not oldCredentialVersion then
        return redis.error_reply('invalid existing tenant config version')
    end
    if nextGeneration < oldGeneration
        or (nextGeneration == oldGeneration and nextFence < oldFence)
        or nextCredentialVersion < oldCredentialVersion then
        return 0
    end
end

redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], unpack(ARGV, 3))
return 1
