FROM node:lts AS dev
ARG APP
ARG GIT_COMMIT
ARG VERSION
USER node
WORKDIR /home/node/app
ENV GIT_COMMIT="${GIT_COMMIT}"
ENV VERSION="${VERSION}"
COPY --chown=node:node . .
ENV HOST=0.0.0.0
CMD [ "npm", "run", "dev" ]

FROM node:lts-alpine AS builder
ARG VERSION
ENV VERSION="${VERSION}"
USER node
WORKDIR /home/node/app
COPY --chown=node:node . .
RUN npm ci \
  && npm run build \
  && npm prune --production

FROM gcr.io/distroless/nodejs26
ARG GIT_COMMIT
ARG GIT_REPO
ARG VERSION
WORKDIR /opt/app
ENV GIT_REPO="${GIT_REPO}"
ENV GIT_COMMIT="${GIT_COMMIT}"
ENV VERSION="${VERSION}"
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
COPY --from=builder /home/node/app/build build
COPY --from=builder /home/node/app/node_modules node_modules
COPY --from=builder /home/node/app/package.json package.json
USER 65532
EXPOSE 3000
CMD [ "build" ]
