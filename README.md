🕸️ **progressively-enhance-web-components** [![npm](https://img.shields.io/npm/v/progressively-enhance-web-components.svg)](https://www.npmjs.com/package/progressively-enhance-web-components)

A template file preprocessor for [progressively enhancing](https://en.wikipedia.org/wiki/Progressive_enhancement) web components in Node.js.

It works by reading a directory of HTML templates for your web application, identifying any web components, and replacing custom element invocations with fallback markup that will work if JavaScript is disabled which will then be progressively enhanced into the desired web component when the JavaScript loads.

This allows you to use web components in server-side templating the same way you would with client-side templating without creating a hard dependency on JavaScript for rendering templates with web components and without having to write two different templates for each context.

This module was built and is maintained by the [Roosevelt web framework](https://rooseveltframework.org) [team](https://rooseveltframework.org/contributors), but it can be used independently of Roosevelt as well.

<details open>
  <summary>Documentation</summary>
  <ul>
    <li><a href="./USAGE.md">Usage</a></li>
    <li><a href="./CONFIGURATION.md">CONFIGURATION</a></li>
  </ul>
</details>

## Technique

To leverage this module's progressive enhancement technique, you will need to follow some simple rules when authoring your web component:

1. Always define the markup structure using a `<template>` element. The definition can exist anywhere in any of your templates, but the definition must exist.
2. The template element you create to define your web component must have an `id` matching the name of the web component. So `<my-component>` must have a corresponding `<template id="my-component">` somewhere in your templates.
3. Use `${templateLiteral}` values for values in your `<template>` markup. See "Usage" for more details.
