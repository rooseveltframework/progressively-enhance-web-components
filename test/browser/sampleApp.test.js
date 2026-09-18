// what the preprocessor writes, loaded by a browser that builds declarative shadow roots
//
// every assertion here is about something jsdom cannot represent: whether the parser built the shadow root, what a slot projected, whether an unassigned child was rendered, and whether the component class could upgrade an element that already had a shadow root
const { test, expect } = require('@playwright/test')

const PAGE = '/pageWithForm'

// the box an element occupies, which is how an unassigned child is told apart from a rendered one: an unassigned child is in the dom but has no box
const rendered = async (locator) => (await locator.evaluate(el => {
  const box = el.getBoundingClientRect()
  return box.width > 0 || box.height > 0
}))

test.describe('with javascript, as the component upgrades', () => {
  test('should upgrade the element the parser already gave a shadow root, rather than throwing', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(PAGE)

    const upgraded = await page.locator('word-count').evaluate(el => el.constructor.name !== 'HTMLElement' && !!el.shadowRoot)
    expect(upgraded, 'the component did not upgrade').toBe(true)
    // attachShadow on an element that has a shadow root throws, and a second declarative shadow root is refused and reported
    expect(errors, 'the page reported errors').toEqual([])
  })

  // attachShadow on an element whose shadow root the parser built does not throw: it hands back that same root and empties it. so a class written the way one was before declarative shadow roots still appears to work, having quietly thrown away everything the server rendered and built it again from the <template>, which is the whole cost declarative shadow roots exist to avoid
  //
  // the nodes the parser made are marked while the component is still undefined, and the mark is what says they survived the upgrade
  test('should keep the shadow dom the server rendered rather than building it again', async ({ page }) => {
    await page.route('**/bundle.js', route => route.abort())
    await page.goto(PAGE)

    const stamped = await page.locator('word-count').evaluate(el => {
      if (!el.shadowRoot) return false
      el.shadowRoot.querySelector('textarea').dataset.fromTheServer = 'yes'
      return true
    })
    expect(stamped, 'the parser did not build a shadow root to mark').toBe(true)

    // the component's script is let through now, which defines the element and upgrades the one already on the page
    await page.unroute('**/bundle.js')
    await page.addScriptTag({ url: '/bundle.js' })
    await page.locator('word-count').evaluate(el => window.customElements.whenDefined('word-count'))

    const survived = await page.locator('word-count').evaluate(el => el.shadowRoot.querySelector('textarea')?.dataset.fromTheServer === 'yes')
    expect(survived, 'the class replaced the shadow dom the server rendered').toBe(true)
  })

  test('should mark the element it enhanced', async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.locator('word-count')).toHaveAttribute('data-enhanced', '')
  })

  test('should keep the styles of the component inside its shadow root', async ({ page }) => {
    await page.goto(PAGE)
    const position = await page.locator('word-count').evaluate(el => window.getComputedStyle(el.shadowRoot.querySelector('div')).position)
    expect(position).toBe('relative')

    // the same rule must not reach the rest of the page, which is what a shadow root is for
    const leaked = await page.evaluate(() => window.getComputedStyle(document.querySelector('article > p')).position)
    expect(leaked).toBe('static')
  })

  test('should count the words the server rendered into the textarea', async ({ page }) => {
    await page.goto(PAGE)
    const count = await page.locator('word-count').evaluate(el => el.shadowRoot.querySelector('span.word-count').textContent)
    expect(count).toBe('Words: 4')
  })

  test('should count again as the user types', async ({ page }) => {
    await page.goto(PAGE)
    const textarea = page.locator('word-count textarea:visible') // playwright pierces the shadow root, so the fallback copy matches too; only one of the two is rendered
    await textarea.fill('one two three')
    const count = await page.locator('word-count').evaluate(el => el.shadowRoot.querySelector('span.word-count').textContent)
    expect(count).toBe('Words: 3')
  })

  test('should project the slotted content the page wrote, and render it once', async ({ page }) => {
    await page.goto(PAGE)
    const slotted = page.locator('word-count > [slot="description"]')
    expect(await slotted.evaluate(el => el.assignedSlot?.name)).toBe('description')
    await expect(page.getByText('Type your story in the box above!')).toHaveCount(1)
  })

  test('should leave the fallback markup unrendered where the shadow root was built', async ({ page }) => {
    await page.goto(PAGE)
    const fallback = page.locator('word-count > [slot="pewc-fallback"]')
    await expect(fallback).toHaveCount(1)
    expect(await fallback.evaluate(el => el.assignedSlot), 'the fallback was assigned to a slot').toBe(null)
    expect(await rendered(fallback), 'the fallback was rendered beside the component').toBe(false)
  })

  test('should show exactly one textarea, not the shadow one and the fallback one', async ({ page }) => {
    await page.goto(PAGE)
    const visible = await page.evaluate(() => {
      const host = document.querySelector('word-count')
      const all = [...document.querySelectorAll('textarea'), ...host.shadowRoot.querySelectorAll('textarea')]
      return all.filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 || box.height > 0 }).length
    })
    expect(visible).toBe(1)
  })

  test('should build a shadow root of its own for a component created in javascript', async ({ page }) => {
    await page.goto(PAGE)
    const made = await page.evaluate(() => {
      const el = document.createElement('word-count')
      el.setAttribute('text', 'a brand new story here')
      el.setAttribute('elId', 'made-in-js')
      const form = document.createElement('form')
      document.body.append(form)
      form.append(el)
      const textarea = el.shadowRoot.querySelector('textarea')
      form.reset() // a leftover ${templateLiteral} in the markup would come back here
      return {
        builtItsOwn: !!el.shadowRoot,
        id: textarea.id,
        value: textarea.value,
        leftoverLiterals: el.shadowRoot.innerHTML.includes('${'),
        count: el.shadowRoot.querySelector('span.word-count').textContent
      }
    })
    expect(made).toEqual({ builtItsOwn: true, id: 'made-in-js', value: 'a brand new story here', leftoverLiterals: false, count: 'Words: 5' })
  })
})

