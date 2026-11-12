// Изменено в проекте «Чёрный заслон», 2026: тест нового интерфейса DeepSeek. Подробнее — в NOTICE.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deepseekAdapter } from '@/core/adapters/deepseek';
import type { Unsubscribe } from '@/core/adapters';

const FIXTURE = `
  <main>
    <textarea id="chat-input" placeholder="Message DeepSeek"></textarea>
    <div role="button" aria-disabled="false" class="ds-icon-button">Send</div>
  </main>
`;

const cleanups: Unsubscribe[] = [];

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups.length = 0;
});

describe('deepseek adapter', () => {
  it('finds the composer and reports healthy', () => {
    expect(deepseekAdapter.findComposer(document)).not.toBeNull();
    expect(deepseekAdapter.healthCheck(document).status).toBe('ok');
  });

  it('does not match a page-wide aria-disabled decoy far from the composer', () => {
    document.body.innerHTML = `
      <aside><div role="button" aria-disabled="false">Sidebar</div></aside>
      <main>
        <textarea id="chat-input"></textarea>
        <div role="button" aria-disabled="false" id="real-send">Send</div>
      </main>
    `;
    const composer = deepseekAdapter.findComposer(document)!;
    composer.element.textContent = '';
    (composer.element as HTMLTextAreaElement).value = 'hello';
    // healthCheck uses scoped send resolution — must stay ok with nearby send.
    expect(deepseekAdapter.healthCheck(document).status).toBe('ok');
  });

  it('finds the send button in the 2026 UI (no #chat-input, no aria-disabled)', () => {
    document.body.innerHTML = `
      <main>
        <div class="composer">
          <textarea placeholder="Сообщение для DeepSeek"></textarea>
          <div class="toolbar">
            <div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon">Глубокое мышление</div>
            <div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon">Умный поиск</div>
            <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle" id="send"></div>
          </div>
        </div>
      </main>
    `;
    const composer = deepseekAdapter.findComposer(document)!;
    expect(composer).not.toBeNull();
    // С текстом в поле отсутствие кнопки отправки помечается как «неполная защита».
    (composer.element as HTMLTextAreaElement).value = 'hello';
    expect(deepseekAdapter.healthCheck(document).status).toBe('ok');
  });

  it('intercepts Enter with textarea value', async () => {
    const composer = deepseekAdapter.findComposer(document)!;
    (composer.element as HTMLTextAreaElement).value = 'mail a@b.com';

    const text = new Promise<string>((resolve) => {
      cleanups.push(
        deepseekAdapter.onSubmitAttempt(composer, async (ctx) => {
          resolve(ctx.text);
          return { action: 'block' };
        }),
      );
    });

    composer.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(await text).toBe('mail a@b.com');
  });
});
