FROM redis:7-bookworm

EXPOSE 6379

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD redis-cli ping | grep -q PONG || exit 1

CMD ["redis-server"]