test.describe('without javascript', () => {
  test.use({ javaScriptEnabled: false })

  // the parser builds a declarative shadow root without running anything, so with scripting off the component still renders and only the behavior is missing. the fallback is for a browser that does not build one at all, which is the section below
  test('should still render the component from its shadow root', async ({ page }) => {
    await page.goto(PAGE)
    const textarea = page.locator('word-count textarea:visible')
    await expect(textarea).toHaveValue('Once upon a time... ')
    const position = await page.locator('word-count').evaluate(el => window.getComputedStyle(el.shadowRoot.querySelector('div')).position)
    expect(position, 'the styles of the component were not applied').toBe('relative')
  })

  test('should still show the slotted content the page wrote', async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByText('Type your story in the box above!')).toBeVisible()
  })

  test('should keep the fallback markup inert, the shadow root having been built', async ({ page }) => {
    await page.goto(PAGE)
    const fallback = page.locator('word-count > [slot="pewc-fallback"]')
    expect(await rendered(fallback), 'the fallback rendered beside the shadow root').toBe(false)
  })

  test('should show exactly one textarea for the component', async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.locator('word-count textarea:visible')).toHaveCount(1)
  })

  test('should leave the word counter empty, that being the part javascript is there for', async ({ page }) => {
    await page.goto(PAGE)
    const count = await page.locator('word-count').evaluate(el => el.shadowRoot.querySelector('span.word-count').textContent)
    expect(count).toBe('')
  })

  test('should submit the form the component is part of', async ({ page }) => {
    await page.goto(PAGE)
    await page.locator('button[name="button1"]').click()
    await expect(page.locator('word-count')).toHaveCount(1)
  })
})

// every browser playwright can drive builds declarative shadow roots, so the one thing it cannot show is a browser that does not. parsing the same bytes through innerHTML stands in for that: innerHTML does not process shadowrootmode, which leaves the markup in exactly the shape such a browser would see
test.describe('in a browser that does not build declarative shadow roots', () => {
  const parseWithoutShadowRoots = async (page) => {
    // the component's own script is blocked so that <word-count> is never defined: appending markup for an element that is defined upgrades it, which would build the very shadow root this is meant to do without
    await page.route('**/bundle.js', route => route.abort())
    await page.goto(PAGE)
    return page.evaluate(async (url) => {
      const raw = await fetch(url).then(response => response.text())
      const holder = document.createElement('div')
      holder.innerHTML = raw.slice(raw.indexOf('<word-count'), raw.indexOf('</word-count>') + '</word-count>'.length)
      document.body.append(holder)
      const host = holder.querySelector('word-count')
      const box = el => { const rect = el.getBoundingClientRect(); return rect.width > 0 || rect.height > 0 }
      return {
        builtAShadowRoot: !!host.shadowRoot,
        templateRendered: box(host.querySelector('template')),
        fallbackRendered: box(host.querySelector('[slot="pewc-fallback"]')),
        fallbackValue: host.querySelector('[slot="pewc-fallback"] textarea').value,
        slottedRendered: box(host.querySelector('[slot="description"]')),
        visibleTextareas: [...host.querySelectorAll('textarea')].filter(box).length
      }
    }, PAGE)
  }

  test('should render the fallback markup, prefilled, and nothing twice', async ({ page }) => {
    expect(await parseWithoutShadowRoots(page)).toEqual({
      builtAShadowRoot: false,
      templateRendered: false,
      fallbackRendered: true,
      fallbackValue: 'Once upon a time... ',
      slottedRendered: true,
      visibleTextareas: 1
    })
  })
})
