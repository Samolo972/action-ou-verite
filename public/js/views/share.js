// Écran « Inviter » : QR code, code, lien à copier, partage natif (maquette « Invitation »).
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { drawQR } from '../qr.js';

/** Copie dans le presse-papiers, avec repli si l'API Clipboard est indisponible (http, vieux navigateurs). */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* on tente le repli */
  }
  const ta = h('textarea', { readonly: true, 'aria-hidden': 'true', class: 'sr-only' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Bloc QR code avec le logo au centre. */
export function qrBlock(url, { size = 200, caption = "Scanne avec l'appareil photo", label } = {}) {
  const canvas = h('canvas', { width: size, height: size });
  drawQR(canvas, url, { size });
  return h(
    'div',
    { class: 'qr-box' },
    h(
      'div',
      { class: 'qr-wrap', role: 'img', 'aria-label': label || "QR code vers le lien d'invitation" },
      canvas,
      h('div', { class: 'qr-logo', 'aria-hidden': 'true' }, h('span', { class: 'inner' }, h('span', { class: 'a' }, 'A'), h('span', { class: 'v' }, 'V'))),
    ),
    caption ? h('span', { class: 'qr-caption' }, caption) : null,
  );
}

export function shareView(app) {
  const el = h('main', { class: 'screen' });
  let builtFor = null;

  function update(ctx) {
    const { room } = ctx;
    if (builtFor === room.inviteUrl) return;
    builtFor = room.inviteUrl;
    const url = room.inviteUrl;
    const display = url.replace(/^https?:\/\//, '');

    const copyBtn = h('button', { type: 'button', class: 'copy-btn', 'data-fk': 'copy' }, 'Copier');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(url);
      copyBtn.textContent = ok ? 'Copié !' : 'Copie impossible';
      copyBtn.classList.toggle('is-done', ok);
      setTimeout(() => {
        if (!copyBtn.isConnected) return;
        copyBtn.textContent = 'Copier';
        copyBtn.classList.remove('is-done');
      }, 2000);
    });

    const canShare = typeof navigator.share === 'function';
    const shareBtn = canShare
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn--l btn--blue',
            onclick: () =>
              navigator
                .share({ title: "Action ou Vérité", text: "Rejoins ma partie d'Action ou Vérité !", url })
                .catch(() => {}),
          },
          icon('share', { width: 2.2 }),
          'Partager (WhatsApp, SMS…)',
        )
      : null;

    const linkInput = h('input', { id: 'lien', type: 'text', readonly: true, value: display });
    linkInput.addEventListener('focus', () => linkInput.select());

    el.replaceChildren(
      h(
        'div',
        { class: 'topbar' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour au salon', 'data-fk': 'back', onclick: () => app.setUI({ share: false }) }, icon('back')),
        h('div', { class: 'topbar-title' }, h('strong', null, 'Inviter des joueurs')),
        h('div', { class: 'spacer-44' }),
      ),
      qrBlock(url, { label: `QR code vers le lien d'invitation du salon ${room.code}` }),
      h('div', { class: 'code-block' }, h('span', null, 'Code du salon'), h('span', { class: 'code-m' }, room.code)),
      h('div', { class: 'field' }, h('label', { for: 'lien', class: 'label' }, "Lien d'invitation"), h('div', { class: 'link-field' }, linkInput, copyBtn)),
      shareBtn,
      h('p', { class: 'note push-bottom' }, 'Le lien remplit le code automatiquement.', h('br'), 'Il ne marche plus quand le salon est fermé ou verrouillé.'),
    );
  }

  return { el, update };
}
