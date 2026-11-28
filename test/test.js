// tests the preprocessor by calling it, rather than by starting a web server and reading what it left behind. the old test did the latter: it ran `npm start` in the express sample app, waited for the server to say it was listening, and then read one of the files the preprocessor had written. that meant the test could only pass where the sample app's own dependencies were installed, which is why it never passed in ci, and killing `npm start` left the `node server.js` it had spawned running with the test's pipes still open, so the run never ended even when the assertion passed
//
// the sample app is still exercised, at the bottom, by running the preprocessor over its views
/* eslint-disable no-template-curly-in-string */ // ${templateLiteral} in a string is the syntax under test
const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { JSDOM } = require('jsdom')
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
  it('should not print jsdom complaints about css it cannot parse', t => {
    const error = t.mock.method(console, 'error', () => {})
    preprocess({
      'layout.html': '<style>p{color:@@@}</style><template id="my-thing"><style>p{color:@@@}</style><p>${label}</p></template>',
      'page.html': '<style>q{color:@@@}</style><my-thing label="hi"></my-thing>'
    })
    assert.strictEqual(error.mock.callCount(), 0, JSON.stringify(error.mock.calls.map(c => c.arguments)))
  })

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

// the cases below each broke something before they were tested for, and are kept so that none of them comes back
describe('reading files', () => {
  it('should read a template holding characters outside ascii, rather than taking it for a binary file', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<p>Café “quoted” 🎧</p><my-thing label="hi"></my-thing>' })
    assert.ok(out['page.html'], 'a file holding non-ascii text was skipped')
    assert.ok(out['page.html'].includes('Café “quoted” 🎧'), 'the non-ascii text did not survive')
  })

  it('should skip a file that is not valid utf-8', () => {
    const dir = templatesDir({ 'def.html': definition })
    fs.writeFileSync(path.join(dir, 'latin1.html'), Buffer.concat([Buffer.from('<p>caf'), Buffer.from([0xe9]), Buffer.from('</p><my-thing label="hi"></my-thing>')]))
    assert.deepStrictEqual(pewc({ templatesDir: dir }), {})
  })

  it('should keep a byte order mark at the start of a file', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '﻿<my-thing label="hi"></my-thing>' })
    assert.ok(out['page.html'].startsWith('﻿'))
  })

  it('should skip a hidden directory', () => {
    const out = preprocess({ 'def.html': definition, '.cache/page.html': '<my-thing label="hi"></my-thing>' })
    assert.deepStrictEqual(out, {})
  })

  it('should follow a symbolic link, and not loop forever on one pointing back up the tree', t => {
    const dir = templatesDir({ 'def.html': definition })
    const elsewhere = templatesDir({ 'page.html': '<my-thing label="hi"></my-thing>' })
    try {
      fs.symlinkSync(elsewhere, path.join(dir, 'linked'), 'dir')
      fs.symlinkSync(dir, path.join(dir, 'loop'), 'dir')
    } catch {
      return t.skip('symbolic links cannot be made here') // windows without the privilege to make them
    }
    const edited = pewc({ templatesDir: dir })
    assert.deepStrictEqual(Object.keys(edited).map(f => path.relative(dir, f)), [path.join('linked', 'page.html')])
  })

  it('should throw a clear error when no templates directory is given', () => {
    assert.throws(() => pewc(), /templatesDir param is required/)
    assert.throws(() => pewc({}), /templatesDir param is required/)
  })
})

describe('what counts as a component definition', () => {
  it('should ignore a template whose id is not a custom element name', () => {
    const out = preprocess({ 'def.html': '<template id="header"><nav>menu</nav></template>', 'page.html': '<header><h1>Site</h1></header>' })
    assert.deepStrictEqual(out, {})
  })

  it('should ignore a template whose id holds upper case letters, which customElements.define would refuse', () => {
    const out = preprocess({ 'def.html': '<template id="My-Thing"><p>x</p></template>', 'page.html': '<my-thing></my-thing>' })
    assert.deepStrictEqual(out, {})
  })

  it('should ignore a template whose id is one of the hyphenated names svg and mathml already use', () => {
    const out = preprocess({ 'def.html': '<template id="font-face"><p>x</p></template>', 'page.html': '<font-face></font-face>' })
    assert.deepStrictEqual(out, {})
  })

  it('should warn when an id is defined twice, and use the one in the file that comes last', t => {
    const warn = t.mock.method(console, 'warn', () => {})
    const out = preprocess({
      'a.html': '<template id="my-thing"><p>from a</p></template>',
      'b.html': '<template id="my-thing"><p>from b</p></template>',
      'page.html': '<my-thing></my-thing>'
    })
    assert.ok(out['page.html'].includes('from b'))
    assert.strictEqual(warn.mock.callCount(), 1)
    assert.match(warn.mock.calls[0].arguments[0], /my-thing.*more than once/)
  })
})

