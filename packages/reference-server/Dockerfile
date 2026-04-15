# Multi-stage build — distroless final image.
# Image size: ~80 MB compressed.

FROM node:20-bookworm-slim AS builder
WORKDIR /workspace

# Copy workspace metadata so npm install resolves @commercehub/* sibling pkgs
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY packages/commerce-hub-node ./packages/commerce-hub-node
COPY packages/reference-server ./packages/reference-server

RUN npm install --workspaces --include-workspace-root
RUN npm run build --workspace=@commercehub/shared-types
RUN npm run build --workspace=@commercehub/node
RUN npm run build --workspace=@commercehub/reference-server

FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app

COPY --from=builder /workspace/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /workspace/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /workspace/packages/commerce-hub-node/dist ./packages/commerce-hub-node/dist
COPY --from=builder /workspace/packages/commerce-hub-node/package.json ./packages/commerce-hub-node/package.json
COPY --from=builder /workspace/packages/reference-server/dist ./packages/reference-server/dist
COPY --from=builder /workspace/packages/reference-server/package.json ./packages/reference-server/package.json
COPY --from=builder /workspace/node_modules ./node_modules

ENV NODE_ENV=development
ENV PORT=3848
EXPOSE 3848

# Distroless: PID 1 is node. No shell.
CMD ["packages/reference-server/dist/index.js"]
