#!/usr/bin/env node
// Замер скорости скачивания: 10 последовательных запросов к одному адресу.
// Требуется Node.js 18+ (встроенный fetch). Сторонние библиотеки не нужны.

const REQUESTS_COUNT = 10;     // сколько раз обращаемся к адресу
const TIMEOUT_MS = 30_000;     // таймаут на один запрос
const DEFAULT_URL = "https://speed.cloudflare.com/__down?bytes=10000000"; // тестовый файл ~10 МБ

/** Берёт адрес из аргумента командной строки и проверяет, что он корректный. */
function getUrlFromArgs() {
  const rawUrl = process.argv[2] || DEFAULT_URL;
  try {
    return new URL(rawUrl).toString();
  } catch {
    console.error(`Ошибка: некорректный адрес "${rawUrl}"`);
    process.exit(1);
  }
}

/** Скачивает адрес целиком один раз. Возвращает { bytes, seconds }. */
async function downloadOnce(url) {
  const startTime = performance.now(); // монотонный таймер, не зависит от системных часов

  const response = await fetch(url, {
    headers: {
      "Accept-Encoding": "identity", // без сжатия: считаем реальный объём данных
      "Cache-Control": "no-cache",   // просим не отдавать ответ из кэша
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // fetch не бросает ошибку на 404/500, поэтому статус проверяем сами
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // Ждём полного скачивания тела ответа, и только потом останавливаем таймер
  const body = await response.arrayBuffer();
  const seconds = (performance.now() - startTime) / 1000;

  return { bytes: body.byteLength, seconds };
}

/** Делает count запросов подряд и собирает суммарную статистику. */
async function runBenchmark(url, count) {
  const stats = { successCount: 0, totalBytes: 0, totalSeconds: 0 };

  for (let number = 1; number <= count; number++) {
    const label = `Запрос ${String(number).padStart(2)}`;
    try {
      // await внутри цикла: следующий запрос начнётся только после завершения этого
      const { bytes, seconds } = await downloadOnce(url);
      stats.successCount++;
      stats.totalBytes += bytes;
      stats.totalSeconds += seconds;
      console.log(`${label}: ${seconds.toFixed(3)} с, ${toMegabytes(bytes).toFixed(2)} МБ`);
    } catch (error) {
      console.log(`${label}: ошибка — ${describeError(error)}`);
    }
  }

  return stats;
}

/** Печатает итоговый отчёт. */
function printReport(stats, count) {
  const averageSeconds = stats.totalSeconds / stats.successCount;
  const speedMbps = toMegabits(stats.totalBytes) / stats.totalSeconds;
  const speedMBps = toMegabytes(stats.totalBytes) / stats.totalSeconds;

  console.log("\n--- Итоги ---");
  console.log(`Успешных запросов:     ${stats.successCount} из ${count}`);
  console.log(`Среднее время запроса: ${averageSeconds.toFixed(3)} с`);
  console.log(`Скачано всего:         ${toMegabytes(stats.totalBytes).toFixed(2)} МБ`);
  console.log(`Скорость скачивания:   ${speedMbps.toFixed(2)} Мбит/с (${speedMBps.toFixed(2)} МБ/с)`);
}

// --- Вспомогательные функции (единицы: 1 МБ = 1 000 000 байт, 1 байт = 8 бит) ---

function toMegabytes(bytes) {
  return bytes / 1_000_000;
}

function toMegabits(bytes) {
  return (bytes * 8) / 1_000_000;
}

/** Превращает ошибку fetch в короткое понятное сообщение. */
function describeError(error) {
  if (error.name === "TimeoutError") return "превышено время ожидания";
  const cause = error.cause;
  return cause?.code ?? cause?.errors?.[0]?.code ?? cause?.message ?? error.message;
}

async function main() {
  const url = getUrlFromArgs();

  console.log(`Адрес: ${url}`);
  console.log(`Запросов: ${REQUESTS_COUNT}\n`);

  const stats = await runBenchmark(url, REQUESTS_COUNT);

  if (stats.successCount === 0) {
    console.log("\nНи один запрос не завершился успешно, посчитать скорость нельзя.");
    process.exit(1);
  }

  printReport(stats, REQUESTS_COUNT);
}

main();
