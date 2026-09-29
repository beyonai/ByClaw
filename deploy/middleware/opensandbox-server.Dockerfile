ARG BASE_IMAGE=sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9
FROM ${BASE_IMAGE}

USER root
COPY patch-local-opensandbox-tcp.py /tmp/patch-local-opensandbox-tcp.py
RUN python3 /tmp/patch-local-opensandbox-tcp.py && rm /tmp/patch-local-opensandbox-tcp.py
USER 1001:1001
