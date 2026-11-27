// @ts-check

/**
 * Progressive enhancement for Declarative Shadow DOM <reai-dropzone>.
 * Styles and base <input type="file"> work before this module loads (zero FOUC).
 */
class ReaiDropzone extends HTMLElement {
  connectedCallback() {
    const input = this.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const submitParentForm = () => {
      const form = input.closest('form');
      if (form && input.files && input.files.length > 0) {
        form.requestSubmit();
      }
    };

    input.addEventListener('change', submitParentForm);

    this.addEventListener('dragover', (event) => {
      event.preventDefault();
      this.setAttribute('data-dragging', '');
    });

    this.addEventListener('dragleave', () => {
      this.removeAttribute('data-dragging');
    });

    this.addEventListener('drop', (event) => {
      event.preventDefault();
      this.removeAttribute('data-dragging');
      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      submitParentForm();
    });
  }
}

if (!customElements.get('reai-dropzone')) {
  customElements.define('reai-dropzone', ReaiDropzone);
}

const modernPlatform =
  'shadowRootMode' in HTMLTemplateElement.prototype &&
  'popover' in HTMLElement.prototype &&
  typeof CSS !== 'undefined' &&
  CSS.supports('color', 'color-mix(in oklch, red, blue)');

if (!modernPlatform) {
  const banner = document.getElementById('browser-update-notice');
  if (banner) {
    banner.hidden = false;
  }
}
