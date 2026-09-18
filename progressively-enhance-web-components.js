const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const beautify = require('js-beautify').html

function loopThroughFilesSync (dir) {
  let fileList = []
  let files
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return fileList
  }
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

// jsdom complains about css it cannot parse, which is not something the caller can do anything about
//
// silencing it is done around the parse and undone afterwards, rather than once when this module is loaded: console.error belongs to whatever application is calling this, and it should not lose an error of its own for as long as the process lives because a stylesheet somewhere is unparseable
const jsDomCssError = 'Error: Could not parse CSS stylesheet'
function withoutJsdomCssComplaints (work) {
  const originalConsoleError = console.error
  console.error = (...params) => {
    if (!params.find(p => p.toString().includes(jsDomCssError))) originalConsoleError(...params)
  }
  try {
    return work()
  } finally {
    console.error = originalConsoleError
  }
}

// where the opening tag that begins at `from` ends
//
// the quotes are followed so that a greater than sign inside an attribute value does not look like the end of the tag
function endOfOpeningTag (markup, from) {
  let quote = null
  for (let i = from; i < markup.length; i++) {
    const character = markup[i]
    if (quote) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") quote = character
    else if (character === '>') return i
  }
  return -1
}

// the span of markup an element occupies, from the < that opens it to the > that closes it
//
// a regular expression cannot answer this. it has no way to pair an opening tag with the closing tag that belongs to it, so an element holding another of the same name ended at the inner closing tag and left the outer one behind as stray text
function elementSpan (markup, name, start) {
  const openingTagEnd = endOfOpeningTag(markup, start)
  if (openingTagEnd === -1) return null
  if (markup[openingTagEnd - 1] === '/') return { start, end: openingTagEnd + 1 } // closed itself, so there is no closing tag to pair it with
  const lowerMarkup = markup.toLowerCase()
  const opening = `<${name.toLowerCase()}`
  const closing = `</${name.toLowerCase()}`
  let depth = 1
  let at = openingTagEnd + 1
  while (at < markup.length) {
    const nextOpening = lowerMarkup.indexOf(opening, at)
    const nextClosing = lowerMarkup.indexOf(closing, at)
    if (nextClosing === -1) return null // never closed
    if (nextOpening !== -1 && nextOpening < nextClosing) {
      // a longer name beginning the same way is a different element: <my-thing> is not <my-thing-two>
      if (/[\s/>]/.test(markup[nextOpening + opening.length] || '')) depth++
      at = nextOpening + opening.length
      continue
    }
    const closingTagEnd = markup.indexOf('>', nextClosing)
    if (closingTagEnd === -1) return null
    depth--
    if (depth === 0) return { start, end: closingTagEnd + 1 }
    at = closingTagEnd + 1
  }
  return null
}

// every place an element of this name is written, outermost first
function elementSpans (markup, name) {
  const spans = []
  const lowerMarkup = markup.toLowerCase()
  const opening = `<${name.toLowerCase()}`
  let at = 0
  while (at < markup.length) {
    const found = lowerMarkup.indexOf(opening, at)
    if (found === -1) break
    if (!/[\s/>]/.test(markup[found + opening.length] || '')) { // a different element whose name begins the same way
      at = found + opening.length
      continue
    }
    const span = elementSpan(markup, name, found)
    if (!span) break
    spans.push(span)
    at = span.end // whatever is nested inside this element is replaced along with it
  }
  return spans
}

// the ways an invocation can be enhanced
//
// `light` writes the component's markup into the element as fallback content, which is what this module has always done. `shadow` writes it into a declarative shadow root instead, which keeps the styles and slots a fallback cannot use and needs nothing swapped once the component upgrades. `both` writes each of them, so that a browser which builds the shadow root renders that and one which does not renders the fallback
const MODES = new Set(['light', 'shadow', 'both'])

// what says an invocation has been enhanced already, so that running this over the same markup twice does not stack a second copy of everything onto it
//
// this module adds it to every element it touches, and a developer who has written a component's markup out for themselves can write it too, which is how such an invocation is left as it stands
const ENHANCED_ATTRIBUTE = 'data-enhanced'

