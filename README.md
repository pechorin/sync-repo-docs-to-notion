# Sync repository documentation to Notion

- markdown files sync supported only
- autofix relative repository urls
- syncs only updated documents
- no images support for now (instead please use mermaid.js embeddable diagrams)
- appends md5:hash to each document (to check for changes)

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
          FOLDER: "${{ github.workspace }}"
          RELATIVE_URLS_ROOT: "${{ github.server_url }}/${{ github.repository }}"
          IGNORE_CREATE_ERRORS: 1
          DEBUG: 1
```

or with manual launch:

```yaml
on: workflow_dispatch
```

or launch only if any .md files changed:

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
      - name: get changed files
        id: changed-files-specific
        uses: tj-actions/changed-files@v37
        with:
          files: |
            *.md
      - name: sync repo docs to notions
        if: steps.changed-files-specific.outputs.any_changed == 'true'
        uses: pechorin/sync-repo-docs-to-notion@main
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_ROOT_PAGE_ID: https://www.notion.so/MyRootPage-jdskdjs8yd83dheeee
          FOLDER: "${{ github.workspace }}"
          RELATIVE_URLS_ROOT: "${{ github.server_url }}/${{ github.repository }}"
          IGNORE_CREATE_ERRORS: 1
          DEBUG: 1
```

### Warnings
- Deletion is slow, if you changed a lot of documents it's easier to cleanup Notion first, and then run the action
