// tests the preprocessor by calling it, rather than by starting a web server and reading what it left behind. the old test did the latter: it ran `npm start` in the express sample app, waited for the server to say it was listening, and then read one of the files the preprocessor had written. that meant the test could only pass where the sample app's own dependencies were installed, which is why it never passed in ci, and killing `npm start` left the `node server.js` it had spawned running with the test's pipes still open, so the run never ended even when the assertion passed
//
// the sample app is still exercised, at the bottom, by running the preprocessor over its views
/* eslint-disable no-template-curly-in-string */ // ${templateLiteral} in a string is the syntax under test
const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const pewc = require('../progressively-enhance-web-components')

// a templates directory holding the files a test describes, thrown away afterwards
const scratchDirs = []
function templatesDir (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pewc-'))
  scratchDirs.push(dir)
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  return dir
}

// what the preprocessor made of those files, keyed by the name they were given rather than by full path
function preprocess (files, params = {}) {
  const dir = templatesDir(files)
  const edited = pewc({ templatesDir: dir, ...params })
  const byName = {}
  for (const file in edited) byName[path.relative(dir, file)] = edited[file]
  return byName
}

// whitespace is what beautifying changes, so most of these tests are not asking about it
const squash = markup => markup.replace(/\s+/g, ' ').replace(/> </g, '><').trim()

const definition = '<template id="my-thing"><div class="wrap"><p>${label}</p></div></template>'

after(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('finding what to enhance', () => {
  it('should replace an invocation with the markup of the template that defines it', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'light' })
    assert.strictEqual(squash(out['page.html']), '<my-thing label="hi" data-enhanced><div class="wrap"><p>hi</p></div></my-thing>')
  })

  it('should find a definition in one file and an invocation in another', () => {
    const out = preprocess({ 'components/def.html': definition, 'pages/page.html': '<my-thing label="hi"></my-thing>' })
    assert.ok(out[path.join('pages', 'page.html')].includes('<p>hi</p>'))
  })

  it('should leave the file holding the definition alone', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' })
    assert.deepStrictEqual(Object.keys(out), ['page.html'])
  })

  it('should return nothing when no template defines a custom element', () => {
    const out = preprocess({ 'page.html': '<my-thing label="hi"></my-thing>' })
    assert.deepStrictEqual(out, {})
  })

  it('should return nothing when a definition is never invoked', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<p>nothing to do here</p>' })
    assert.deepStrictEqual(out, {})
  })

  it('should ignore a template element with no id, there being no element name for it to define', () => {
    const out = preprocess({ 'def.html': '<template><p>${label}</p></template>', 'page.html': '<my-thing label="hi"></my-thing>' })
    assert.deepStrictEqual(out, {})
  })

  it('should enhance more than one kind of custom element', () => {
    const out = preprocess({
      'def.html': '<template id="thing-one"><p>one ${label}</p></template><template id="thing-two"><p>two ${label}</p></template>',
      'page.html': '<thing-one label="a"></thing-one><thing-two label="b"></thing-two>'
    }, { mode: 'light' })
    assert.strictEqual(squash(out['page.html']), '<thing-one label="a" data-enhanced><p>one a</p></thing-one><thing-two label="b" data-enhanced><p>two b</p></thing-two>')
  })

  it('should enhance every invocation in a file', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"></my-thing><my-thing label="b"></my-thing>' }, { mode: 'light' })
    assert.strictEqual(squash(out['page.html']), '<my-thing label="a" data-enhanced><div class="wrap"><p>a</p></div></my-thing><my-thing label="b" data-enhanced><div class="wrap"><p>b</p></div></my-thing>')
  })

  it('should look through nested directories for both definitions and invocations', () => {
    const out = preprocess({ 'a/b/def.html': definition, 'c/d/e/page.html': '<my-thing label="deep"></my-thing>' })
    assert.ok(out[path.join('c', 'd', 'e', 'page.html')].includes('<p>deep</p>'))
  })

  it('should leave markup around an invocation as it was', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<header>before</header><my-thing label="hi"></my-thing><footer>after</footer>' })
    assert.ok(out['page.html'].includes('<header>before</header>'))
    assert.ok(out['page.html'].includes('<footer>after</footer>'))
  })
})

