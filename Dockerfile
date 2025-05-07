FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm install

COPY tsconfig.json .
COPY postcss.config.mjs .
COPY src src
COPY public public

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY ./../start.sh ./
COPY --from=builder /app/dist/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist/views ./src/views
COPY src/config.production.json ./src/config.json
COPY db db

RUN apk --no-cache add curl

CMD ["/bin/sh", "start.sh"]
