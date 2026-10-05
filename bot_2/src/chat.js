// Отправка сообщений в чат через очередь.
// Сервер кикает за спам, поэтому сообщения уходят с паузой,
// а длинный текст режется на части (лимит чата — 256 символов).

const MAX_LEN = 250
const DELAY_MS = 700

function createChat (bot) {
  const queue = []
  let busy = false

  async function pump () {
    if (busy) return
    busy = true
    while (queue.length > 0) {
      const text = queue.shift()
      try {
        bot.chat(text)
      } catch (err) {
        console.error('Не удалось отправить сообщение в чат:', err.message)
      }
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
    busy = false
  }

  // Делит длинный текст на куски не длиннее MAX_LEN, стараясь резать по ", " и пробелам
  function split (text) {
    const parts = []
    let rest = String(text)
    while (rest.length > MAX_LEN) {
      let cut = rest.lastIndexOf(', ', MAX_LEN)
      if (cut <= 0) cut = rest.lastIndexOf(' ', MAX_LEN)
      if (cut <= 0) cut = MAX_LEN
      parts.push(rest.slice(0, cut + (rest[cut] === ',' ? 1 : 0)).trim())
      rest = rest.slice(cut + 1).trim()
    }
    if (rest.length > 0) parts.push(rest)
    return parts
  }

  // Обычное сообщение (может быть разбито на несколько)
  function say (text) {
    queue.push(...split(text))
    pump()
  }

  // Команда сервера (например, /gamemode) — отправляется сразу, без очереди
  function command (cmd) {
    bot.chat(cmd)
  }

  return { say, command }
}

module.exports = { createChat }