// an element carrying a declarative shadow root already was written out by hand, and a second one is not something a browser will build: it refuses it and reports the refusal to the console. so that element is left alone whether or not anyone marked it
function alreadyEnhanced (element) {
  if (element.hasAttribute(ENHANCED_ATTRIBUTE)) return true
  for (const child of element.children) {
    if (child.tagName === 'TEMPLATE' && child.hasAttribute('shadowrootmode')) return true
  }
  return false
}

// the name of a slot no component defines, which is what keeps the fallback markup of `both` out of the component
//
// a browser that builds the shadow root leaves a child naming a slot that does not exist unassigned, and an unassigned child is not rendered, so the fallback sits there inert. without the name a default <slot> would catch it and project the fallback back into the component beside the real content. a browser that does not build the shadow root has no slots to assign anything to, ignores the attribute, and renders the fallback, which is the whole point of it
const FALLBACK_SLOT = 'pewc-fallback'

// marks every top level node of the fallback markup as belonging to that slot
function holdOutOfSlots (container) {
  for (const node of [...container.childNodes]) {
    if (node.nodeType === 1) node.setAttribute('slot', FALLBACK_SLOT) // an element can carry the attribute itself
    else if (node.nodeType === 3 && node.textContent.trim()) { // text cannot, so it is given something that can
      const wrapper = container.ownerDocument.createElement('span')
      node.replaceWith(wrapper)
      wrapper.setAttribute('slot', FALLBACK_SLOT)
      wrapper.appendChild(node)
    }
  }
}

