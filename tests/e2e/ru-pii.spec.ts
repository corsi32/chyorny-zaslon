import { expect, test, type Page } from '@playwright/test';
import {
  launchExtensionContext,
  newFixturePage,
  offsendHost,
  setExtensionPolicyMode,
} from './helpers/extension';

/**
 * Сквозные сценарии с российскими персональными данными во всех трёх режимах
 * и при разных способах ввода (заполнение, посимвольный ввод, вставка Ctrl+V).
 * Используется та же копия страницы ChatGPT, что и в policy.spec.ts.
 */

const ADDRESS = 'г. Москва, ул. Тверская, д. 1, кв. 5';
const SNILS = '112-233-445 95';
const PHONE = '8 (999) 123-45-67';
const PASSPORT = '4512 123456';
const PROMPT = `Оформи доставку: ${ADDRESS}, тел. ${PHONE}, СНИЛС ${SNILS}, паспорт ${PASSPORT}.`;

const composer = (page: Page) => page.getByRole('textbox', { name: /message chatgpt/i });
const sendButton = (page: Page) => page.getByRole('button', { name: /send prompt/i });

async function openWithMode(mode: 'warn' | 'auto-mask' | 'block', path: string) {
  const context = await launchExtensionContext();
  await setExtensionPolicyMode(context, mode);
  const page = await newFixturePage(context, `https://chatgpt.com/c/${path}`, 'chatgpt.html');
  await expect(offsendHost(page)).toBeAttached();
  await setExtensionPolicyMode(context, mode);
  await page.reload();
  await expect(offsendHost(page)).toBeAttached();
  return { context, page };
}

/** Проверяет, что в поле ввода остались только подстановки, без исходных значений. */
async function expectMaskedComposer(page: Page) {
  // В копии страницы поле ввода — contenteditable, поэтому читаем textContent.
  const text = (await page.locator('#prompt-textarea').textContent()) ?? '';
  const placeholders = [
    /\{\{ADDRESS_RU_1_[a-z0-9]+\}\}/,
    /\{\{PHONE_1_[a-z0-9]+\}\}/,
    /\{\{SNILS_1_[a-z0-9]+\}\}/,
    /\{\{PASSPORT_1_[a-z0-9]+\}\}/,
  ];
  for (const placeholder of placeholders) {
    expect(text).toMatch(placeholder);
  }
  for (const original of [ADDRESS, SNILS, PHONE, PASSPORT]) {
    expect(text).not.toContain(original);
  }
}

test('автомаскировка заменяет адрес, телефон, СНИЛС и паспорт подстановками', async () => {
  const { context, page } = await openWithMode('auto-mask', 'ru-auto-mask');
  try {
    await composer(page).fill(PROMPT);
    await sendButton(page).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectMaskedComposer(page);
  } finally {
    await context.close();
  }
});

test('предупреждение показывает все найденные российские данные', async () => {
  const { context, page } = await openWithMode('warn', 'ru-warn');
  try {
    await composer(page).fill(PROMPT);
    await sendButton(page).click();

    const dialog = page.getByRole('dialog', { name: /zaslon review/i });
    await expect(dialog).toBeVisible();
    // Адрес длинный — проверяем по характерной части, на случай сокращения в карточке.
    for (const value of ['ул. Тверская', SNILS, PHONE, PASSPORT]) {
      await expect(dialog).toContainText(value);
    }
  } finally {
    await context.close();
  }
});

test('блокировка не даёт отправить сообщение с СНИЛС', async () => {
  const { context, page } = await openWithMode('block', 'ru-block');
  try {
    await composer(page).fill(`СНИЛС ${SNILS}`);
    await sendButton(page).click();

    await expect(page.getByRole('dialog', { name: /zaslon review/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /send anyway/i })).toHaveCount(0);
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('ручной посимвольный ввод маскируется так же, как вставленный текст', async () => {
  const { context, page } = await openWithMode('auto-mask', 'ru-typed');
  try {
    await composer(page).pressSequentially(PROMPT, { delay: 5 });
    await sendButton(page).click();
    await expectMaskedComposer(page);
  } finally {
    await context.close();
  }
});

test('текст, вставленный через Ctrl+V, маскируется при отправке', async () => {
  const { context, page } = await openWithMode('auto-mask', 'ru-paste');
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://chatgpt.com',
    });
    await page.evaluate((text) => navigator.clipboard.writeText(text), PROMPT);
    await composer(page).click();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(composer(page)).toHaveText(PROMPT);

    await sendButton(page).click();
    await expectMaskedComposer(page);
  } finally {
    await context.close();
  }
});

test('обычный текст без персональных данных отправляется без вмешательства', async () => {
  const { context, page } = await openWithMode('block', 'ru-clean');
  try {
    const clean = 'Объясни, как работает алгоритм Луна, на примере 2024 года и 15 человек.';
    await composer(page).fill(clean);
    await sendButton(page).click();
    await expect(page.getByRole('dialog', { name: /zaslon review/i })).toHaveCount(0);
    await expect(page.locator('[data-role="user"]')).toHaveText(clean);
  } finally {
    await context.close();
  }
});
