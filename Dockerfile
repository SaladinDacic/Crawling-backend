FROM node:latest
WORKDIR /app
COPY package.json .
COPY . .
RUN npm install
RUN npm install pg --force
EXPOSE 3001
CMD ["npm", "start"] 