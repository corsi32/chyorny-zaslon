# Материалы для магазинов расширений

Тексты и ответы на вопросы форм Firefox Add-ons (AMO), Microsoft Edge Add-ons и Chrome Web Store.
Картинки лежат в этой же папке.

## 1. Общие данные

| Поле | Значение |
| --- | --- |
| Название | Чёрный заслон — защита данных в ИИ-чатах (берётся из манифеста; англ.: Chyorny Zaslon — PII shield for AI chats) |
| Версия | 0.4.2 |
| Категория | Конфиденциальность и безопасность (Privacy & Security); если такой нет — «Инструменты» / Productivity |
| Язык по умолчанию | English (в манифесте `default_locale: en`), русский перевод подтягивается из `_locales/ru` |
| Лицензия | Apache License 2.0 |
| Домашняя страница | https://github.com/corsi32/chyorny-zaslon |
| Поддержка | https://github.com/corsi32/chyorny-zaslon/issues |
| Политика конфиденциальности | https://github.com/corsi32/chyorny-zaslon/blob/main/PRIVACY.md |
| Иконка | `icon-128.png` (128×128), `logo-300.png` (300×300, для Edge) |

## 2. Краткое описание

**RU** (до 132 символов, совпадает с манифестом):

> Телефоны, адреса, СНИЛС, паспорта, карты и секреты не уходят в ИИ-чаты. Проверка на устройстве, без аккаунта, открытый код.

**EN:**

> Phone numbers, addresses, IDs, cards and secrets stay out of AI chats. Checked on your device, no account, open source.

## 3. Полное описание

### RU

```
Чёрный заслон проверяет сообщение перед отправкой в ИИ-чат и не даёт персональным данным уйти на сервер.

Работает в веб-версиях ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok и Copilot.

Что находит:
• номера телефонов, в том числе слитные 89991234567 и международные;
• почтовые адреса РФ с проверкой индекса;
• СНИЛС с проверкой контрольного числа;
• паспорта РФ;
• номера банковских счетов;
• банковские карты, включая «МИР» (алгоритм Луна);
• email, IBAN, IP-адреса, ключи API, токены и приватные ключи.

Три режима:
• Предупреждать — показывает находки и то, что уйдёт на сервер;
• Автомаскировка — заменяет данные подстановками вида {{PHONE_1}} и отправляет;
• Блокировать — не даёт отправить сообщение без маскирования.

Ответ ИИ показывается с настоящими значениями: подстановки заменяются обратно прямо на странице.

Конфиденциальность:
• вся проверка выполняется на вашем устройстве;
• текст сообщений никуда не отправляется, аккаунт не нужен;
• исходные значения хранятся зашифрованными и удаляются через 60 минут (срок настраивается).

Проект основан на открытом расширении Offsend (Apache-2.0) и дополнен детекторами персональных данных граждан РФ.
Исходный код и сообщения об ошибках: https://github.com/corsi32/chyorny-zaslon
```

### EN

```
Chyorny Zaslon checks your message before it is sent to an AI chat and keeps personal data from reaching the server.

Works on the web versions of ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok and Copilot.

Detects:
• phone numbers, including run-together and international formats;
• Russian postal addresses with postcode validation;
• Russian SNILS (checksum) and passport numbers;
• bank account numbers;
• payment cards, including MIR (Luhn check);
• email, IBAN, IP addresses, API keys, tokens and private keys.

Three modes:
• Warn — shows what was found and what will be sent;
• Auto-mask — replaces findings with placeholders like {{PHONE_1}} and sends;
• Block — prevents sending until the data is masked.

AI replies are shown with the real values: placeholders are restored in the page.

Privacy:
• all checks run on your device;
• message text is never sent anywhere, no account required;
• original values are stored encrypted and deleted after 60 minutes (configurable).

Based on the open-source Offsend extension (Apache-2.0), extended with detectors for Russian personal data.
Source code and issue tracker: https://github.com/corsi32/chyorny-zaslon
```

