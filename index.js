const fs = require('fs')
const { globSync } = require('glob')
const { markdownToBlocks } = require('@tryfabric/martian')
const { Client } = require('@notionhq/client')
const { execSync } = require('child_process')

const REQUIRED_ENV_VARS = ['FOLDER', 'NOTION_TOKEN', 'NOTION_ROOT_PAGE_ID']
const DEBUG = !!process.env.DEBUG
const SLEEP_BETWEEN_REQUESTS_INTERVAL = 1

// TODO: NEXT: add content-only update (no pages re-creation)

REQUIRED_ENV_VARS.forEach((varName) => {
  if (!process.env[varName]) {
    console.log(`${varName} not provided`)
    process.exit(1)
  }
})

// Notion api will responde with errors if no timeout used between requests
const sleepAfterApiRequest = function (interval) {
  const sleepInterval = interval || SLEEP_BETWEEN_REQUESTS_INTERVAL
  DEBUG && console.log(`sleep ${sleepInterval} sec.`)
  execSync(`sleep ${sleepInterval}`)
}

const notionUrlMatch = process.env.NOTION_ROOT_PAGE_ID.match(/[^-]*$/)
if (notionUrlMatch == null) {
  throw new SyntaxError('Provided page was not in a valid format, url must end with "-<page-id>"')
}
const notionPageId = notionUrlMatch[0]

const notion = new Client({
  auth: process.env.NOTION_TOKEN
})

notion.pages.retrieve({ page_id: notionPageId }).then((rootPage) => {
  sleepAfterApiRequest()

  const files = globSync(`${process.env.FOLDER}/**/*.md`, { ignore: 'node_modules/**' })
  DEBUG && console.log('Files to sync ->', files)

  notion.blocks.children.list({ block_id: notionPageId }).then((blocksResponse) => {
    sleepAfterApiRequest()

    // console.log('blocks -> ', JSON.stringify(blocksResponse))

    const blockIdsToRemove = blocksResponse.results.map((e) => e.id)

    // sequencially delete all page blocks
    const doDelete = function (idToDelete) {
      if (!idToDelete) return

      notion.blocks.delete({
        block_id: idToDelete
      }).then(function () {
        console.log('Block deleted:', idToDelete)

        sleepAfterApiRequest()

        if (idToDelete !== blockIdsToRemove[blockIdsToRemove.length - 1]) {
          const nextDeleteId = blockIdsToRemove[blockIdsToRemove.indexOf(idToDelete) + 1]
          doDelete(nextDeleteId)
        } else {
          console.log('Block deletion complete')
          sleepAfterApiRequest(2)
          doCreate(files[0])
        }
      })
    }

    // sequencially create new pages
    const doCreate = (filePath) => {
      const mdContent = fs.readFileSync(filePath, 'utf8')
      const newBlocks = markdownToBlocks(mdContent)

      let title

      try {
        title = newBlocks[0][newBlocks[0].type].rich_text[0].text.content
      } catch (error) {
        console.log('Cannot extract page title from', newBlocks[0])
        process.exit(1)
      }

      notion.pages.create({
        parent: {
          type: 'page_id',
          page_id: rootPage.id
        },
        properties: {
          title: {
            title: [{ text: { content: title } }], type: 'title'
          }
        }
      }).then((pageResponse) => {
        console.log('Page created', title)

        sleepAfterApiRequest()

        notion.blocks.children.append({ block_id: pageResponse.id, children: newBlocks }).then(() => {
          // process next page
          if (filePath !== files[files.length - 1]) {
            doCreate(files[files.indexOf(filePath) + 1])
          } else {
            console.log('Pages creation complete')
          }
        })
      }).catch((error) => {
        console.log('Page creation failed', error)
        process.exit(1)
      })
    }

    doDelete(blockIdsToRemove[0])
  })
}).catch((error) => {
  console.log('Root page not found', error.body)
  process.exit(1)
})
