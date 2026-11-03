# 작업실 입력을 제외하고 교실 화면만 빌드한다. 기존 Vite 설정은 수정하지 않는다.
FROM node:24-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN node --input-type=module -e \
    "import {build} from 'vite'; await build({configFile:false,build:{rollupOptions:{input:'index.html'}}});"
RUN node scripts/precompress.mjs dist

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs", "--production"]
