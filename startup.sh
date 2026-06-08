docker build --build-arg HTTP_PROXY=http://host.docker.internal:7890 --build-arg HTTPS_PROXY=http://host.docker.internal:7890 -t byclaw-qa:test .

docker run -it --rm --name byclaw-qa-worker --env-file=/Users/jialangli/code/workspace/byclaw-all/byclaw-qa/.env.docker byclaw-qa:test worker
docker run -it --rm --name byclaw-qa-api -p 8000:8000 --env-file=/Users/jialangli/code/workspace/byclaw-all/byclaw-qa/.env.docker byclaw-qa:test api
