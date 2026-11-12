// Изменено в проекте «Чёрный заслон», 2026: кнопка отправки в новом интерфейсе DeepSeek. Подробнее — в NOTICE.
import { byContentEditableNear, byControlNear, byRole, bySelector } from '../../selectors';
import { createAdapter } from '../shared/create-adapter';

const DEEPSEEK_SEND_SELECTORS = [
  // Интерфейс DeepSeek на ноябрь 2026: у поля ввода больше нет id="chat-input",
  // кнопка отправки — `div[role="button"]` с классами `ds-button--primary
  // ds-button--filled` и без `aria-disabled`. Соседние иконки (вложение и др.)
  // имеют класс `ds-button--iconLabelPrimary`, под этот селектор не попадают.
  'div[role="button"].ds-button--primary',
  // Earlier UI: the send control is a `div[role="button"].ds-icon-button` whose only
  // stable trait is the `aria-disabled` attribute (hashed classes rotate per deploy).
  'div[role="button"][aria-disabled]',
  'button[type="submit"]',
] as const;

/**
 * DeepSeek (chat.deepseek.com). The composer is a plain `textarea`
 * (`#chat-input`, placeholder "Message DeepSeek"). The send control is an icon
 * `div[role="button"]` with no label — located via its `aria-disabled`
 * attribute near the composer. Enter interception on the composer is the
 * primary path; the button cascade is best-effort.
 */
export const deepseekAdapter = createAdapter({
  id: 'deepseek',
  // Keep in sync with host_permissions / content-script matches in wxt.config.ts.
  matches: ['chat.deepseek.com'],
  composer: [
    bySelector('#chat-input'),
    bySelector('textarea[placeholder*="DeepSeek" i]'),
    byRole('textbox', { editable: true }),
    byContentEditableNear('div[role="button"][aria-disabled]'),
    bySelector('textarea, div[contenteditable="true"]'),
  ],
  submitButton: [
    // Stay scoped to the composer — a page-wide aria-disabled match can hit
    // unrelated icon buttons (sidebar, toolbar) and send the wrong click.
    byControlNear('#chat-input', DEEPSEEK_SEND_SELECTORS),
    byControlNear('textarea', DEEPSEEK_SEND_SELECTORS),
  ],
  conversationRoot: [bySelector('main')],
});
