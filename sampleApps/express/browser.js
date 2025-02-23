class WordCount extends window.HTMLElement {
  connectedCallback () { // called whenever a new instance of this element is inserted into the dom
    this.shadow = this.attachShadow({ mode: 'open' }) // create and attach a shadow dom to the custom element
    this.shadow.appendChild(document.getElementById('word-count').content.cloneNode(true)) // create the elements in the shadow dom from the template element

    // set textarea attributes
    const textarea = this.shadow.querySelector('textarea')
    textarea.value = this.getAttribute('text') || ''
    textarea.id = this.getAttribute('id') || ''
    textarea.name = this.getAttribute('id') || ''

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