describe('putting attribute values into the markup', () => {
  it('should escape a value holding quotes and angle brackets, in text and in attributes alike', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><p title="${label}">${label}</p></template>',
      'page.html': '<my-thing label="say &quot;hi&quot; &lt;b&gt;bold&lt;/b&gt;"></my-thing>'
    }, { mode: 'light', disableBeautify: true })
    // read back by parsing rather than by comparing text, since whether a serializer escapes < and > inside an attribute value differs between versions of the html spec, and either way is correct
    const { document } = new JSDOM(out['page.html']).window
    const p = document.querySelector('my-thing p')
    assert.ok(p, out['page.html'])
    assert.strictEqual(p.getAttribute('title'), 'say "hi" <b>bold</b>', 'the attribute value was not written as text')
    assert.strictEqual(p.textContent, 'say "hi" <b>bold</b>', 'the text was not written as text')
    assert.strictEqual(document.querySelector('my-thing b'), null, 'the value was parsed as markup')
  })

  it('should not expand a value holding a replacement pattern such as $&', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="cost $&amp; $1 more"></my-thing>' }, { mode: 'light', disableBeautify: true })
    assert.ok(out['page.html'].includes('<p>cost $&amp; $1 more</p>'), out['page.html'])
  })

  it('should match an attribute whose name holds a character that means something in a regular expression only to its own literal', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><p>${a.b}|${axb}</p></template>',
      'page.html': '<my-thing a.b="dot" axb="cross"></my-thing>'
    }, { mode: 'light', disableBeautify: true })
    assert.ok(out['page.html'].includes('<p>dot|cross</p>'), out['page.html'])
  })

  it('should not fill in a literal written inside another attribute value', () => {
    const out = preprocess({
      'def.html': '<template id="my-thing"><p>${first}</p></template>',
      'page.html': '<my-thing first="${second}" second="oops"></my-thing>'
    }, { mode: 'light', disableBeautify: true })
    assert.ok(out['page.html'].includes('<p>${second}</p>'), out['page.html'])
  })
})

describe('where an invocation is not one', () => {
  const page = inner => preprocess({ 'def.html': definition, 'page.html': inner })['page.html']

  it('should leave an invocation inside a comment alone', () => {
    assert.strictEqual(page('<!-- <my-thing label="a"></my-thing> -->'), undefined)
  })

  for (const element of ['script', 'style', 'textarea', 'title']) {
    it(`should leave an invocation inside a <${element}> alone`, () => {
      assert.strictEqual(page(`<${element}>x = "<my-thing label=1></my-thing>"</${element}>`), undefined)
    })
  }

  it('should leave an invocation inside a plain template alone, such as one in the definition of another component', () => {
    const out = preprocess({ 'def.html': definition, 'other.html': '<template id="other-thing"><my-thing label="a"></my-thing></template>' })
    assert.deepStrictEqual(out, {})
  })

  it('should enhance an invocation inside a declarative shadow root, the browser rendering what is in one', () => {
    const out = page('<div><template shadowrootmode="open"><my-thing label="a"></my-thing></template></div>')
    assert.ok(out && squash(out).includes('<my-thing label="a" data-enhanced>'), out)
  })

  it('should still enhance an invocation after a comment or script that holds one', () => {
    const out = page('<!-- <my-thing> --><script>"<my-thing>"</script><my-thing label="b"></my-thing>')
    assert.ok(out.startsWith('<!-- <my-thing> --><script>"<my-thing>"</script>'), out)
    assert.ok(squash(out).includes('<my-thing label="b" data-enhanced>'), out)
  })
})