// the fallback markup is what light mode is made of, and what both mode carries beside its shadow root, so these ask for light by name rather than taking the default
describe('building the fallback markup', () => {
  it('should put attribute values where the template literals were', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><p>${first} and ${second}</p></template>',
      'page.html': '<my-thing first="a" second="b"></my-thing>'
    })
    assert.ok(squash(out['page.html']).includes('<p>a and b</p>'))
  })

  it('should match a template literal whatever case it is written in', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><p>${MyLabel}</p></template>',
      'page.html': '<my-thing mylabel="hi"></my-thing>'
    })
    assert.ok(squash(out['page.html']).includes('<p>hi</p>'))
  })

  it('should leave a template literal alone when the invocation has no attribute for it', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing></my-thing>' })
    assert.ok(out['page.html'].includes('${label}'))
  })

  it('should keep an attribute value holding a greater than sign', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a > b"></my-thing>' })
    assert.ok(squash(out['page.html']).includes('<p>a &gt; b</p>'))
  })

  it('should leave out the style, script and slot elements a shadow root would have needed', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><div><style>p{color:red}</style><script>console.log(1)</script><slot name="extra"></slot><p>${label}</p></div></template>',
      'page.html': '<my-thing label="hi"></my-thing>'
    }, { mode: 'light' })
    const result = out['page.html']
    assert.ok(!result.includes('<style'), 'a style element was left in the fallback')
    assert.ok(!result.includes('<script'), 'a script element was left in the fallback')
    assert.ok(!result.includes('<slot'), 'a slot element was left in the fallback')
    assert.ok(result.includes('<p>hi</p>'))
  })

  it('should move a slotted child to the root of the component, where a web component expects it', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><div class="wrap"><p>${label}</p></div></template>',
      'page.html': '<my-thing label="hi"><p slot="extra">slotted</p></my-thing>'
    }, { mode: 'light' })
    // the slotted child sits beside the fallback markup rather than inside it
    assert.strictEqual(squash(out['page.html']), '<my-thing label="hi" data-enhanced><div class="wrap"><p>hi</p></div><p slot="extra">slotted</p></my-thing>')
  })

  it('should drop a child that is not slotted, the fallback markup standing in its place', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"><p>not slotted</p></my-thing>' }, { mode: 'light' })
    assert.ok(!out['page.html'].includes('not slotted'))
  })

  it('should keep an invocation well formed when one is nested inside another of the same kind', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="outer"><my-thing label="inner"></my-thing></my-thing>' }, { mode: 'light' })
    const closings = out['page.html'].match(/<\/my-thing>/g) || []
    assert.strictEqual(closings.length, 1, `expected one closing tag, got ${closings.length}: ${out['page.html']}`)
  })
})

