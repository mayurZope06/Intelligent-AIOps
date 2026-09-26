# Multi-stage / Production Dockerfile for Payment Service
# Node.js LTS base image
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV=production
ENV PORT=4002

# Copy package manifests first for efficient layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy application source code with correct ownership
COPY --chown=node:node src/ ./src/

# Use non-root node user for container security
USER node

# Expose microservice port
EXPOSE 4002

# Start service directly with node to properly handle SIGINT / SIGTERM signals
CMD ["node", "src/server.js"]