module.exports = (params) => {
  const beautifyOptions = params?.beautifyOptions || {
    indent_size: 2
  }
  const beautifyMarkup = markup => params?.disableBeautify ? markup : beautify(markup, beautifyOptions)

  // the dom serializer writes an empty attribute out as data-enhanced="", which says the same thing as the bare form but is not what anyone writing it by hand would write
  const bareEnhancedAttribute = markup => markup.replace(new RegExp(`\\s${ENHANCED_ATTRIBUTE}=""`, 'g'), ` ${ENHANCED_ATTRIBUTE}`)

  // what to do with an invocation whose definition does not say for itself
  const defaultMode = params?.mode || 'both'
  if (!MODES.has(defaultMode)) throw new Error(`progressively-enhance-web-components: mode must be one of ${[...MODES].join(', ')}, not ${JSON.stringify(defaultMode)}`)

  // every file that could hold a template or an invocation of one, read once
  //
  // reading them once is not only quicker: the enhanced markup of one custom element is what the next one is applied to, so a file invoking two of them ends up with both enhanced. re-reading the file for each custom element meant each started again from what was on disk, and only the last one survived into what this returns
  const files = {}
  for (const file of loopThroughFilesSync(params.templatesDir)) {
    if (!isBinaryFile(file)) files[file] = fs.readFileSync(file, 'utf8')
  }

  // find all <template> elements with ids that are defined in any of the html templates
  const allTemplateElements = {}
  withoutJsdomCssComplaints(() => {
    for (const contents of Object.values(files)) {
      const { document } = new JSDOM(contents).window
      for (const templateElement of document.querySelectorAll('template')) {
        if (!templateElement.id) continue
        // a definition may say how it wants to be enhanced, which is a property of the component rather than of any one place it is used
        const mode = templateElement.getAttribute('mode') || defaultMode
        if (!MODES.has(mode)) throw new Error(`progressively-enhance-web-components: <template id="${templateElement.id}"> asks for mode ${JSON.stringify(mode)}, which is not one of ${[...MODES].join(', ')}`)
        allTemplateElements[templateElement.id] = { definition: templateElement, mode }
      }
    }
  })

  // what one invocation of a custom element becomes
  function enhance (invocation, customElement) {
    // make a dom just for modifying this element
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    const document = dom.window.document
    document.body.appendChild(JSDOM.fragment(invocation))

    // the element we're modifying
    const element = document.body.firstChild
    const { definition, mode } = allTemplateElements[customElement]

    // an invocation that has been enhanced already is handed back exactly as it came in, rather than reformatted, so that nothing about it changes
    if (alreadyEnhanced(element)) return invocation

    // js-beautify treats <template> as an inline element and so will not break the line before one. the pieces of a component are put on lines of their own here instead, which it then indents. with beautifying turned off they are joined as they were, this module having been asked to leave the markup alone
    const gap = params?.disableBeautify ? '' : '\n'

    // the component's markup, with the attribute values written on this invocation put where its template literals were
    //
    // a shadow root renders the style, script and slot elements it is given, so it keeps them. light dom fallback markup can use none of them: a style element would leak to the rest of the page, a slot projects nothing when there is no shadow root to project it into, and a script would run a second time once the component upgrades. so they are removed from a fallback
    function componentMarkup (forShadowRoot) {
      // clone the <template> markup so we can construct a more verbose, progressive enhancement-compatible version of the web component
      const template = definition.content.cloneNode(true)

      // remove elements that are not needed in the progressive enhancement context from the <template> markup
      if (!forShadowRoot) template.querySelectorAll('style, script, slot').forEach(el => el.remove())

      // replace template literals with attribute values in the <template> markup
      const container = document.createElement('div')
      container.appendChild(template)
      for (const attrib of element.attributes) container.innerHTML = container.innerHTML.replace(new RegExp(`\\$\\{${attrib.name}\\}`, 'gi'), attrib.value)
      if (!params?.disableBeautify) {
        const componentBeautifyOptions = { ...beautifyOptions }
        componentBeautifyOptions.preserve_newlines = false // remove newlines from components in case any style, script, or slot elements have been removed
        container.innerHTML = beautify(container.innerHTML, componentBeautifyOptions)
      }
      return container
    }

    if (mode === 'light') {
      const fallback = componentMarkup(false)

      // move any component child elements with slot attributs to the root of the component's light dom because such elements always need to be at the root to be accepted by the web component JS
      element.querySelectorAll('[slot]').forEach(slot => fallback.appendChild(slot.cloneNode(true)))

      // replace the original custom element with the new progressive enhancement-friendly version of the element
      element.innerHTML = beautifyMarkup(fallback.innerHTML)
      element.setAttribute(ENHANCED_ATTRIBUTE, '')
      return bareEnhancedAttribute(beautifyMarkup(document.body.innerHTML))
    }

    // the other modes build a shadow root, and what the element already holds is the light dom the slots in that shadow root project, so it is kept as it was written rather than replaced
    //
    // nothing is hoisted out of it either: only a direct child of the element can be assigned to a slot, so moving one that is nested deeper would change which content the author had put where in order to make a slot claim it
    const light = element.innerHTML
    const pieces = [`<template shadowrootmode="open">${componentMarkup(true).innerHTML}</template>`]

    // `both` carries the fallback as well, held out of the component's slots so that it shows only where the shadow root was not built
    if (mode === 'both') {
      const fallback = componentMarkup(false)
      holdOutOfSlots(fallback)
      pieces.push(fallback.innerHTML)
    }

    if (light.trim()) pieces.push(light)
    element.innerHTML = gap + beautifyMarkup(pieces.join(gap))
    element.setAttribute(ENHANCED_ATTRIBUTE, '')
    return bareEnhancedAttribute(beautifyMarkup(document.body.innerHTML))
  }

  // find all invocations of each of the custom elements that are in allTemplateElements
  const editedFiles = {}
  withoutJsdomCssComplaints(() => {
    for (const file in files) {
      const original = files[file]
      let markup = original
      for (const customElement in allTemplateElements) { // loop through list of known custom elements
        // replace all invocations of this custom element with the progressive enhancement-friendly version
        //
        // the spans are rewritten back to front so that replacing one does not move the next
        for (const span of elementSpans(markup, customElement).reverse()) {
          markup = markup.slice(0, span.start) + enhance(markup.slice(span.start, span.end), customElement) + markup.slice(span.end)
        }
      }
      if (markup !== original) editedFiles[file] = markup
    }
  })

  return editedFiles
}
