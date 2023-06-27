# Sync repository documentation to Notion

- markdown files sync supported only

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
        uses: pechorin/sync-repo-docs-to-notion@main
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_ROOT_PAGE_ID: https://www.notion.so/MyRootPage-jdskdjs8yd83dheeee
          FOLDER: "${{ github.workspace }}/documentation"
```
