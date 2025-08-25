FROM mcr.microsoft.com/playwright:v1.46.0-jammy
WORKDIR /app

# copy only package.json files to allow npm to resolve working versions
COPY qa-pilot/package.json ./qa-pilot/
COPY qa-pilot/ui/package.json ./qa-pilot/ui/

RUN cd qa-pilot && npm install
RUN cd qa-pilot/ui && npm install

# copy the rest of the source
COPY qa-pilot ./qa-pilot

# build UI (served by the Node server)
ENV VITE_API_BASE_URL=/api
RUN cd qa-pilot/ui && npm run build

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "qa-pilot/server/index.js"]