describe('components that invoke other components', () => {
  // the definitions are put in files named so that each order is tried, the order they were read in being what this once depended on
  for (const [outerFile, innerFile] of [['a.html', 'b.html'], ['b.html', 'a.html']]) {
    it(`should enhance the inner component whichever is defined first (${outerFile} holding the outer one)`, () => {
      const out = preprocess({
        [outerFile]: '<template id="outer-thing"><inner-thing x="1"></inner-thing></template>',
        [innerFile]: '<template id="inner-thing"><b>${x}</b></template>',
        'page.html': '<outer-thing></outer-thing>'
      }, { mode: 'light', disableBeautify: true })
      assert.strictEqual(out['page.html'], '<outer-thing data-enhanced><inner-thing x="1" data-enhanced><b>1</b></inner-thing></outer-thing>')
      assert.deepStrictEqual(Object.keys(out), ['page.html'], 'a definition file was rewritten')
    })
  }

  it('should enhance an invocation nested in the light dom of another of the same kind', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="outer"><my-thing label="inner"></my-thing></my-thing>' }, { mode: 'shadow', disableBeautify: true })
    assert.ok(out['page.html'].includes('<my-thing label="inner" data-enhanced><template shadowrootmode="open"><div class="wrap"><p>inner</p></div></template></my-thing>'), out['page.html'])
  })

  it('should stop a component that invokes itself after one level, leaving the inner one for its javascript, rather than expanding it forever', t => {
    const warn = t.mock.method(console, 'warn', () => {})
    const out = preprocess({
      'def.html': '<template id="my-thing"><p>${label}</p><my-thing label="inner"></my-thing></template>',
      'page.html': '<my-thing label="outer"></my-thing>'
    }, { mode: 'shadow', disableBeautify: true })
    assert.strictEqual(out['page.html'], '<my-thing label="outer" data-enhanced><template shadowrootmode="open"><p>outer</p><my-thing data-enhanced label="inner"></my-thing></template></my-thing>')
    assert.strictEqual(warn.mock.callCount(), 1)
    assert.match(warn.mock.calls[0].arguments[0], /invokes itself \(my-thing > my-thing\)/)
  })

  it('should stop components that invoke each other in the same way', t => {
    t.mock.method(console, 'warn', () => {})
    const out = preprocess({
      'def.html': '<template id="ping-thing"><pong-thing></pong-thing></template><template id="pong-thing"><ping-thing></ping-thing></template>',
      'page.html': '<ping-thing></ping-thing>'
    }, { mode: 'light', disableBeautify: true })
    assert.strictEqual(out['page.html'], '<ping-thing data-enhanced><pong-thing data-enhanced><ping-thing data-enhanced></ping-thing></pong-thing></ping-thing>')
  })

  for (const mode of ['both', 'shadow', 'light']) {
    it(`should change nothing when run again over what it wrote with nested components in ${mode} mode`, t => {
      t.mock.method(console, 'warn', () => {})
      const files = {
        'def.html': '<template id="outer-thing"><div><inner-thing x="1"></inner-thing><outer-thing></outer-thing></div></template><template id="inner-thing"><b>${x}</b></template>',
        'page.html': '<outer-thing><outer-thing></outer-thing><span slot="s"><inner-thing x="2"></inner-thing></span></outer-thing>'
      }
      const once = preprocess(files, { mode })
      const twice = preprocess({ ...files, 'page.html': once['page.html'] }, { mode })
      assert.deepStrictEqual(twice, {})
    })
  }
})

describe('finding where an invocation ends', () => {
  it('should still enhance the invocations after one that is never closed', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"><my-thing label="b"></my-thing>' }, { mode: 'light', disableBeautify: true })
    assert.ok(out['page.html'].includes('<my-thing label="b" data-enhanced><div class="wrap"><p>b</p></div></my-thing>'), out['page.html'])
  })

  it('should not take the closing tag of an element whose name only begins the same way for its own', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"><p slot="s"><my-thing-two></my-thing-two></p></my-thing><p>after</p>' }, { mode: 'light', disableBeautify: true })
    assert.strictEqual(out['page.html'], '<my-thing label="a" data-enhanced><div class="wrap"><p>a</p></div><p slot="s"><my-thing-two></my-thing-two></p></my-thing><p>after</p>')
  })

  it('should not wait for a closing tag for a nested invocation that closes itself', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"><my-thing label="b" /></my-thing><p>after</p>' }, { mode: 'shadow', disableBeautify: true })
    assert.ok(out['page.html'].endsWith('</my-thing><p>after</p>'), out['page.html'])
    assert.ok(out['page.html'].startsWith('<my-thing label="a" data-enhanced>'), out['page.html'])
  })

  it('should not take an apostrophe in an unquoted attribute for the start of a value', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': "<my-thing label=hi don't></my-thing>" }, { mode: 'light', disableBeautify: true })
    assert.ok(out['page.html'].includes('<p>hi</p>'), out['page.html'])
  })

  it('should not be thrown off by a character that becomes longer when lower cased', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<p>İstanbul İzmir</p><my-thing label="hi"></my-thing><p>after</p>' }, { mode: 'light', disableBeautify: true })
    assert.strictEqual(out['page.html'], '<p>İstanbul İzmir</p><my-thing label="hi" data-enhanced><div class="wrap"><p>hi</p></div></my-thing><p>after</p>')
  })
})

describe('slotted children in light mode', () => {
  it('should leave a slotted child that belongs to a nested custom element where it is', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"><other-thing><span slot="theirs">x</span></other-thing></my-thing>' }, { mode: 'light', disableBeautify: true })
    assert.ok(!out['page.html'].includes('slot="theirs"'), out['page.html'])
  })

  it('should move a slotted child inside another slotted child only once, along with its parent', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"><div slot="outer"><span slot="inner">x</span></div></my-thing>' }, { mode: 'light', disableBeautify: true })
    assert.strictEqual((out['page.html'].match(/slot="inner"/g) || []).length, 1, out['page.html'])
  })
})

describe('the data-enhanced attribute', () => {
  it('should be written bare on the enhanced element without touching the same text inside it', () => {
    const out = preprocess({ 'def.html': definition, 'page.html': '<my-thing label="a"><p data-enhanced="">kept</p></my-thing>' }, { mode: 'shadow', disableBeautify: true })
    assert.ok(out['page.html'].startsWith('<my-thing label="a" data-enhanced>'), out['page.html'])
    assert.ok(out['page.html'].includes('<p data-enhanced="">kept</p>'), out['page.html'])
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