describe('choosing how to enhance', () => {
  const styled = '<template id="my-thing"><style>p{color:red}</style><div class="wrap"><p>${label}</p><slot name="extra"></slot></div></template>'

  it('should write both a shadow root and fallback markup by default', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' })
    assert.strictEqual(squash(out['page.html']), '<my-thing label="hi" data-enhanced><template shadowrootmode="open"><div class="wrap"><p>hi</p></div></template><div class="wrap" slot="pewc-fallback"><p>hi</p></div></my-thing>')
  })

  it('should write a declarative shadow root instead of fallback markup in shadow mode', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'shadow' })
    assert.strictEqual(squash(out['page.html']), '<my-thing label="hi" data-enhanced><template shadowrootmode="open"><div class="wrap"><p>hi</p></div></template></my-thing>')
  })

  it('should keep the style, script and slot elements a shadow root can use', () => {
    const out = preprocess({ 'def.html': styled, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'shadow' })
    const result = out['page.html']
    assert.ok(result.includes('<style'), 'the style element was stripped from the shadow root')
    assert.ok(result.includes('<slot'), 'the slot element was stripped from the shadow root')
    assert.ok(result.includes('<p>hi</p>'), 'the template literal was not filled in')
  })

  it('should leave the children of the invocation alone in shadow mode, the slots of the shadow root being what projects them', () => {
    const out = preprocess({ 'def.html': styled, 'page.html': '<my-thing label="hi"><p slot="extra">slotted</p><p>not slotted</p></my-thing>' }, { mode: 'shadow' })
    const result = squash(out['page.html'])
    assert.ok(result.endsWith('</template><p slot="extra">slotted</p><p>not slotted</p></my-thing>'), result)
  })

  it('should write both a shadow root and fallback markup in both mode', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'both' })
    const result = squash(out['page.html'])
    assert.ok(result.includes('<template shadowrootmode="open"><div class="wrap"><p>hi</p></div></template>'), result)
    assert.ok(result.includes(`<div class="wrap" slot="${'pewc-fallback'}"><p>hi</p></div>`), result)
  })

  it('should hold every top level node of the fallback out of the slots of the component', () => {
    // a component with a default slot would otherwise project the fallback back into itself, beside the real content
    const out = preprocess({
      'def.html': '<template id="my-thing"><div class="wrap"><slot></slot></div><p>tail</p></template>',
      'page.html': '<my-thing></my-thing>'
    }, { mode: 'both' })
    const fallback = squash(out['page.html']).split('</template>')[1].replace('</my-thing>', '')
    assert.strictEqual(fallback, '<div class="wrap" slot="pewc-fallback"></div><p slot="pewc-fallback">tail</p>')
  })

  it('should give text at the root of the fallback something that can carry the slot attribute', () => {
    const out = preprocess({ 'def.html': '<template id="my-thing">bare text</template>', 'page.html': '<my-thing></my-thing>' }, { mode: 'both' })
    const fallback = squash(out['page.html']).split('</template>')[1]
    assert.ok(fallback.includes('<span slot="pewc-fallback">bare text</span>'), fallback)
  })

  it('should still strip the style, script and slot elements from the fallback half of both mode', () => {
    const out = preprocess({ 'def.html': styled, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'both' })
    const fallback = out['page.html'].split('</template>')[1]
    assert.ok(!fallback.includes('<style'), 'a style element was left in the fallback')
    assert.ok(!fallback.includes('<slot'), 'a slot element was left in the fallback')
  })

  it('should let a definition ask for a mode of its own', () => {
    const out = preprocess({
      'def.html': '<template id="thing-one" mode="shadow"><p>one</p></template><template id="thing-two" mode="light"><p>two</p></template>',
      'page.html': '<thing-one></thing-one><thing-two></thing-two>'
    })
    const result = squash(out['page.html'])
    assert.ok(result.includes('<thing-one data-enhanced><template shadowrootmode="open"><p>one</p></template></thing-one>'), result)
    assert.ok(result.includes('<thing-two data-enhanced><p>two</p></thing-two>'), result)
  })

  it('should let a definition opt out of a mode asked for everywhere else', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing" mode="light"><p>${label}</p></template>',
      'page.html': '<my-thing label="hi"></my-thing>'
    }, { mode: 'shadow' })
    assert.strictEqual(squash(out['page.html']), '<my-thing label="hi" data-enhanced><p>hi</p></my-thing>')
  })

  it('should refuse a mode it does not have', () => {
    assert.throws(() => preprocess({ 'def.html': definition, 'page.html': '<my-thing></my-thing>' }, { mode: 'shadowroot' }), /mode must be one of light, shadow, both/)
  })

  it('should refuse a mode a definition asks for that it does not have', () => {
    assert.throws(() => preprocess({
      'def.html': '<template id="my-thing" mode="open"><p>hi</p></template>',
      'page.html': '<my-thing></my-thing>'
    }), /asks for mode "open"/)
  })
})

describe('leaving what is enhanced already alone', () => {
  const styled = '<template id="my-thing"><style>p{color:red}</style><div class="wrap"><p>${label}</p></div></template>'

  // preprocessing a directory that already holds preprocessed templates is the ordinary way to reach this, and without a mark every pass would stack another shadow root and another fallback onto the same element
  for (const mode of ['light', 'shadow', 'both']) {
    it(`should leave an invocation it enhanced already untouched in ${mode} mode`, () => {
      const first = preprocess({ 'def.html': styled, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode })['page.html']
      const again = preprocess({ 'def.html': styled, 'page.html': first }, { mode })
      assert.deepStrictEqual(again, {}, `a second pass changed the markup:\n${again['page.html']}`)
    })
  }

  it('should mark every element it enhances', () => {
    for (const mode of ['light', 'shadow', 'both']) {
      const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode })
      assert.ok(/<my-thing label="hi" data-enhanced>/.test(out['page.html']), `${mode} mode did not mark the element: ${out['page.html']}`)
    }
  })

  it('should leave an invocation a developer marked for themselves exactly as it was written', () => {
    const page = '<my-thing label="hi" data-enhanced><div class="mine">hand written</div></my-thing>'
    assert.deepStrictEqual(preprocess({ 'def.html': definition, 'page.html': page }), {})
  })

  // a browser refuses a second declarative shadow root on a host and says so in the console, so one written by hand is what the element keeps
  it('should leave an invocation carrying a declarative shadow root alone, marked or not', () => {
    const page = '<my-thing label="hi"><template shadowrootmode="open"><p>hand written</p></template></my-thing>'
    assert.deepStrictEqual(preprocess({ 'def.html': definition, 'page.html': page }), {})
  })

  it('should still enhance an invocation holding a plain template that is not a shadow root', () => {
    const page = '<my-thing label="hi"><template id="something-else"><p>not a shadow root</p></template></my-thing>'
    const out = preprocess({ 'def.html': definition, 'page.html': page }, { mode: 'shadow' })
    assert.ok(out['page.html'], 'the invocation was skipped when it should have been enhanced')
    assert.ok(squash(out['page.html']).includes('<template shadowrootmode="open">'), out['page.html'])
  })
})

