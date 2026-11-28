const fs = require('fs')
const path = require('path')
const { JSDOM, VirtualConsole } = require('jsdom')
const beautify = require('js-beautify').html

const MODULE_NAME = 'progressively-enhance-web-components'

// every file under a directory, in an order that is the same on every platform
//
// the order matters: when two templates share an id the later one wins, and readdir hands entries back in whatever order the filesystem keeps them. hidden files and hidden directories are both skipped, so a .git or a .preprocessed_views folder kept inside the templates directory is not read as templates. symbolic links are followed, and a directory reached a second time through one is not walked again, so a link pointing back up the tree cannot loop forever
function loopThroughFilesSync (dir, visited = new Set()) {
  let realDir
  let entries
  try {
    realDir = fs.realpathSync(dir)
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  if (visited.has(realDir)) return []
  visited.add(realDir)
  const fileList = []
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(dir, entry.name)
    let kind = entry
    if (entry.isSymbolicLink()) {
      try {
        kind = fs.statSync(entryPath)
      } catch {
        continue // a link to nothing
      }
    }
    if (kind.isDirectory()) fileList.push(...loopThroughFilesSync(entryPath, visited))
    else if (kind.isFile()) fileList.push(entryPath)
  }
  return fileList
}

// the contents of a file, or null when it is not text this module should read
//
// a null byte near the start is the usual sign of a binary file, and checking only the start means a large image or video is not read in full just to be thrown away. anything else is read as utf-8 and rejected if it is not valid utf-8. testing each byte for printable ascii, as this once did, rejected every template holding an accented letter, a curly quote or an emoji, and so silently enhanced nothing in them
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
function readTextFile (filePath, bytesToCheck = 8000) {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const head = Buffer.alloc(bytesToCheck)
      const bytesRead = fs.readSync(fd, head, 0, bytesToCheck, 0)
      if (head.subarray(0, bytesRead).includes(0)) return null
    } finally {
      fs.closeSync(fd)
    }
    return utf8.decode(fs.readFileSync(filePath))
  } catch {
    return null
  }
}

// lower case the ascii letters and nothing else
//
// tag names are matched case insensitively by searching a lower cased copy of the markup and using the positions found in it on the original. String.prototype.toLowerCase cannot be used for that: a few characters lower case to more than one code unit, İ becoming i̇ for one, and every position after such a character would then point at the wrong place in the original
const asciiLowerCase = text => text.replace(/[A-Z]+/g, letters => letters.toLowerCase())

// whether the character after a tag name ends it, so that <my-thing> is not mistaken for <my-thing-two>
const endsTagName = character => /[\s/>]/.test(character || '')

// where the opening tag that begins at `from` ends
//
// quotes are followed so that a greater than sign inside an attribute value does not look like the end of the tag. a quote only opens a value straight after an equals sign, as it does for the html parser, so an apostrophe in a bare attribute such as <my-thing don't> does not swallow the rest of the file
function endOfOpeningTag (markup, from) {
  let quote = null
  let valueMayStart = false
  for (let i = from + 1; i < markup.length; i++) {
    const character = markup[i]
    if (quote) {
      if (character === quote) quote = null
    } else if (valueMayStart && (character === '"' || character === "'")) {
      quote = character
      valueMayStart = false
    } else if (character === '>') return i
    else if (character === '=') valueMayStart = true
    else if (!/\s/.test(character)) valueMayStart = false
  }
  return -1
}

// elements whose contents the html parser reads as text rather than as markup, so that a tag written inside one is not a tag at all
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'])

