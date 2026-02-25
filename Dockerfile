# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY postcss.config.mjs ./
COPY src ./src
COPY public ./public

# Create config.json from sample for build (production uses mounted config)
RUN cp src/config.sample.json src/config.json

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/dist/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist/src/views ./src/views

# Copy runtime files
COPY start.sh ./
COPY db ./db

# Install curl for health checks and Litestream for continuous replication
RUN apk --no-cache add curl wget jq && \
    wget -O /tmp/litestream.tar.gz \
        https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz && \
    tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin && \
    rm /tmp/litestream.tar.gz && \
    chmod +x start.sh
COPY litestream.yml /etc/litestream.yml

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:4200/health || exit 1

CMD ["/bin/sh", "start.sh"]