describe('how the markup is laid out', () => {
  it('should put the shadow root, the fallback and the light dom on lines of their own', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><div class="wrap"><p>${label}</p></div></template>',
      'page.html': '<my-thing label="hi"><p slot="d">slotted</p></my-thing>'
    }, { mode: 'both' })
    const lines = out['page.html'].split('\n').map(line => line.trim()).filter(Boolean)
    assert.strictEqual(lines[0], '<my-thing label="hi" data-enhanced>', out['page.html'])
    assert.strictEqual(lines[1], '<template shadowrootmode="open">', out['page.html'])
    assert.ok(lines.includes('<div class="wrap" slot="pewc-fallback">'), out['page.html'])
    assert.ok(lines.includes('<p slot="d">slotted</p>'), out['page.html'])
  })

  it('should leave the pieces joined as they were when asked not to beautify', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'both', disableBeautify: true })
    assert.ok(!out['page.html'].includes('\n'), `a newline was added anyway: ${JSON.stringify(out['page.html'])}`)
  })
})

describe('markup it cannot make sense of', () => {
  it('should leave an element whose name only begins the same way alone', () => {
    const out = preprocess({
      'def.html': definition,
      'page.html': '<my-thing-else label="a"></my-thing-else><my-thing label="b"></my-thing>'
    }, { mode: 'light' })
    assert.ok(out['page.html'].includes('<my-thing-else label="a"></my-thing-else>'), out['page.html'])
    assert.ok(squash(out['page.html']).includes('<my-thing label="b" data-enhanced><div class="wrap"><p>b</p></div></my-thing>'))
  })

  it('should leave an invocation that is never closed alone', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<p>before</p><my-thing label="hi">' })
    assert.deepStrictEqual(out, {})
  })

  it('should leave an opening tag that is never finished alone', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<p>before</p><my-thing label="hi"' })
    assert.deepStrictEqual(out, {})
  })

  it('should enhance an invocation that closes itself, there being no closing tag to look for', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi" />' })
    assert.ok(squash(out['page.html'] || '').includes('<p>hi</p>'), JSON.stringify(out['page.html']))
  })
})

describe('beautifying', () => {
  it('should indent by two spaces by default', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'light' })
    assert.ok(out['page.html'].includes('\n  <div class="wrap">'), out['page.html'])
  })

  it('should indent by whatever beautifyOptions asks for', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { mode: 'light', beautifyOptions: { indent_size: 4 } })
    assert.ok(out['page.html'].includes('\n    <div class="wrap">'), out['page.html'])
  })

  it('should leave the markup unbeautified when asked not to beautify it', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' }, { disableBeautify: true })
    assert.ok(!/\n\s+</.test(out['page.html']), `expected no added indentation, got: ${JSON.stringify(out['page.html'])}`)
  })
})

describe('files it should not read as templates', () => {
  it('should skip a binary file', () => {
    const dir = templatesDir({ 'def.html': definition, 'page.html': '<my-thing label="hi"></my-thing>' })
    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]))
    const edited = pewc({ templatesDir: dir })
    assert.deepStrictEqual(Object.keys(edited).map(f => path.basename(f)), ['page.html'])
  })

  it('should skip a hidden file', () => {
    const out = preprocess({ 'def.html': definition, '.hidden.html': '<my-thing label="hi"></my-thing>' })
    assert.deepStrictEqual(out, {})
  })

  it('should return nothing rather than throwing when the templates directory is not there', () => {
    assert.deepStrictEqual(pewc({ templatesDir: path.join(os.tmpdir(), 'pewc-does-not-exist-' + Date.now()) }), {})
  })
})

