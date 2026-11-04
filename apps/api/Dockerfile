FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
COPY db db
WORKDIR /app/apps/api
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
