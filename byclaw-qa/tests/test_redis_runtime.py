from unittest.mock import MagicMock, patch

from redis_runtime import init_shared_redis_from_env, load_redis_config_from_env


def test_load_redis_config_from_env_logs_standalone_target():
    config = MagicMock(mode="standalone", host="127.0.0.1", port=6379)

    with (
        patch("redis_runtime.RedisConfig.from_env", return_value=config) as from_env,
        patch("redis_runtime.logger") as mock_logger,
    ):
        result = load_redis_config_from_env()

    assert result is config
    from_env.assert_called_once_with()
    mock_logger.info.assert_called_once_with(
        "Connecting Redis from environment: mode=%s target=%s",
        "standalone",
        "127.0.0.1:6379",
    )


def test_load_redis_config_from_env_logs_cluster_nodes():
    config = MagicMock(
        mode="cluster",
        cluster_nodes=[("10.0.0.1", 6379), ("10.0.0.2", 6379)],
    )

    with (
        patch("redis_runtime.RedisConfig.from_env", return_value=config),
        patch("redis_runtime.logger") as mock_logger,
    ):
        load_redis_config_from_env()

    mock_logger.info.assert_called_once_with(
        "Connecting Redis from environment: mode=%s target=%s",
        "cluster",
        [("10.0.0.1", 6379), ("10.0.0.2", 6379)],
    )


def test_init_shared_redis_from_env_uses_redis_config_with_init_redis():
    config = MagicMock()
    client = object()

    with (
        patch("redis_runtime.RedisConfig.from_env", return_value=config),
        patch("redis_runtime.init_redis", return_value=client) as init_mock,
    ):
        result = init_shared_redis_from_env()

    assert result is client
    init_mock.assert_called_once_with(config=config)
