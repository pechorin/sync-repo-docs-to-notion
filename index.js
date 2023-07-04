const fs = require('fs')
const crypto = require('crypto')

const { globSync } = require('glob')
const { markdownToBlocks } = require('@tryfabric/martian')
const { Client } = require('@notionhq/client')
const { title } = require('process')

const REQUIRED_ENV_VARS = ['FOLDER', 'NOTION_TOKEN', 'NOTION_ROOT_PAGE_ID', 'RELATIVE_URLS_ROOT']
const DEBUG = !!process.env.DEBUG
const IGNORE_CREATE_ERRORS = process.env.IGNORE_CREATE_ERRORS !== undefined ? !!process.env.IGNORE_CREATE_ERRORS : true

const DOCUMENT_HASH_TAG_REGEXP = /^md5:/

const notion = new Client({
  auth: process.env.NOTION_TOKEN
})

// TODO: delete page instead of many blocks for updates? (optionable)
// TODO: append github link to footer for each doc?
// FIX: fixing relative url ->  mailto:Protobuf@2.6
// TODO: NEXT: add folders list support ?
// TODO: how to import images?

const validateRequiredEnvVariables = () => {
  REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      console.log(`${varName} not provided`)
      process.exit(1)
    }
  })
}

const getNotionRootPageId = () => {
  const notionUrlMatch = process.env.NOTION_ROOT_PAGE_ID.match(/[^-]*$/)
  if (notionUrlMatch == null) {
    throw new SyntaxError('Provided page was not in a valid format, url must end with "-<page-id>"')
  }
  return notionUrlMatch[0]
}

const getFilesToProcess = () => {
  let files = globSync(`${process.env.FOLDER}/**/*.md`, { ignore: 'node_modules/**' })

  // pop readme to top
  const readmePath = `${process.env.FOLDER}/README.md`
  if (files.includes(readmePath)) {
    files = files.filter((path) => path !== readmePath)
    files = [readmePath, ...files]
  }

  return files
}

const deleteBlocksSequentially = function (idToDelete, allIdsToDelete) {
  if (!idToDelete) return new Promise((resolve, _reject) => resolve())

  const deleteOne = (id, ids, resolve, reject) => {
    notion.blocks.delete({
      block_id: id
    }).then(function () {
      console.log('Block deleted:', id)

      if (id !== ids[ids.length - 1]) {
        const nextDeleteId = ids[ids.indexOf(id) + 1]
        deleteOne(nextDeleteId, ids, resolve, reject)
      } else {
        console.log('Block deletion complete')

        resolve()
      }
    }).catch((error) => {
      reject(error)
    })
  }

  const resultPromise = new Promise((resolve, reject) => {
    deleteOne(idToDelete, allIdsToDelete, resolve, reject)
  })

  return resultPromise
}

const deepReplaceValue = (target, lookupKey, newValueFn) => {
  if (Array.isArray(target)) {
    target.forEach((obj) => {
      deepReplaceValue(obj, lookupKey, newValueFn)
    })
  } else if (typeof target === 'object') {
    for (const key in target) {
      if (typeof target[key] === 'object') {
        deepReplaceValue(target[key], lookupKey, newValueFn)
      } else {
        if (key === lookupKey) {
          target[key] = newValueFn(target[key])
        }
      }
    }
  }
  return target
}

const titleFromFilePath = (filePath) => {
  let title = filePath.split(process.env.FOLDER).splice(-1)[0]
  title = title.replace(/^\//, '')

  return title.replace('.md', '')
}

const titleToFilePath = (filePath) => {
  return `${process.env.FOLDER}/${filePath}.md`
}

const fileToNotionBlocks = (filePath) => {
  const mdContent = fs.readFileSync(filePath, 'utf8')
  let newBlocks = markdownToBlocks(mdContent)

  const fileHash = crypto.createHash('md5').update(mdContent).digest('hex')
  const hashBlock = markdownToBlocks(`md5:${fileHash}`)
  newBlocks.push(hashBlock[0])

  // fix relative urls
  newBlocks = deepReplaceValue(JSON.parse(JSON.stringify(newBlocks)), 'url', (url) => {
    if (url.match(/^http/)) {
      return url
    } else if (url.match(/^#/)) {
      DEBUG && console.log('fixing #-url -> ', url)
      // FIXME: don't know what to do with this problem
      //        url likes this:
      //        #1.-сделки-и-договоры-сделки-post
      return process.env.RELATIVE_URLS_ROOT
    // } else if (url.match(/\.png$|\.jpg$|\.jpeg$|\.webp/)) {
    //   DEBUG && console.log('fixing img url -> ', url)
    //   return `${process.env.RELATIVE_URLS_ROOT}/blob/master/${url}`
    } else {
      DEBUG && console.log('fixing relative url -> ', url)
      return `${process.env.RELATIVE_URLS_ROOT}/tree/master/${url}`
    }
  })

  return newBlocks
}

const createPagesSequentially = (fileToCreate, allFilesToCreate, rootPage) => {
  if (!fileToCreate) return new Promise((resolve, _reject) => resolve())

  const createOne = (file, files, resolve, reject) => {
    const newBlocks = fileToNotionBlocks(file)
    const title = titleFromFilePath(file)

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

      notion.blocks.children.append({ block_id: pageResponse.id, children: newBlocks }).then(() => {
        // process next page
        if (file !== files[files.length - 1]) {
          createOne(files[files.indexOf(file) + 1], files, resolve, reject)
        } else {
          resolve()
        }
      }).catch((error) => {
        if (IGNORE_CREATE_ERRORS) {
          console.log('Blocks appending failed, but error ignored ', error)

          if (file !== files[files.length - 1]) {
            createOne(files[files.indexOf(file) + 1], files, resolve, reject)
          } else {
            resolve()
          }
        } else {
          reject(error)
        }
      })
    }).catch((error) => {
      reject(error)
    })
  }

  const resultPromise = new Promise((resolve, reject) => {
    createOne(fileToCreate, allFilesToCreate, resolve, reject)
  })

  return resultPromise
}

