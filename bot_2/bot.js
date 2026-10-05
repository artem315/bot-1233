// Главный файл бота-строителя для Minecraft Java.
// Запуск: node bot.js

const path = require('path')
const mineflayer = require('mineflayer')
const nbt = require('prismarine-nbt')
const { pathfinder, Movements } = require('mineflayer-pathfinder')

const log = require('./src/logger')
const { createChat } = require('./src/chat')
const { createInventory } = require('./src/inventory')
const { createCommands } = require('./src/commands')
const { Builder } = require('./src/builder')
const { listStructures } = require('./src/structure')

const config = require(path.join(__dirname, 'config.json'))

// Причина кика приходит строкой JSON или NBT-объектом — достаём из неё текст
function reasonToText (reason) {
  try {
    let data = typeof reason === 'string' ? JSON.parse(reason) : reason
    if (data && data.type && data.value !== undefined) data = nbt.simplify(data)
    if (typeof data === 'string') return data
    const parts = []
    const walk = (node) => {
      if (!node) return
      if (typeof node === 'string') { parts.push(node); return }
      if (node.text) parts.push(node.text)
      if (node.translate) parts.push(node.translate)
      if (Array.isArray(node.extra)) node.extra.forEach(walk)
      if (Array.isArray(node)) node.forEach(walk)
    }
    walk(data)
    return parts.join('') || JSON.stringify(data)
  } catch (_) {
    return String(reason)
  }
}

log.info(`Подключаюсь к ${config.host}:${config.port} как ${config.username}...`)

// Версия игры не указана — mineflayer определит её автоматически
const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth || 'offline'
})

bot.loadPlugin(pathfinder)

const chat = createChat(bot)
let commands = null

bot.once('spawn', () => {
  log.info(`Бот зашёл на сервер (версия ${bot.version}), позиция: ${bot.entity.position.floored()}`)

  // Настройка pathfinder: ничего не ломать и не строить «лесенки» из наших блоков
  const movements = new Movements(bot)
  movements.canDig = false
  movements.allow1by1towers = false
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)

  const inventory = createInventory(bot)
  const builder = new Builder(bot, chat, inventory)
  commands = createCommands(bot, chat, builder)

  const files = listStructures()
  log.info(`Найдено файлов структур: ${files.length}${files.length ? ' (' + files.join(', ') + ')' : ''}`)

  chat.say('Привет!')
})

// Сообщения игроков: логируем и разбираем команды
bot.on('chat', (username, message) => {
  if (username === bot.username) return // свои сообщения игнорируем
  log.chat(`<${username}> ${message}`)
  if (!commands) return
  commands.handle(username, message).catch(err => {
    log.error('Ошибка при выполнении команды:', err)
    chat.say(`Ошибка: ${err.message}`)
  })
})

// Системные сообщения сервера (не от игроков) тоже пишем в консоль
bot.on('messagestr', (message, position) => {
  if (position === 'chat' || position === 'game_info') return
  log.chat(`[сервер] ${message}`)
})

bot.on('kicked', (reason) => {
  log.warn('Бота кикнули с сервера:', reasonToText(reason))
})

bot.on('error', (err) => {
  log.error('Ошибка соединения:', err.message || err)
})

bot.on('end', (reason) => {
  log.info(`Соединение закрыто${reason ? ': ' + reason : ''}`)
})
