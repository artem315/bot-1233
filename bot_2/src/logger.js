// Простой логгер в консоль с отметкой времени.
// Все сообщения пишутся на русском языке.

function time () {
  return new Date().toLocaleTimeString('ru-RU', { hour12: false })
}

function info (...args) {
  console.log(`[${time()}] [ИНФО]`, ...args)
}

function warn (...args) {
  console.warn(`[${time()}] [ВНИМАНИЕ]`, ...args)
}

function error (...args) {
  console.error(`[${time()}] [ОШИБКА]`, ...args)
}

function chat (...args) {
  console.log(`[${time()}] [ЧАТ]`, ...args)
}

function build (...args) {
  console.log(`[${time()}] [СТРОЙКА]`, ...args)
}

module.exports = { info, warn, error, chat, build }
