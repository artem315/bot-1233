// Обработка команд из чата:
//   !режим <creative|survival|adventure|spectator>
//   !структуры
//   !структура <имя>
//   !стоп

const log = require('./logger')
const { listStructures, findStructure, loadStructure } = require('./structure')

const MODES = ['creative', 'survival', 'adventure', 'spectator']
const MODE_NAMES = {
  creative: 'творческий',
  survival: 'выживание',
  adventure: 'приключение',
  spectator: 'наблюдатель'
}
// Сколько ждать подтверждения смены режима от сервера (мс)
const GAMEMODE_TIMEOUT = 5000

function createCommands (bot, chat, builder) {
  // Выбранный файл структуры (имя файла в папке bot_structures)
  let selected = null

  // Если файл в папке один — он выбран по умолчанию
  function currentStructure () {
    if (selected && findStructure(selected)) return selected
    const files = listStructures()
    if (files.length === 1) return files[0]
    return null
  }

  // Ждёт, пока сервер сменит режим бота
  function waitForGameMode (mode) {
    return new Promise(resolve => {
      if (bot.game.gameMode === mode) return resolve(true)
      const onGame = () => {
        if (bot.game.gameMode === mode) finish(true)
      }
      const timer = setTimeout(() => finish(false), GAMEMODE_TIMEOUT)
      function finish (ok) {
        clearTimeout(timer)
        bot.removeListener('game', onGame)
        resolve(ok)
      }
      bot.on('game', onGame)
    })
  }

  // !режим <mode>
  async function cmdMode (args) {
    const mode = (args[0] || '').toLowerCase()
    if (!MODES.includes(mode)) {
      chat.say('Использование: !режим <creative|survival|adventure|spectator>')
      return
    }

    // Начало структуры — позиция бота в момент команды, сдвинутая на 1 блок по X и Z,
    // чтобы бот не оказался внутри постройки
    const origin = bot.entity.position.floored().offset(1, 0, 1)

    // Если сейчас идёт стройка — сначала останавливаем её
    if (builder.building) {
      builder.stop()
      await builder.waitUntilStopped()
    }

    if (bot.game.gameMode !== mode) {
      chat.command(`/gamemode ${mode}`)
      const ok = await waitForGameMode(mode)
      if (!ok) {
        chat.say(`Не получилось сменить режим на ${mode}. Проверьте, что у меня есть права оператора (/op ${bot.username}).`)
        log.warn(`Режим не сменился на ${mode}`)
        return
      }
    }
    chat.say(`Режим: ${MODE_NAMES[mode]} (${mode})`)
    log.info(`Режим игры: ${mode}`)

    if (mode === 'adventure' || mode === 'spectator') {
      chat.say(`В режиме ${mode} строить нельзя.`)
      return
    }

    // creative или survival — строим выбранную структуру
    const file = currentStructure()
    if (!file) {
      const count = listStructures().length
      if (count === 0) chat.say('В папке bot_structures нет .nbt файлов — строить нечего.')
      else chat.say('Сначала выберите структуру: !структура <имя> (список: !структуры)')
      return
    }

    let structure
    try {
      structure = await loadStructure(file)
    } catch (err) {
      chat.say(`Не удалось прочитать ${file}: ${err.message}`)
      log.error(`Ошибка чтения ${file}:`, err)
      return
    }

    // Не ждём окончания стройки, чтобы бот продолжал слушать команды (например, !стоп)
    builder.build(structure, origin, mode).catch(err => log.error('Ошибка стройки:', err))
  }

  // !структуры
  function cmdList () {
    const files = listStructures()
    if (files.length === 0) {
      chat.say('В папке bot_structures нет .nbt файлов.')
      return
    }
    const current = currentStructure()
    const list = files.map(f => (f === current ? `${f} (выбрана)` : f)).join(', ')
    chat.say(`Структуры (${files.length}): ${list}`)
  }

  // !структура <имя>
  async function cmdSelect (args) {
    const name = args.join(' ').trim()
    if (!name) {
      const current = currentStructure()
      chat.say(current ? `Выбрана структура: ${current}` : 'Структура не выбрана. Использование: !структура <имя>')
      return
    }
    const file = findStructure(name)
    if (!file) {
      chat.say(`Файл "${name}" не найден. Список: !структуры`)
      return
    }
    try {
      const structure = await loadStructure(file)
      selected = file
      const s = structure.size
      chat.say(`Выбрана структура ${file}: ${s.x}x${s.y}x${s.z}, блоков: ${structure.blocks.length}`)
      log.info(`Выбрана структура ${file}`)
    } catch (err) {
      chat.say(`Не удалось прочитать ${file}: ${err.message}`)
      log.error(`Ошибка чтения ${file}:`, err)
    }
  }

  // !стоп
  function cmdStop () {
    if (builder.stop()) chat.say('Останавливаю стройку...')
    else chat.say('Сейчас ничего не строю.')
  }

  // Разбор сообщения чата. Возвращает true, если это была команда.
  async function handle (username, message) {
    const text = message.trim()
    if (!text.startsWith('!')) return false
    const [cmd, ...args] = text.slice(1).split(/\s+/)
    log.info(`Команда от ${username}: ${text}`)

    switch (cmd.toLowerCase()) {
      case 'режим': await cmdMode(args); break
      case 'структуры': cmdList(); break
      case 'структура': await cmdSelect(args); break
      case 'стоп': cmdStop(); break
      default: return false
    }
    return true
  }

  return { handle }
}

module.exports = { createCommands }
