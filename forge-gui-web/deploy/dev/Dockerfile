# A dev pod: JDK to compile what a branch changed, git to follow it, node for the UI's dev server (README "Dev pods").
FROM eclipse-temurin:17-jdk

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils procps \
 && curl -fsSL https://nodejs.org/dist/v20.19.5/node-v20.19.5-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*'

COPY devpod.sh /usr/local/bin/devpod
RUN chmod +x /usr/local/bin/devpod

ENV HOME=/work
WORKDIR /work
