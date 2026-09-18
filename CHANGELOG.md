## 2.0.0

- Breaking: A component is now written into a declarative shadow root, with a copy of its markup kept beside that as fallback content, rather than into the light DOM alone. This keeps the `<style>`, `<script>` and `<slot>` elements a fallback cannot use, styles the component and makes its slots work before any JavaScript runs, and leaves nothing to be swapped once the component upgrades, while a browser that does not build shadow roots still renders the fallback as it always did.
  - Related: A component class that calls `attachShadow` unconditionally now throws away what the server rendered. The browser's parser has already built the shadow root, and `attachShadow` on one it built does not fail: it hands back that same root having emptied it, so the class appears to work while rebuilding in the browser everything that had already arrived rendered, which is the cost a declarative shadow root exists to avoid. Read `this.shadowRoot` instead, falling back to `attachShadow` for an element created in JavaScript rather than written into the page, and fill the shadow root from the `<template>` only when it is empty.
  - Related: The children of an invocation are now left where they were written, being the light DOM that the slots of the shadow root project. Previously a child carrying a `slot` attribute was moved to the top level of the fallback and a child without one was dropped. Only a direct child of an element can be assigned to a slot, so a slotted child written deeper than that no longer reaches one.
  - To keep the previous output exactly, set the new `mode` param to `light`.
- Added `both`, `shadow`, and `light` enhancement modes, set for the whole project with the `mode` param or per component with a `mode` attribute on its `<template>`. `both` is the default and is described above. `shadow` writes only the declarative shadow root, which is smaller but renders nothing at all where declarative shadow DOM is unsupported. `light` writes only the fallback markup, which is what this module did before this version.
- Added a `data-enhanced` attribute, written onto every element this module enhances. An element that already carries one is left exactly as it was, so running this over templates it has already preprocessed no longer stacks a second shadow root and a second copy of the fallback onto the same element. Write it yourself to keep an invocation whose markup you have written out by hand.
  - Related: An invocation holding a `<template shadowrootmode>` of its own is left alone whether or not it carries the attribute, a browser refusing to build a second declarative shadow root on the same element.
- Added browser tests that drive the express sample app in Chromium with Playwright, covering what no preprocessor test can: that the parser builds the shadow root, that the component class upgrades the element without discarding what the server rendered into it, that slotted content is projected, that the fallback stays inert where a shadow root was built and renders where one was not, and that nothing is shown twice in either case.
- Fixed the sample app calling `body-parser`, which it never declared as a dependency and which Express has had built in for years.
- Fixed the pieces of an enhanced element running together on one line, the shadow root, the fallback and the light DOM now each starting on their own. js-beautify treats `<template>` as an inline element and would not break the line before one.
- Improved performance.
- Fixed a file invoking more than one kind of custom element only having the last one enhanced. Each custom element was applied to the file as it was on disk rather than to what the previous one had produced, so every pass but the last was thrown away.
- Fixed a custom element invoked inside another of the same kind producing malformed markup, with a stray closing tag left behind. Pairing an opening tag with the closing tag that belongs to it is not something a regular expression can do, so it is no longer asked to.
- Fixed `disableBeautify` being ignored when building a component's markup, so the option now leaves the markup alone as it says it does.
- Fixed the module silencing part of the host application's `console.error` for the life of the process. jsdom's complaints about unparseable CSS are now silenced only while the module is doing its work.
- Updated various dependencies.

## 1.0.4

- Fixed a bug that would cause the module to crash if the file list provided by the user wasn't a directory.
- Updated various dependencies.

## 1.0.3

- Fixed another bug that caused errors to print to the console if inline CSS existed in a scanned template.

## 1.0.2

- Fixed a bug that could cause templates to be significantly altered by this preprocessor due to having been fully ingested by a DOM parser and then re-serialized back into a string. As of this version, only the custom elements that are progressively enhanced will be ingested by the DOM parser and re-serialized back into a string.
- Fixed a bug that caused errors to print to the console if inline CSS existed in a scanned template.
- Updated various dependencies.

## 1.0.1

- Fixed a bug that prevented camelCase attribute names from replacing `${templateLiteral}` values for values in <template> markup.
- Updated various dependencies.

## 1.0.0

- Initial commit.