const updatePagesSequentially = (fileToUpdate, filesToUpdate, blocksWithChildPages) => {
  if (!fileToUpdate) return new Promise((resolve, _reject) => resolve())

  const updateOne = (file, files, resolve, reject) => {
    const finalize = () => {
      if (files.slice(-1)[0] === file) {
        resolve()
      } else {
        updateOne(files[files.indexOf(file) + 1], files, resolve, reject)
      }
    }

    const blockWithChildPage = blocksWithChildPages.filter((r) => {
      return r.child_page?.title === titleFromFilePath(file)
    })[0]
    if (!blockWithChildPage) {
      console.log('block not found on readme, skip ... (this is error)', file)
      return finalize()
    } // or error?

    notion.blocks.children.list({ block_id: blockWithChildPage.id }).then((pageBlocksResponse) => {
      const updatedNotionBlocks = fileToNotionBlocks(file)

      // change detection
      let isChanged = false
      const fileContent = fs.readFileSync(file, 'utf8')
      const fileMD5 = crypto.createHash('md5').update(fileContent).digest('hex')
      const md5Block = pageBlocksResponse.results.slice(-1)[0]
      const md5RichText = md5Block?.paragraph?.rich_text[0]

      if (md5RichText?.text?.content?.match(DOCUMENT_HASH_TAG_REGEXP)) {
        const md5 = md5RichText.text.content.split(DOCUMENT_HASH_TAG_REGEXP).slice(-1)[0]

        if (md5 !== fileMD5) isChanged = true
      } else {
        isChanged = true
      }

      DEBUG && console.log('is changed ->', file, isChanged)

      const idsToRemove = pageBlocksResponse.results.map((e) => e.id)

      if (isChanged) {
        deleteBlocksSequentially(idsToRemove[0], idsToRemove).then(() => {
          // update page with new content
          notion.blocks.children.append({
            block_id: blockWithChildPage.id,
            children: updatedNotionBlocks
          }).then(() => {
            finalize()
          }).catch((error) => {
            if (IGNORE_CREATE_ERRORS) {
              console.log('Blocks appending failed, error ignored', error)
              console.log('Try append error on page')

              const errorBlocks = markdownToBlocks(`Blocks appending failed with error: ${error}`)

              notion.blocks.children.append({
                block_id: blockWithChildPage.id,
                children: errorBlocks
              }).then(() => {
                finalize()
              })
              finalize()
            } else {
              reject(error)
            }
          })
        })
      } else {
        finalize()
      }
    })
  }

  const resultPromise = new Promise((resolve, reject) => {
    updateOne(fileToUpdate, filesToUpdate, resolve, reject)
  })

  return resultPromise
}

const run = function () {
  DEBUG && console.log('Running inside folder: ', process.env.FOLDER)

  notion.pages.retrieve({ page_id: getNotionRootPageId() }).then((rootPage) => {
    // DEBUG && console.log('Files to sync ->', filesToCreate)
    // const toCreate = filesToCreate.map((e) => titleFromFilePath(e))

    notion.blocks.children.list({ block_id: getNotionRootPageId() }).then((blocksResponse) => {
      const current = blocksResponse.results.map((e) => titleToFilePath(e.child_page.title))
      // console.log('created titles ->', current)

      const toCreate = getFilesToProcess()
      const updateList = toCreate.filter((e) => current.includes(e))
      const createList = toCreate.filter((e) => !current.includes(e))
      const deleteList = current.filter((e) => !toCreate.includes(e))

      console.log('createList ->', createList)
      console.log('updateList ->', updateList)
      console.log('deleteList ->', deleteList)

      updatePagesSequentially(updateList[0], updateList, blocksResponse.results).then(() => {
        console.log('--- all pages updated')

        createPagesSequentially(createList[0], createList, rootPage).then(() => {
          console.log('--- new pages created')

          deleteBlocksSequentially(deleteList[0], deleteList).then(() => {
            console.log('--- sync complete')
          })
        })
      })
    })
  }).catch((error) => {
    console.log('Root page not found', error)
    process.exit(1)
  })
}

validateRequiredEnvVariables()
run()
