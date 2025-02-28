const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const beautify = require('js-beautify').html

function loopThroughFilesSync (dir) {
  let fileList = []
  const files = fs.readdirSync(dir, { withFileTypes: true })
  files.forEach(file => {
    const filePath = path.join(dir, file.name)
    if (file.isDirectory()) fileList = fileList.concat(loopThroughFilesSync(filePath)) // recurse dirs
    else if (file.isFile() && !file.name.startsWith('.')) fileList.push(filePath) // exclude hidden files
  })
  return fileList
}

function isBinaryFile (filePath, bytesToCheck = 512) {
  const buffer = Buffer.alloc(bytesToCheck)
  const fd = fs.openSync(filePath, 'r')
  const bytesRead = fs.readSync(fd, buffer, 0, bytesToCheck, 0)
  fs.closeSync(fd)
  for (let i = 0; i < bytesRead; i++) {
    const byte = buffer[i]
    if (byte === 0) return true // null byte found, likely a binary file
    else if ((byte < 32 || byte > 126) && byte !== 10 && byte !== 13 && byte !== 9) return true // non-printable ascii character found, likely a binary file; allow common control characters: \n (10), \r (13), \t (9)
  }
  return false
}

module.exports = (params) => {
  const beautifyOptions = params?.beautifyOptions || {
    indent_size: 2
  }

  // find all <template> elements with ids that are defined in any of the html templates
  const templateFiles = loopThroughFilesSync(params.templatesDir)
  const allTemplateElements = {}
  for (const templateFile of templateFiles) {
    if (!isBinaryFile(templateFile)) {
      const dom = new JSDOM(fs.readFileSync(templateFile, 'utf8'))
      const document = dom.window.document
      const allElements = document.querySelectorAll('*')
      const templateElements = Array.from(allElements).filter(element => element.tagName === 'TEMPLATE')
      for (const templateElement of templateElements) {
        if (templateElement.id) allTemplateElements[templateElement.id] = templateElement
      }
    }
  }

  // replace web components in all template files with a progressive enhancement-friendly version of the element
  const editedFiles = {}
  for (const templateFile of templateFiles) {
    const templateCode = fs.readFileSync(templateFile, 'utf8')
    if (!isBinaryFile(templateFile)) {
      let dom
      let document
      let partial = false
      if (templateCode.trimStart().startsWith('<!DOCTYPE') || templateCode.trimStart().startsWith('<!doctype')) {
        dom = new JSDOM(templateCode)
        document = dom.window.document
      } else {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
        document = dom.window.document
        const fragment = JSDOM.fragment(templateCode)
        document.body.appendChild(fragment)
        partial = true
      }
      const customElements = Array.from(document.querySelectorAll('*')).filter(element => element.tagName.includes('-')) // if there is a hyphen in the element name, it is a custom element
      for (const element of customElements) {
        if (!allTemplateElements[element.tagName.toLowerCase()]) continue // no <template> element found for this custom element, so do not convert it into a progressive enhancement-friendly version of the element

        // clone the <template> markup so we can construct a more verbose, progressive enhancement-compatible version of the web component
        const template = allTemplateElements[element.tagName.toLowerCase()].content.cloneNode(true)

        // remove elements that are not needed in the progressive enhancement context from the <template> markup
        template.querySelectorAll('style, script, slot').forEach(el => el.remove())

        // replace template literals with attribute values in the <template> markup
        const container = document.createElement('div')
        container.appendChild(template)
        for (const attrib of element.attributes) container.innerHTML = container.innerHTML.replace(new RegExp(`\\$\\{${attrib.name}\\}`, 'gi'), attrib.value)
        const componentBeautifyOptions = { ...beautifyOptions }
        componentBeautifyOptions.preserve_newlines = false // remove newlines from components in case any style, script, or slot elements have been removed
        container.innerHTML = beautify(container.innerHTML, componentBeautifyOptions)

        // move any component child elements with slot attributs to the root of the component's light dom because such elements always need to be at the root to be accepted by the web component JS
        element.querySelectorAll('[slot]').forEach(slot => container.appendChild(slot.cloneNode(true)))

        // replace the original custom element with the new progressive enhancement-friendly version of the element
        element.innerHTML = params?.disableBeautify ? container.innerHTML : beautify(container.innerHTML, beautifyOptions)
        let newFile = partial ? document.body.innerHTML : dom.serialize()
        newFile = params?.disableBeautify ? newFile : beautify(newFile, beautifyOptions)
        editedFiles[templateFile] = newFile
      }
    }
  }

  return editedFiles
}
