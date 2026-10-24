FROM node:22-bookworm-slim AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server ./server
COPY convex ./convex
COPY scripts/preflight.mjs ./scripts/preflight.mjs
COPY tsconfig.json ./
RUN chmod a+r package.json package-lock.json tsconfig.json \
    && chmod -R a+rX server convex scripts \
    && mkdir -p data && chown node:node data
USER node
ENV NODE_ENV=production
EXPOSE 3456
CMD ["npm", "start"]

FROM app AS frontend
USER root
COPY debug ./debug
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ENV VITE_ENABLE_DASHBOARD=true
RUN npm run build:debug

FROM caddy:2-alpine AS web
COPY --from=frontend /app/debug/dist /srv
COPY deploy/aws/Caddyfile /etc/caddy/Caddyfile
