/**
 * One-off: настроить image-команды для botId=1 на Railway.
 * Запуск: node scripts/configure-bot1-image-commands.js
 */
const BASE = process.env.RAILWAY_BASE_URL || 'https://aiasol-production-c345.up.railway.app';
const USER = process.env.ADMIN_USER || 'fedotov@pravocard.ru';
const PASS = process.env.ADMIN_PASS;
const BOT_ID = process.env.BOT_ID || '1';

if (!PASS) {
  console.error('Set ADMIN_PASS (or use .env.railway.test)');
  process.exit(1);
}

const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');

const IMAGE_CLASSIFIER = `Правила картинок (сверху важнее):

/ocr — вопрос ОБ ИЗОБРАЖЕНИИ без правки: «в какой позе», «что на фото», «опиши», «проанализируй», «какого цвета», «распознай текст». Не путать с правкой картинки.

/correct_image_your — правка ПОСЛЕДНЕЙ картинки БОТА (только что прислал): «сделай днём», «замени фон», «добавь X», «та же сцена но…», «переделай», «исправь» — даже если пишет «нарисуй/сгенерируй» про ту же картинку.

/create_image — НОВАЯ картинка с нуля, другой сюжет, не связанный с последней картинкой бота.

/correct_image_my — в сообщении есть фото пользователя ИЛИ правка его графика/скрина по тексту («вставь на экран», «этот график»).

Если без картинок — по CJM: /start, /lesson0 и т.д.`;

const UPDATES = [
  {
    key: '/ocr',
    section: 'diagnostics',
    classifier: IMAGE_CLASSIFIER,
    response: `Проанализируй изображение и ответь на вопрос пользователя: поза, одежда, предметы, текст на фото, обстановка.`,
  },
  {
    key: '/create_image',
    section: 'diagnostics',
    classifier: `${IMAGE_CLASSIFIER}

После генерации картинки пользователь часто пишет правки — почти всегда это /correct_image_your, не новая /create_image.`,
    response: `Реалистичное изображение, высокая детализация, естественное освещение, соотношение 16:9 если уместно.`,
  },
  {
    key: '/correct_image_your',
    section: 'diagnostics',
    classifier: IMAGE_CLASSIFIER,
    response: `Подготовь точный промпт для редактирования последней картинки, которую сгенерировал бот.
Сохрани композицию, ракурс и ключевые объекты сцены (офис, люди, монитор и т.д.).
Измени только то, что просит пользователь. Верни только промпт на английском.`,
  },
  {
    key: '/correct_image_my',
    section: 'diagnostics',
    classifier: IMAGE_CLASSIFIER,
    response: `Подготовь точный промпт для редактирования фото пользователя.
Сохрани ключевые элементы исходника (график, текст, пропорции).
Измени только то, что просит пользователь. Верни только промпт на английском.`,
  },
];

async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
      ...options.headers,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body)}`);
  return body;
}

async function patchStartClassifier() {
  const data = await api(`/context?botId=${BOT_ID}`);
  const start = data.contexts?.['/start'];
  if (!start) {
    console.warn('No /start for bot', BOT_ID);
    return;
  }
  let classifier = start.classifier || '';
  const marker = 'Правила картинок (сверху важнее)';
  if (!classifier.includes(marker)) {
    classifier = `${classifier.trim()}\n\n${IMAGE_CLASSIFIER}\nВопрос об изображении без правки — /ocr.\nЕсли клиент попросил нарисовать новую картинку с нуля — /create_image.\nЕсли поправить только что выданную ботом картинку — /correct_image_your.\nЕсли загрузил фото и что изменить — /correct_image_my.`;
  }
  await api('/context', {
    method: 'POST',
    body: JSON.stringify({
      botId: Number(BOT_ID),
      key: '/start',
      classifier,
      response: start.response,
      section: start.section || 'diagnostics',
    }),
  });
  console.log('OK /start classifier extended');
}

async function main() {
  for (const u of UPDATES) {
    await api('/context', {
      method: 'POST',
      body: JSON.stringify({
        botId: Number(BOT_ID),
        key: u.key,
        classifier: u.classifier,
        response: u.response,
        section: u.section,
      }),
    });
    console.log('OK', u.key);
  }
  await patchStartClassifier();
  console.log('\nDone. Bot', BOT_ID, 'image commands configured.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
