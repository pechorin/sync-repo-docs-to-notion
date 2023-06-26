const fs = require("fs");
const { globSync } = require("glob");
const { markdownToBlocks } = require('@tryfabric/martian');
const { Client } = require("@notionhq/client");
const { nextTick } = require("process");
const { root } = require("@tryfabric/martian/build/src/markdown");

// TODO: add sleep interval for all requests
// TODO: fix tables width
// TODO: NEXT: add content-only update (no pages re-creation)

['FOLDER', 'NOTION_TOKEN', 'NOTION_ROOT_ID'].forEach((varName) => {
  if (!process.env[varName]) {
    console.log(`${varName} not provided`)
    process.exit(1)
  }
})

const notionUrlMatch = process.env.NOTION_ROOT_ID.match(/[^-]*$/)
if (notionUrlMatch == null) {
  throw new SyntaxError('Provided page was not in a valid format, url must end with "-<page-id>"');
}
const notionPageId = notionUrlMatch[0]

const notion = new Client({
  auth: process.env.NOTION_TOKEN 
})

notion.pages.retrieve({ page_id: notionPageId }).then((rootPage) => {
  // console.log("Root page-> ", rootPage)

  var files = globSync(`${process.env.FOLDER}/**/*.md`, { ignore: 'node_modules/**' })
  // console.log("Files to sync ->", files)

  notion.blocks.children.list({block_id: notionPageId}).then((blocksResponse) => {
    const blockIdsToRemove = blocksResponse.results.map((e) => e.id)

    // sequencially delete all page blocks
    var doDelete = function(idToDelete) {
      if (!idToDelete) return;

      notion.blocks.delete({
        block_id: idToDelete
      }).then(function() {
        console.log("Block deleted:", idToDelete)
        if (idToDelete != blockIdsToRemove[blockIdsToRemove.length - 1]) {
          nextDeleteId = blockIdsToRemove[blockIdsToRemove.indexOf(idToDelete) + 1]
          doDelete(nextDeleteId)
        }
      })
    }

    doDelete(blockIdsToRemove[0])
    console.log('Block deletion complete')

    var doCreate = (filePath) => {
      const mdContent = fs.readFileSync(filePath, 'utf8')
      const newBlocks = markdownToBlocks(mdContent)

      var title

      try {
        title = newBlocks[0][newBlocks[0].type].rich_text[0].text.content
      } catch (error) {
        console.log("Cannot extract page title from", newBlocks[0])
        process.exit(1)
      }

      notion.pages.create({
        parent: {
          type: "page_id",
          page_id: rootPage.id
        },
        properties: {
          "title": {
            "title": [{ "text": { "content": title} }], type: "title"
          }
        },
      }).then((pageResponse) => {
        console.log('Page created', pageResponse)

        notion.blocks.children.append({ block_id: pageResponse.id, children: newBlocks }).then(() => {
          // process next page
          if (filePath != files[files.length - 1]) {
            doCreate(files[files.indexOf(filePath) + 1])
          }
        })

      }).catch((error) => {
        console.log("Page creation failed", error)
        process.exit(1)
      })
    }

    doCreate(files[0])
  })

}).catch((error) => {
  console.log("Root page not found", error.body)
  process.exit(1)
})