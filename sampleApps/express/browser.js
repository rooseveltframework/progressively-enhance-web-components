class WordCount extends window.HTMLElement {
  connectedCallback () { // called whenever a new instance of this element is inserted into the dom
    // this.shadowRoot will exist already, except in light mode or for an element created in javascript
    this.shadow = this.shadowRoot || this.attachShadow({ mode: 'open' })

    // add the markup of the component if it is not already populated
    if (!this.shadow.childElementCount) {
      const markup = document.createElement('div')
      markup.appendChild(document.getElementById('word-count').content.cloneNode(true))

      // fill in its ${templateLiterals} from this element's attributes
      for (const attrib of this.attributes) markup.innerHTML = markup.innerHTML.replace(new RegExp(`\\$\\{${attrib.name}\\}`, 'gi'), attrib.value)

      this.shadow.append(...markup.childNodes)
    }

    const textarea = this.shadow.querySelector('textarea')

    // function for updating the word count
    const updateWordCount = () => {
      this.shadow.querySelector('span').textContent = `Words: ${textarea.value.trim().split(/\s+/g).filter(a => a.trim().length > 0).length}`
    }

    // update count when textarea content changes
    textarea.addEventListener('input', updateWordCount)
    updateWordCount() // update it on load as well
  }
}

window.customElements.define('word-count', WordCount) // define the new element