// the stretches of markup in which a custom element written there is not one this module should enhance
//
// those are comments, the contents of the raw text elements above, and <template> elements other than declarative shadow roots. a comment and a raw text element do not render what is written in them as elements at all: expanding an invocation written inside a <script> string broke the script by writing double quotes into it. a plain <template> is not rendered either, and one that defines a component is cloned by the component's own javascript, so it has to stay as it was written. a declarative shadow root is rendered by the parser, so a custom element inside one is enhanced like any other
//
// each range is [start, end), sorted and not overlapping
function ignoredRanges (markup, lowerMarkup) {
  const ranges = []
  let templateDepth = 0
  let templateStart = -1
  let at = 0
  while (true) {
    const lessThan = lowerMarkup.indexOf('<', at)
    if (lessThan === -1) break
    if (lowerMarkup.startsWith('<!--', lessThan)) {
      const commentEnd = lowerMarkup.indexOf('-->', lessThan + 4)
      const end = commentEnd === -1 ? markup.length : commentEnd + 3
      if (!templateDepth) ranges.push([lessThan, end])
      at = end
      continue
    }
    const tag = /^<(\/?)([a-z][^\s/>]*)/.exec(lowerMarkup.slice(lessThan, lessThan + 256))
    if (!tag) {
      at = lessThan + 1
      continue
    }
    const [, closing, name] = tag
    if (closing) {
      const end = lowerMarkup.indexOf('>', lessThan)
      at = end === -1 ? markup.length : end + 1
      if (name === 'template' && templateDepth && !--templateDepth) ranges.push([templateStart, at])
      continue
    }
    const openingTagEnd = endOfOpeningTag(markup, lessThan)
    if (openingTagEnd === -1) break
    if (name === 'plaintext') { // nothing after it is markup, not even a closing tag
      if (!templateDepth) ranges.push([lessThan, markup.length])
      at = markup.length
    } else if (RAW_TEXT_ELEMENTS.has(name)) {
      let close = lowerMarkup.indexOf(`</${name}`, openingTagEnd)
      while (close !== -1 && !endsTagName(lowerMarkup[close + name.length + 2])) close = lowerMarkup.indexOf(`</${name}`, close + 1)
      const closeEnd = close === -1 ? -1 : lowerMarkup.indexOf('>', close)
      const end = closeEnd === -1 ? markup.length : closeEnd + 1
      if (!templateDepth) ranges.push([lessThan, end])
      at = end
    } else {
      if (name === 'template') {
        // inside a plain template every nested template is counted, a shadow root or not, so that the closing tags pair up
        const isShadowRoot = /\sshadowrootmode\s*=/.test(lowerMarkup.slice(lessThan, openingTagEnd))
        if (templateDepth) templateDepth++
        else if (!isShadowRoot) {
          templateDepth = 1
          templateStart = lessThan
        }
      }
      at = openingTagEnd + 1
    }
  }
  if (templateDepth) ranges.push([templateStart, markup.length]) // a template never closed takes the rest of the file with it
  return ranges
}

// the end of the ignored range holding `position`, or -1 when it is not in one
function endOfIgnoredRange (ranges, position) {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const [start, end] = ranges[middle]
    if (position < start) high = middle - 1
    else if (position >= end) low = middle + 1
    else return end
  }
  return -1
}

// where the next tag beginning with `opening` (such as `<my-thing` or `</my-thing`) is, skipping the ignored ranges and any longer name that only begins the same way
function findTag (lowerMarkup, ranges, opening, from) {
  let at = from
  while (true) {
    const found = lowerMarkup.indexOf(opening, at)
    if (found === -1) return -1
    const ignoredUntil = endOfIgnoredRange(ranges, found)
    if (ignoredUntil !== -1) at = ignoredUntil
    else if (!endsTagName(lowerMarkup[found + opening.length])) at = found + opening.length
    else return found
  }
}

// the span of markup an element occupies, from the < that opens it to the > that closes it
//
// a regular expression cannot answer this. it has no way to pair an opening tag with the closing tag that belongs to it, so an element holding another of the same name ended at the inner closing tag and left the outer one behind as stray text
function elementSpan (markup, lowerMarkup, ranges, name, start) {
  const openingTagEnd = endOfOpeningTag(markup, start)
  if (openingTagEnd === -1) return null
  if (markup[openingTagEnd - 1] === '/') return { start, end: openingTagEnd + 1 } // closed itself, so there is no closing tag to pair it with
  let depth = 1
  let at = openingTagEnd + 1
  while (true) {
    const nextClosing = findTag(lowerMarkup, ranges, `</${name}`, at)
    if (nextClosing === -1) return null // never closed
    const nextOpening = findTag(lowerMarkup, ranges, `<${name}`, at)
    if (nextOpening !== -1 && nextOpening < nextClosing) {
      const nestedOpeningTagEnd = endOfOpeningTag(markup, nextOpening)
      if (nestedOpeningTagEnd === -1) return null
      if (markup[nestedOpeningTagEnd - 1] !== '/') depth++ // one that closed itself has no closing tag of its own to wait for
      at = nestedOpeningTagEnd + 1
      continue
    }
    const closingTagEnd = markup.indexOf('>', nextClosing)
    if (closingTagEnd === -1) return null
    if (--depth === 0) return { start, end: closingTagEnd + 1 }
    at = closingTagEnd + 1
  }
}

