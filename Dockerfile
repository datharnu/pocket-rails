# Pocket Rails: the web app (screens, relayer, notes, history) and the two agents in one container.
# Built by Railway (or any Docker host). Keys are passed as runtime variables, never baked into the image.
FROM node:22-slim
RUN corepack enable
WORKDIR /app

# Install dependencies first (cached between builds).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/aevum/package.json packages/aevum/
COPY packages/pocket-rails/package.json packages/pocket-rails/
COPY web/package.json web/
COPY agents/package.json agents/
COPY examples/package.json examples/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY web web
COPY agents agents
COPY tools tools

# Public settings are compiled into the browser bundle, so they're needed at build time.
ARG NEXT_PUBLIC_NETWORKS=aevum
ARG NEXT_PUBLIC_RAILS_AEVUM
ARG NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM
ARG NEXT_PUBLIC_DEMO_CHILD
ARG NEXT_PUBLIC_DEMO_SCHOOL
ARG NEXT_PUBLIC_DEMO_GUARDIAN
ARG NEXT_PUBLIC_REPO_URL
ARG NEXT_PUBLIC_WC_PROJECT_ID
ENV NEXT_PUBLIC_NETWORKS=$NEXT_PUBLIC_NETWORKS \
    NEXT_PUBLIC_RAILS_AEVUM=$NEXT_PUBLIC_RAILS_AEVUM \
    NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM=$NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM \
    NEXT_PUBLIC_DEMO_CHILD=$NEXT_PUBLIC_DEMO_CHILD \
    NEXT_PUBLIC_DEMO_SCHOOL=$NEXT_PUBLIC_DEMO_SCHOOL \
    NEXT_PUBLIC_DEMO_GUARDIAN=$NEXT_PUBLIC_DEMO_GUARDIAN \
    NEXT_PUBLIC_REPO_URL=$NEXT_PUBLIC_REPO_URL \
    NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

ENV NODE_ENV=production
# web/.cache holds the history cache, note texts and the demo log: mount a volume there to keep them.
CMD ["node", "tools/start-all.mjs"]
