# Sync repository documentation to Notion

- markdown files sync supported only
- autofix relative repository urls
- no images support for now (instead please use mermaid.js embeddable diagrams)

## Inputs

All configuration are done with environmnent variables for compability with other ci's.

## Outputs

## Example usage

```yaml
on:
  push:
    branches:
      - master
jobs:
  notion_sync:
    timeout-minutes: 10
    runs-on: [ubuntu]
    steps:
      - uses: actions/checkout@v3
      - name: sync repo docs to notions
        uses: rrebellion/sync-repo-docs-to-notion@main
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_ROOT_PAGE_ID: https://www.notion.so/MyRootPage-jdskdjs8yd83dheeee
          FOLDER: "${{ github.workspace }}"
          RELATIVE_URLS_ROOT: "${{ github.server_url }}/${{ github.repository }}"
          IGNORE_CREATE_ERRORS: 1
          DEBUG: 1
```
