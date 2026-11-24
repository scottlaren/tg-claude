# The server in one image: Telegram bot, Claude Code (its Linux build comes with the SDK) and the gateway
# computers connect to. ffmpeg and whisper.cpp are in the image for voice messages and video; the speech model
# (~550 MB) is not: the bot offers to download it the first time it is needed. State lives in /data, encrypted
# backups in /backups

# whisper.cpp, built once and cached until the version changes. The VPS builds its own image, so it is tuned to
# that CPU; no OpenMP, so nothing beyond glibc and libstdc++ is needed at run time
FROM debian:bookworm-slim AS whisper
ARG WHISPER_VERSION=v1.9.5
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
    && git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp /src \
    && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF \
       -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build /src/build -j "$(nproc)" --target whisper-cli \
    && cp /src/build/bin/whisper-cli /usr/local/bin/whisper-cli

# The agent as computers download it (the one line from /pair, then their updates): its code, the protocol and
# its dependencies, with no npm or git needed on the computer. The workspace link is made there (install.ts)
FROM node:24-bookworm-slim AS agent
WORKDIR /b
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/agent/package.json apps/agent/
RUN npm ci --omit=dev --workspace @tgcv/agent --workspace @tgcv/protocol --ignore-scripts && rm -rf node_modules/@tgcv
COPY packages/protocol/src packages/protocol/src
COPY apps/agent/src apps/agent/src
RUN tar -czf /agent-bundle.tar.gz package.json apps/agent packages/protocol node_modules

FROM node:24-bookworm-slim
# Voice and video: ffmpeg from Debian (~750 MB with its libraries), whisper.cpp from its stage. Before the
# version below, which changes every release: this layer stays cached
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
ARG TGCV_VERSION=unknown
ENV TGCV_VERSION=$TGCV_VERSION \
    NODE_ENV=production \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    WS_HOST=0.0.0.0 \
    CLAUDE_CWD=/home/node/claude-cwd
WORKDIR /app
# Manifests first: dependencies are rebuilt only when they change
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/agent/package.json apps/agent/
# Debian is glibc: npm also installs the musl build of Claude Code, ~270 MB of dead weight
RUN npm ci --omit=dev --workspace @tgcv/server --workspace @tgcv/protocol && npm cache clean --force \
    && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl
COPY packages/protocol packages/protocol
COPY apps/server apps/server
COPY --from=agent /agent-bundle.tar.gz /app/agent-bundle.tar.gz
RUN mkdir -p /data /backups /home/node/claude-cwd && chown -R node:node /data /backups /home/node
USER node
VOLUME ["/data", "/backups"]
EXPOSE 8787
CMD ["node", "apps/server/src/main.ts"]