// where the next opening tag of any of these custom elements is, and which of them it opens
function nextInvocation (lowerMarkup, ranges, names, from) {
  let at = from
  while (true) {
    const lessThan = lowerMarkup.indexOf('<', at)
    if (lessThan === -1) return null
    const ignoredUntil = endOfIgnoredRange(ranges, lessThan)
    if (ignoredUntil !== -1) {
      at = ignoredUntil
      continue
    }
    const tag = /^<([a-z][^\s/>]*)/.exec(lowerMarkup.slice(lessThan, lessThan + 256))
    if (tag && names.has(tag[1])) return { start: lessThan, name: tag[1] }
    at = lessThan + 1
  }
}

// whether a template id names a custom element, which is what makes it a component definition rather than any other use of a <template>
//
// without this a page holding <template id="header"> for some other script had every <header> on the site treated as an invocation of it. the rule is the one customElements.define enforces: it starts with a lower case ascii letter, holds a hyphen and no ascii upper case letters, and is not one of the hyphenated names svg and mathml already use
const POTENTIAL_CUSTOM_ELEMENT_NAME = /^[a-z][-.0-9_a-z·À-ÖØ-öø-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\u{10000}-\u{EFFFF}]*$/u
const RESERVED_NAMES = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'])
const isCustomElementName = name => name.includes('-') && POTENTIAL_CUSTOM_ELEMENT_NAME.test(name) && !RESERVED_NAMES.has(name)

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

// puts the attribute values of an invocation where the ${templateLiterals} of its definition are
//
// this works on the dom rather than on serialized markup. replacing text in serialized markup wrote each value in exactly as it was, so a value holding a quote or an angle bracket broke the attribute or the element it landed in, and the value having been decoded from its entities on the way in meant &lt;b&gt; arrived as a real <b>. setting the text of a node lets the serializer escape it for wherever it ended up. it also means each literal is looked up once by name, rather than every attribute name being made into a regular expression, which a name such as a.b or :value is not safe to be, and rather than every value being a replacement pattern, in which $& and $1 mean something
const TEMPLATE_LITERAL = /\$\{([^}]+)\}/g
function fillTemplateLiterals (node, values) {
  const fill = text => text.replace(TEMPLATE_LITERAL, (literal, name) => values.get(name.toLowerCase()) ?? literal)
  for (const child of node.childNodes) {
    if (child.nodeType === 1) {
      for (const attribute of child.attributes) attribute.value = fill(attribute.value)
      if (child.tagName === 'TEMPLATE') fillTemplateLiterals(child.content, values)
      fillTemplateLiterals(child, values)
    } else if (child.nodeType === 3 || child.nodeType === 8) child.data = fill(child.data) // text and comments
  }
}

