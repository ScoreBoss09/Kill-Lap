FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=3000 KILLLAP_DATA=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "server/server.js"]
