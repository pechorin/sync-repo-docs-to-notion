FROM node:current-alpine

ARG FOLDER
# ARG NOTION_TOKEN
# ARG NOTION_ROOT_ID

ENV FOLDER $FOLDER

# Copies your code file from your action repository to the filesystem path `/` of the container
# COPY entrypoint.sh /entrypoint.sh

RUN npm install
ENTRYPOINT ["npm run sync"]