module.exports = (params) => {
  if (!params || typeof params.templatesDir !== 'string') throw new TypeError(`${MODULE_NAME}: the templatesDir param is required, and must be the path to the folder holding your templates`)

  const beautifyOptions = params.beautifyOptions || {
    indent_size: 2
  }
  const beautifyMarkup = markup => params.disableBeautify ? markup : beautify(markup, beautifyOptions)

  // the dom serializer writes an empty attribute out as data-enhanced="", which says the same thing as the bare form but is not what anyone writing it by hand would write
  //
  // only the opening tag of the element just enhanced is touched, so that an attribute written that way somewhere inside it, or text that happens to read the same, is left as it was
  const bareEnhancedAttribute = markup => {
    const start = markup.indexOf('<')
    const end = start === -1 ? -1 : endOfOpeningTag(markup, start)
    if (end === -1) return markup
    return markup.slice(0, start) + markup.slice(start, end + 1).replace(new RegExp(`(\\s)${ENHANCED_ATTRIBUTE}=""`), `$1${ENHANCED_ATTRIBUTE}`) + markup.slice(end + 1)
  }

  // what to do with an invocation whose definition does not say for itself
  const defaultMode = params.mode || 'both'
  if (!MODES.has(defaultMode)) throw new Error(`${MODULE_NAME}: mode must be one of ${[...MODES].join(', ')}, not ${JSON.stringify(defaultMode)}`)

  // jsdom complains about css it cannot parse, which is not something the caller can do anything about
  //
  // the complaints are dropped by giving jsdom a console of its own rather than by replacing console.error, which belongs to whatever application is calling this. anything else jsdom has to say is still passed on
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => {
    if (error.type !== 'css-parsing') console.error(error.message)
  })

  // every file that could hold a template or an invocation of one, read once
  //
  // reading them once is not only quicker: the enhanced markup of one custom element is what the next one is applied to, so a file invoking two of them ends up with both enhanced. re-reading the file for each custom element meant each started again from what was on disk, and only the last one survived into what this returns
  const files = {}
  for (const file of loopThroughFilesSync(params.templatesDir)) {
    const contents = readTextFile(file)
    if (contents !== null) files[file] = contents
  }

  // find all <template> elements whose ids name a custom element in any of the html templates
  //
  // a file without the word <template in it cannot define anything, so it is not handed to jsdom at all, which spares parsing every stylesheet, script and partial in the folder as a document
  const allTemplateElements = {}
  for (const [file, contents] of Object.entries(files)) {
    if (!asciiLowerCase(contents).includes('<template')) continue
    const { document } = new JSDOM(contents, { virtualConsole }).window
    for (const templateElement of document.querySelectorAll('template')) {
      const id = templateElement.id
      if (!isCustomElementName(id)) continue
      // a definition may say how it wants to be enhanced, which is a property of the component rather than of any one place it is used
      const mode = templateElement.getAttribute('mode') || defaultMode
      if (!MODES.has(mode)) throw new Error(`${MODULE_NAME}: <template id="${id}"> asks for mode ${JSON.stringify(mode)}, which is not one of ${[...MODES].join(', ')}`)
      const previous = allTemplateElements[id]
      if (previous) console.warn(`${MODULE_NAME}: <template id="${id}"> is defined more than once, in ${previous.file} and in ${file}. the one in ${file} is used`)
      allTemplateElements[id] = { definition: templateElement, mode, file }
    }
  }
  const customElementNames = new Set(Object.keys(allTemplateElements))

  // one document to parse every invocation in, rather than a new one for each
  //
  // it is only used to parse: an element is taken out of it straight away and serialized from where it is, so that enhancing the invocations nested inside one, which parses each of them here in turn, does not disturb it
  const workspace = new JSDOM('<!DOCTYPE html><html><body></body></html>', { virtualConsole }).window.document

  // every invocation of a known custom element in a stretch of markup, enhanced, with everything around them left as it was
  //
  // `expanding` is the chain of components whose markup this is part of. a component that invokes itself, directly or through another, would expand forever, so an invocation of one already in the chain is left for its javascript to render, marked so that a later pass over the output leaves it alone too
  const warnedAboutRecursion = new Set()
  function enhanceMarkup (markup, expanding) {
    const lowerMarkup = asciiLowerCase(markup)
    const ranges = ignoredRanges(markup, lowerMarkup)
    let output = ''
    let at = 0
    while (true) {
      const found = nextInvocation(lowerMarkup, ranges, customElementNames, at)
      if (!found) break
      const span = elementSpan(markup, lowerMarkup, ranges, found.name, found.start)
      if (!span) { // never closed, which leaves that one alone but not every invocation after it
        output += markup.slice(at, found.start + 1)
        at = found.start + 1
        continue
      }
      output += markup.slice(at, span.start) + enhance(markup.slice(span.start, span.end), found.name, expanding)
      at = span.end // whatever is nested inside this element is dealt with by enhancing it
    }
    return output + markup.slice(at)
  }

  // what one invocation of a custom element becomes
  function enhance (invocation, customElement, expanding) {
    if (expanding.includes(customElement)) {
      if (!warnedAboutRecursion.has(customElement)) {
        warnedAboutRecursion.add(customElement)
        console.warn(`${MODULE_NAME}: <${customElement}> invokes itself (${[...expanding.slice(expanding.indexOf(customElement)), customElement].join(' > ')}). the inner one is left for its javascript to render`)
      }
      const nameEnd = customElement.length + 1
      return invocation.slice(0, nameEnd) + ` ${ENHANCED_ATTRIBUTE}` + invocation.slice(nameEnd)
    }

    workspace.body.innerHTML = invocation
    const element = workspace.body.firstElementChild
    if (!element) return invocation
    element.remove()

    // an invocation that has been enhanced already is kept exactly as it came in, rather than reformatted, so that nothing about it changes. it can still hold invocations that have not been, in its light dom or in a shadow root written into it, and only those are enhanced
    if (alreadyEnhanced(element)) {
      const openingTagEnd = endOfOpeningTag(invocation, 0)
      if (invocation[openingTagEnd - 1] === '/') return invocation
      const closingTagStart = invocation.lastIndexOf('</')
      return invocation.slice(0, openingTagEnd + 1) + enhanceMarkup(invocation.slice(openingTagEnd + 1, closingTagStart), expanding) + invocation.slice(closingTagStart)
    }

    const { definition, mode } = allTemplateElements[customElement]

    // js-beautify treats <template> as an inline element and so will not break the line before one. the pieces of a component are put on lines of their own here instead, which it then indents. with beautifying turned off they are joined as they were, this module having been asked to leave the markup alone
    const gap = params.disableBeautify ? '' : '\n'

    const values = new Map()
    for (const attribute of element.attributes) values.set(attribute.name.toLowerCase(), attribute.value)

    // the component's markup, with the attribute values written on this invocation put where its template literals were, and any component it invokes enhanced in turn
    //
    // a shadow root renders the style, script and slot elements it is given, so it keeps them. light dom fallback markup can use none of them: a style element would leak to the rest of the page, a slot projects nothing when there is no shadow root to project it into, and a script would run a second time once the component upgrades. so they are removed from a fallback
    //
    // what comes back is markup rather than a dom. the enhanced invocations nested in it are serialized already, and parsing them again only to serialize them a second time would undo details such as the bare data-enhanced attribute
    function componentMarkup (forShadowRoot) {
      // clone the <template> markup so we can construct a more verbose, progressive enhancement-compatible version of the web component
      const template = definition.content.cloneNode(true)

      // remove elements that are not needed in the progressive enhancement context from the <template> markup
      if (!forShadowRoot) template.querySelectorAll('style, script, slot').forEach(el => el.remove())

      const container = workspace.createElement('div')
      container.appendChild(template)
      fillTemplateLiterals(container, values)

      // `both` carries the fallback beside the shadow root, held out of the component's slots so that it shows only where the shadow root was not built
      if (!forShadowRoot && mode === 'both') holdOutOfSlots(container)

      const markup = enhanceMarkup(container.innerHTML, [...expanding, customElement])
      if (params.disableBeautify) return markup
      const componentBeautifyOptions = { ...beautifyOptions }
      componentBeautifyOptions.preserve_newlines = false // remove newlines from components in case any style, script, or slot elements have been removed
      return beautify(markup, componentBeautifyOptions)
    }

    // the element with what it now holds, written out around that markup rather than by setting it as the element's contents and serializing the lot, for the same reason
    element.setAttribute(ENHANCED_ATTRIBUTE, '')
    const shell = element.cloneNode(false).outerHTML
    const closingTag = `</${element.localName}>`
    const openingTag = shell.slice(0, shell.length - closingTag.length)
    const wrap = contents => bareEnhancedAttribute(beautifyMarkup(openingTag + contents + closingTag))

    if (mode === 'light') {
      let fallback = componentMarkup(false)

      // move any component child elements with slot attributes to the root of the component's light dom because such elements always need to be at the root to be accepted by the web component JS
      //
      // one that belongs to something else is left where it is: a child of an element already being moved goes along with it rather than being moved a second time beside it, and one inside another custom element is that element's slotted content, not this one's
      const belongsToThisElement = slotted => {
        for (let ancestor = slotted.parentElement; ancestor !== element; ancestor = ancestor.parentElement) {
          if (ancestor.hasAttribute('slot') || ancestor.localName.includes('-')) return false
        }
        return true
      }
      for (const slotted of element.querySelectorAll('[slot]')) {
        if (belongsToThisElement(slotted)) fallback += enhanceMarkup(slotted.outerHTML, expanding)
      }

      // replace the original custom element with the new progressive enhancement-friendly version of the element
      return wrap(beautifyMarkup(fallback))
    }

    // the other modes build a shadow root, and what the element already holds is the light dom the slots in that shadow root project, so it is kept as it was written rather than replaced
    //
    // nothing is hoisted out of it either: only a direct child of the element can be assigned to a slot, so moving one that is nested deeper would change which content the author had put where in order to make a slot claim it. any component invoked in it is enhanced, that being written by the author rather than by this component, so it is not part of the chain being expanded
    const light = enhanceMarkup(element.innerHTML, expanding)
    const pieces = [`<template shadowrootmode="open">${componentMarkup(true)}</template>`]
    if (mode === 'both') pieces.push(componentMarkup(false))
    if (light.trim()) pieces.push(light)
    return wrap(gap + beautifyMarkup(pieces.join(gap)))
  }

  // enhance every invocation in every file, each file being gone over once for all of the custom elements together
  //
  // a component whose markup invokes another component has that one enhanced as part of it, whichever of the two was defined first. going over a file once for each custom element in turn, as this once did, only reached the inner one when its turn happened to come after the outer one's
  const editedFiles = {}
  if (customElementNames.size) {
    for (const file in files) {
      const markup = enhanceMarkup(files[file], [])
      if (markup !== files[file]) editedFiles[file] = markup
    }
  }

  return editedFiles
}