## 4. Ответы для вкладки «Privacy practices» (Chrome) и аналогичных форм

**Single purpose / Единственное назначение:**

> Detects personal data and secrets in messages typed into AI chat websites and warns, masks or blocks them before the message is sent.

**Обоснование разрешений.** В манифесте только эти разрешения; `tabs`, `scripting` и других нет.

| Разрешение | Обоснование (англ., для формы) |
| --- | --- |
| `storage` | Stores the user's settings (mode, enabled detectors, exceptions) and the encrypted original values needed to restore masked data in AI replies. All data stays on the device. |
| `alarms` | Runs a periodic cleanup that deletes stored original values after their expiry time (60 minutes by default). |
| Host permissions (chatgpt.com, claude.ai, gemini.google.com, chat.deepseek.com, perplexity.ai, grok.com, copilot.microsoft.com) | The content script must read the message being composed on these AI chat sites to check it for personal data before sending, and restore masked values in the replies. The extension does not run on any other sites. |

**Remote code / Удалённый код:** No, I am not using remote code. Весь код входит в пакет.

**Data usage / Сбор данных:** не отмечать ни одного пункта. Расширение не собирает и не передаёт данные пользователя.

Подтвердить три пункта:
- данные не продаются третьим лицам;
- данные не используются для целей, не связанных с назначением;
- данные не используются для оценки кредитоспособности.

**Privacy policy URL:** https://github.com/corsi32/chyorny-zaslon/blob/main/PRIVACY.md

## 5. Firefox Add-ons — исходный код и заметки для проверяющего

Код собирается сборщиком (WXT + Vite), поэтому AMO требует исходники. Загрузить `chyorny-zaslon-0.4.2-sources.zip`.

Текст для поля «Notes to Reviewer»:

```
Build instructions (Windows/Linux/macOS):
1. Install Node.js 22 (npm 10).
2. Unpack the sources archive and run in its root:
   npm ci
   npm run zip:firefox
3. The resulting package is .output/chyorny-zaslon-0.4.2-firefox.zip
   (unpacked build: .output/firefox-mv2).

No remote code, no network requests, no data collection.
The "Unsafe assignment to innerHTML" warning comes from the bundled react-dom library
(its internal handling of dangerouslySetInnerHTML and <script> creation). The extension's own code
in src/ never uses innerHTML or dangerouslySetInnerHTML; all UI is rendered with React elements.
The optional telemetry module from the upstream project is disabled:
it only works when WXT_TELEMETRY_APP_ID is set at build time, and it is not set.

How to test: open https://chatgpt.com, type "my phone 8 999 123-45-67" into the message box
and press Send - the extension shows a warning with the detected phone number.
```

Если сборщик Mozilla спросит про данные: в манифесте указано `data_collection_permissions: none`.

## 6. Edge Add-ons — заметки для сертификации

Поле «Notes for certification»: тот же текст «How to test», что и выше. Учётная запись для проверки не нужна.

## 7. Изображения

| Файл | Размер | Где использовать |
| --- | --- | --- |
| `screenshot-1-warn.png` | 1280×800 | все магазины, главный скриншот |
| `screenshot-2-glued.png` | 1280×800 | все магазины |
| `screenshot-3-block.png` | 1280×800 | все магазины |
| `screenshot-4-settings.png` | 1280×800 | все магазины |
| `screenshot-5-welcome.png` | 1280×800 | по желанию |
| `promo-440x280.png` | 440×280 | Chrome: small promo tile; Edge: small promotional tile |
| `marquee-1400x560.png` | 1400×560 | Chrome: marquee; Edge: large promotional tile |
| `logo-300.png` | 300×300 | Edge: логотип расширения |
| `icon-128.png` | 128×128 | Chrome: store icon |

## 8. После одобрения

Вписать ссылки на страницы магазинов в раздел «Установка» файла README.md (там оставлен закомментированный шаблон).
