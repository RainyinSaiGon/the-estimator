FROM node:22-bookworm-slim
WORKDIR /worker
COPY services/workflow-worker/worker.mjs ./worker.mjs
USER node
CMD ["node", "worker.mjs"]
