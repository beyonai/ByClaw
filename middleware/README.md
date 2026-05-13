# Middleware

This directory contains a Dockerfile for building a container that runs multiple middleware services:

- **OpenGauss 6.0.0** - An open-source relational database
- **MinIO RELEASE.2025-02-03T21-03-04Z** - An object storage server compatible with Amazon S3
- **Redis 7.0.4** - An in-memory data structure store

## Building the Image

To build the Docker image, run the following command from the repository root:

```bash
docker build -t middleware-stack ./middleware
```

## Running the Container

To run the container with all services enabled:

```bash
docker run -d \
  -p 5432:5432 \
  -p 9000:9000 \
  -p 9001:9001 \
  -p 6379:6379 \
  --name middleware-stack \
  middleware-stack
```

## Accessing Services

### OpenGauss
- **Port**: 5432
- **Default Username**: omm
- **Default Password**: Gauss@123
- **Connection String**: `postgresql://omm:Gauss@123@localhost:5432/postgres`

### MinIO
- **API Port**: 9000
- **Console Port**: 9001
- **Default Access Key**: admin
- **Default Secret Key**: password
- **Console URL**: http://localhost:9001

### Redis
- **Port**: 6379
- **Default Password**: (none)
- **Connection Command**: `redis-cli -h localhost -p 6379`

## Stopping the Container

To stop the running container:

```bash
docker stop middleware-stack
```

To remove the container:

```bash
docker rm middleware-stack
```