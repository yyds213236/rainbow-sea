// 彩虹海 modification: clear navigation feedback independently of control messages.
const $ = id => document.getElementById(id);
let toastTimer, toastSource;

export function toast(text, source = 'controls') {
  if (!text && source !== toastSource) return;
  const status = $('toast');
  clearTimeout(toastTimer);
  status.textContent = text;
  status.classList.toggle('show', Boolean(text));
  toastSource = text ? source : null;
  if (text) {
    toastTimer = setTimeout(() => {
      status.classList.remove('show');
      status.textContent = '';
      toastSource = null;
    }, 2600);
  }
}

export function fail(message) {
  const loading = $('loading');
  if (loading) loading.style.display = 'none';
  $('error').hidden = false;
  $('error-message').textContent = message;
}