describe('leaving the host application alone', () => {
  // jsdom complains about css it cannot parse, and the preprocessor silences that. it should not silence it for good, or for anybody else: an application logging an error of its own after calling the preprocessor should still see it
  //
  // the module is loaded again from inside the test rather than used from the top of this file, because whatever it does to console.error it does when it is loaded: a collector installed afterwards would sit underneath it and the test could not fail
  it('should not keep console.error to itself once it is done', () => {
    const seen = []
    const original = console.error
    const modulePath = require.resolve('../progressively-enhance-web-components')
    try {
      console.error = (...args) => seen.push(args.join(' '))
      delete require.cache[modulePath]
      const fresh = require(modulePath)
      const dir = templatesDir({
        'def.html': '<template id="my-thing"><style>p{color:@@@}</style><p>${label}</p></template>',
        'page.html': '<my-thing label="hi"></my-thing>'
      })
      fresh({ templatesDir: dir })
      console.error('Error: Could not parse CSS stylesheet')
    } finally {
      console.error = original
      delete require.cache[modulePath]
    }
    assert.ok(seen.includes('Error: Could not parse CSS stylesheet'), 'the host application no longer sees its own errors')
  })

  it('should still let an error through that is nothing to do with jsdom css', () => {
    const seen = []
    const original = console.error
    try {
      console.error = (...args) => seen.push(args.join(' '))
      // the definition holds css jsdom cannot parse, so the silencing is in place while this runs
      const dir = templatesDir({
        'def.html': '<template id="my-thing"><style>p{color:@@@}</style><p>${label}</p></template>',
        'page.html': '<my-thing label="hi"></my-thing>'
      })
      const noisy = { toString: () => { console.error('something else went wrong'); return 'hi' } }
      pewc({ templatesDir: dir, beautifyOptions: { indent_size: noisy } })
    } catch (err) {
      // whether beautify minds being handed that is beside the point
    } finally {
      console.error = original
    }
    assert.ok(seen.includes('something else went wrong'), 'an unrelated error was silenced too')
  })
})

// the examples in USAGE.md are what anyone reads before using this, and nothing about writing them by hand stops them drifting from what the preprocessor actually writes
describe('the examples in the documentation', () => {
  // line endings are whatever the checkout made them, and windows makes them \r\n, so the document is read as lines rather than as bytes
  const usage = fs.readFileSync(path.join(__dirname, '..', 'USAGE.md'), 'utf8').replace(/\r\n/g, '\n')

  // the <template> the walkthrough defines, and the invocation it shows being enhanced, both read out of the document itself
  const definition = usage.slice(usage.indexOf('<template id="word-count">'), usage.indexOf('</template>\n```') + '</template>'.length)
  const invocation = '<word-count text="Once upon a time... " id="story">\n  <p slot="description">Type your story in the box above!</p>\n</word-count>'

  // the last markup block under a mode's heading is the output that mode produces; the ones before it are the input
  function documented (mode) {
    const from = usage.indexOf(`#### \`${mode}\``)
    assert.notStrictEqual(from, -1, `USAGE.md has no section for ${mode} mode`)
    let to = usage.indexOf('\n#### ', from + 5)
    if (to === -1) to = usage.indexOf('\n### ', from + 5)
    const blocks = [...usage.slice(from, to).matchAll(/```html\n(<word-count[\s\S]*?)\n```/g)]
    assert.ok(blocks.length, `USAGE.md shows no output for ${mode} mode`)
    return blocks[blocks.length - 1][1]
  }

  for (const mode of ['both', 'shadow', 'light']) {
    it(`should show what ${mode} mode really writes`, () => {
      const out = preprocess({ 'def.html': definition, 'page.html': invocation }, { mode })
      assert.strictEqual(documented(mode), out['page.html'].replace(/\r\n/g, '\n').trim(), `the ${mode} example in USAGE.md is not what the preprocessor writes`)
    })
  }

  it('should define the component in the walkthrough the way the modes section uses it', () => {
    assert.ok(definition.includes('${id}') && definition.includes('${text}'), 'the walkthrough definition no longer carries the template literals its prose describes')
  })
})

describe('the express sample app', () => {
  // what the old test asserted, without starting a server to find it out
  const samplePage = () => {
    const views = path.join(__dirname, '..', 'sampleApps', 'express', 'mvc', 'views')
    const edited = pewc({ templatesDir: views })
    const page = edited[path.join(views, 'pageWithForm.html')]
    assert.ok(page, 'the sample app page holding the invocation was not edited')
    return page
  }

  it('should build a shadow root for the <word-count> invocation in the sample app', () => {
    const page = squash(samplePage())
    assert.ok(page.includes('<word-count text="Once upon a time... " elid="story" data-enhanced><template shadowrootmode="open">'), page)
    assert.ok(page.includes('<textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea><slot name="description"></slot>'), page)
    assert.ok(page.includes('<style>'), 'the shadow root was built without the styles of the component')
  })

  it('should carry fallback markup for it as well, held out of the slots of the component', () => {
    const page = squash(samplePage())
    assert.ok(page.includes('</template><div slot="pewc-fallback"><textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>'), page)
  })

  it('should leave the slotted child of the invocation where it was written', () => {
    const page = squash(samplePage())
    assert.ok(page.includes('<p slot="description">Type your story in the box above!</p></word-count>'), page)
  })
})
