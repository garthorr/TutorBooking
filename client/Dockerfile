# Build stage
# Node 20+ is required by the build toolchain: vite and @vitejs/plugin-react
# declare engines ^20.19.0 || >=22.12.0, and react-router-dom >=20.0.0.
# Dropping below this silently breaks `docker compose build client`.
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
