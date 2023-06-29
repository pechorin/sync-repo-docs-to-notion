const fs = require('fs')
const { globSync } = require('glob')
const { markdownToBlocks } = require('@tryfabric/martian')
const { Client } = require('@notionhq/client')
const { execSync } = require('child_process')

const REQUIRED_ENV_VARS = ['FOLDER', 'NOTION_TOKEN', 'NOTION_ROOT_PAGE_ID', 'RELATIVE_URLS_ROOT']
const DEBUG = !!process.env.DEBUG
const IGNORE_CREATE_ERRORS = process.env.IGNORE_CREATE_ERRORS !== undefined ? !!process.env.IGNORE_CREATE_ERRORS : true
const SLEEP_BETWEEN_REQUESTS_INTERVAL = 1

// TODO: NEXT: add content-only update (no pages re-creation)
// TODO: NEXT: add folders list support

const validateRequiredEnvVariables = () => {
  REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      console.log(`${varName} not provided`)
      process.exit(1)
    }
  })
}

// Notion api will responde with errors if no timeout used between requests
const sleepAfterApiRequest = function (interval) {
  const sleepInterval = interval || SLEEP_BETWEEN_REQUESTS_INTERVAL
  DEBUG && console.log(`sleep ${sleepInterval} sec.`)
  execSync(`sleep ${sleepInterval}`)
}

const getNotionRootPageId = () => {
  const notionUrlMatch = process.env.NOTION_ROOT_PAGE_ID.match(/[^-]*$/)
  if (notionUrlMatch == null) {
    throw new SyntaxError('Provided page was not in a valid format, url must end with "-<page-id>"')
  }
  return notionUrlMatch[0]
}

const notion = new Client({
  auth: process.env.NOTION_TOKEN
})

const deleteBlocksSequentially = function (idToDelete, allIdsToDelete) {
  if (!idToDelete) {
    return new Promise((resolve, _reject) => {
      resolve()
    })
  }

  const deleteOne = (id, ids, resolve, reject) => {
    notion.blocks.delete({
      block_id: id
    }).then(function () {
      console.log('Block deleted:', id)

      sleepAfterApiRequest()

      if (id !== ids[ids.length - 1]) {
        const nextDeleteId = ids[ids.indexOf(id) + 1]
        deleteOne(nextDeleteId, ids, resolve, reject)
      } else {
        console.log('Block deletion complete')
        sleepAfterApiRequest(2)

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

const deepReplaceValue = function(target, lookupKey, newValueFn) {
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

const createPagesSequentially = function (fileToCreate, allFilesToCreate, rootPage) {
  const createOne = (file, files, resolve, reject) => {
    const mdContent = fs.readFileSync(file, 'utf8')
    let newBlocks = markdownToBlocks(mdContent)

    let title = file.split(process.env.FOLDER).splice(-1)[0]
    title = title.replace(/^\//, '')
    title = title.replace('.md', '')
    // console.log(JSON.stringify(newBlocks))

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
      } else if (url.match(/\.png$|\.jpg$|\.jpeg$|\.webp/)) {
        DEBUG && console.log('fixing img url -> ', url)
        return `${process.env.RELATIVE_URLS_ROOT}/blob/master/${url}`
      } else {
        DEBUG && console.log('fixing relative url -> ', url)
        return `${process.env.RELATIVE_URLS_ROOT}/tree/master/${url}`
      }
    })

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

      try {
        notion.blocks.children.append({ block_id: pageResponse.id, children: newBlocks }).then(() => {
          // process next page
          if (file !== files[files.length - 1]) {
            createOne(files[files.indexOf(file) + 1], files, resolve, reject)
          } else {
            resolve()
          }
        }).catch((error) => {
          if (IGNORE_CREATE_ERRORS) {
            console.log('Page creation failed, but error ignored ', error)

            sleepAfterApiRequest()

            if (file !== files[files.length - 1]) {
              createOne(files[files.indexOf(file) + 1], files, resolve, reject)
            } else {
              resolve()
            }
          } else {
            reject(error)
          }
        })
      } catch (error) {
      }
    }).catch((error) => {
      reject(error)
    })
  }

  const resultPromise = new Promise((resolve, reject) => {
    createOne(fileToCreate, allFilesToCreate, resolve, reject)
  })

  return resultPromise
}

const run = function () {
  DEBUG && console.log('Running inside folder: ', process.env.FOLDER)

  notion.pages.retrieve({ page_id: getNotionRootPageId() }).then((rootPage) => {
    sleepAfterApiRequest()

    let files = globSync(`${process.env.FOLDER}/**/*.md`, { ignore: 'node_modules/**' })

    // pop readme to top
    const readmePath = `${process.env.FOLDER}/README.md`
    if (files.includes(readmePath)) {
      files = files.filter((path) => path !== readmePath)
      files = [readmePath, ...files]
    }

    DEBUG && console.log('Files to sync ->', files)

    notion.blocks.children.list({ block_id: getNotionRootPageId() }).then((blocksResponse) => {
      sleepAfterApiRequest()

      const blockIdsToRemove = blocksResponse.results.map((e) => e.id)

      deleteBlocksSequentially(blockIdsToRemove[0], blockIdsToRemove, rootPage).then(() => {
        createPagesSequentially(files[0], files, rootPage).then(() => {
          console.log('Pages creation complete')
        }).catch((error) => {
          console.log('Creation failed', error)
          process.exit(1)
        })
      }).catch((error) => {
        console.log('Deletion failed', error)
        process.exit(1)
      })
    })
  }).catch((error) => {
    console.log('Root page not found', error)
    process.exit(1)
  })
}

validateRequiredEnvVariables()
run()
