FROM node:22-alpine

WORKDIR /app

# Install server deps
COPY server/package*.json ./server/
RUN cd server && npm install

# Install client deps
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy source
COPY . .

# Build server + client
RUN cd server && npm run build && cd ../client && npm run build

EXPOSE 3000

COPY server/entrypoint.sh /app/server/entrypoint.sh
RUN chmod +x /app/server/entrypoint.sh

CMD ["/app/server/entrypoint.sh"]
