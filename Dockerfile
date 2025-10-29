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
COPY scripts ./scripts

# Create config.json from sample for build (production uses mounted config)
RUN cp src/config.sample.json src/config.json

# Build the application (includes compiling scripts)
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
COPY --from=builder /app/dist/scripts/fishbase ./scripts/fishbase

# Copy runtime files
COPY start.sh ./
COPY db ./db

# Install curl for health checks
RUN apk --no-cache add curl && \
    chmod +x start.sh

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
