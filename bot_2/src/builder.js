// Строитель: ставит блоки структуры руками (bot.placeBlock), слоями снизу вверх.
// В креативе перемещается полётом (bot.creative.flyTo),
// в выживании — через mineflayer-pathfinder.

const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const log = require('./logger')
const {
  DIRS, skipReason, itemNameForBlock, isInteractable, placementPlan, stateMismatch
} = require('./blockInfo')

// На каком расстоянии (от глаз до центра блока) бот ещё дотягивается
const REACH = 4.2
// Сколько ждать pathfinder, прежде чем сдаться (мс)
const PATH_TIMEOUT = 20000

class StopError extends Error {}

class Builder {
  constructor (bot, chat, inventory) {
    this.bot = bot
    this.chat = chat
    this.inventory = inventory
    this.building = false
    this.stopRequested = false
  }

  // Просьба остановить стройку (сработает перед следующим блоком)
  stop () {
    if (!this.building) return false
    this.stopRequested = true
    try { this.bot.pathfinder.stop() } catch (_) {}
    return true
  }

  // Ждёт, пока текущая стройка действительно закончится
  async waitUntilStopped () {
    while (this.building) await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Готовит список блоков для постройки: мировые координаты, предмет, план установки
  prepare (structure, origin) {
    const entries = []
    const skipped = [] // { name, reason }
    for (const b of structure.blocks) {
      const skip = skipReason(b.name, b.properties)
      if (skip) {
        if (!skip.auto) skipped.push({ name: b.name, reason: skip.reason })
        continue
      }
      if (!this.bot.registry.blocksByName[b.name]) {
        skipped.push({ name: b.name, reason: 'такого блока нет в версии сервера' })
        continue
      }
      const itemName = itemNameForBlock(this.bot.registry, b.name)
      if (!itemName) {
        skipped.push({ name: b.name, reason: 'для блока нет предмета' })
        continue
      }
      entries.push({
        pos: origin.offset(b.x, b.y, b.z),
        name: b.name,
        properties: b.properties,
        itemName,
        plan: placementPlan(b.name, b.properties)
      })
    }
    return { entries, skipped }
  }

  // Подсчёт нужных предметов: { имя_предмета: количество }
  static countNeeds (entries) {
    const needs = {}
    for (const e of entries) {
      needs[e.itemName] = (needs[e.itemName] || 0) + (e.plan.double ? 2 : 1)
    }
    return needs
  }

  static formatCounts (counts) {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} x${n}`)
      .join(', ')
  }

  // Главный метод: строит структуру от точки origin в режиме mode ('creative' / 'survival')
  async build (structure, origin, mode) {
    if (this.building) throw new Error('стройка уже идёт')
    this.building = true
    this.stopRequested = false
    const creative = mode === 'creative'
    const bot = this.bot

    const stats = { placed: 0, already: 0, skipped: 0 }

    try {
      const { entries, skipped } = this.prepare(structure, origin)
      stats.skipped += skipped.length
      for (const s of skipped) log.build(`Пропуск ${s.name}: ${s.reason}`)

      const needs = Builder.countNeeds(entries)
      log.build(`Структура ${structure.file}: размер ${structure.size.x}x${structure.size.y}x${structure.size.z}, блоков к установке: ${entries.length}`)
      log.build(`Начало постройки: ${origin}`)

      if (creative) {
        this.chat.say(`Беру блоки из креативного инвентаря (${Object.keys(needs).length} видов)...`)
        const given = await this.inventory.giveCreativeItems(Object.keys(needs))
        log.build(`Взято из креативного инвентаря видов блоков: ${given}`)
        bot.creative.startFlying()
      } else {
        // Выживание: сообщаем, что нужно и чего не хватает
        this.chat.say(`Нужно блоков: ${Builder.formatCounts(needs)}`)
        const have = this.inventory.countItems()
        const missing = {}
        for (const [name, n] of Object.entries(needs)) {
          const lack = n - (have[name] || 0)
          if (lack > 0) missing[name] = lack
        }
        if (Object.keys(missing).length > 0) {
          this.chat.say(`Не хватает: ${Builder.formatCounts(missing)}. Построю из того, что есть.`)
        } else {
          this.chat.say('Всех блоков хватает!')
        }
      }

      this.chat.say(`Начинаю строить ${structure.file} (${entries.length} блоков)`)

      // Группируем по слоям (y) и идём снизу вверх
      const layers = new Map()
      for (const e of entries) {
        if (!layers.has(e.pos.y)) layers.set(e.pos.y, [])
        layers.get(e.pos.y).push(e)
      }
      const ys = [...layers.keys()].sort((a, b) => a - b)

      for (const y of ys) {
        // Внутри слоя — «змейкой», чтобы меньше летать/ходить
        let pending = layers.get(y).sort((a, b) => {
          if (a.pos.z !== b.pos.z) return a.pos.z - b.pos.z
          return (a.pos.z % 2 === 0) ? a.pos.x - b.pos.x : b.pos.x - a.pos.x
        })
        log.build(`Слой y=${y}: ${pending.length} блоков`)

        // Блоки без опоры откладываем и пробуем снова, пока есть прогресс
        while (pending.length > 0) {
          const retry = []
          let progress = false
          for (const entry of pending) {
            const result = await this.placeEntry(entry, creative)
            if (result === 'placed') { stats.placed++; progress = true } else if (result === 'already') { stats.already++; progress = true } else if (result === 'retry') retry.push(entry)
            else stats.skipped++
          }
          // Блоки, отказанные сервером впервые, получают ещё один шанс
          const secondChance = retry.filter(e => e.attempts === 1 && !e.secondChance)
          for (const e of secondChance) e.secondChance = true
          if (!progress && secondChance.length === 0) {
            for (const e of retry) log.build(`Пропуск ${e.name} в ${e.pos}: не к чему прикрепить блок`)
            stats.skipped += retry.length
            break
          }
          pending = retry
        }
      }

      const extra = stats.already > 0 ? `, уже стояло: ${stats.already}` : ''
      this.chat.say(`Готово! Поставлено блоков: ${stats.placed}, пропущено: ${stats.skipped}${extra}`)
      log.build(`Стройка завершена. Поставлено: ${stats.placed}, пропущено: ${stats.skipped}, уже стояло: ${stats.already}`)
    } catch (err) {
      if (err instanceof StopError) {
        this.chat.say(`Стройка остановлена. Поставлено блоков: ${stats.placed}, пропущено: ${stats.skipped}`)
        log.build('Стройка остановлена по команде')
      } else {
        this.chat.say(`Стройка прервана из-за ошибки: ${err.message}`)
        log.error('Стройка прервана:', err)
      }
    } finally {
      this.building = false
      this.stopRequested = false
      bot.setControlState('sneak', false)
      // В креативе перестаём «висеть» в воздухе — бот плавно опустится на землю
      if (creative) bot.creative.stopFlying()
      try { bot.pathfinder.setGoal(null) } catch (_) {}
    }
    return stats
  }

  checkStop () {
    if (this.stopRequested) throw new StopError('остановлено')
  }

  // Ставит один блок. Возвращает 'placed', 'already', 'retry' (нет опоры) или 'skip'.
  // Любая ошибка ловится здесь, чтобы не ломать всю стройку.
  async placeEntry (entry, creative) {
    this.checkStop()
    const bot = this.bot
    const { pos, name, itemName, plan } = entry

    try {
      // Уже стоит нужный блок?
      let current = bot.blockAt(pos)
      if (current && current.name === name && !this.needsSecondSlab(entry, current)) return 'already'

      // В выживании ставим только то, что есть в инвентаре
      if (!creative && !bot.inventory.items().some(i => i.name === itemName)) {
        log.build(`Пропуск ${name} в ${pos}: нет ${itemName} в инвентаре`)
        return 'skip'
      }

      // Подходим/подлетаем поближе
      await this.moveNear(pos, creative)
      this.checkStop()

      current = bot.blockAt(pos)
      if (!current) {
        log.build(`Пропуск ${name} в ${pos}: чанк не загружен`)
        return 'skip'
      }

      // Половинку двойной плиты уже поставили раньше — добавим вторую
      if (current.name === name && this.needsSecondSlab(entry, current)) {
        return await this.placeSecondSlab(entry, creative)
      }

      // На месте стоит что-то другое — ломаем (кроме воздуха и жидкостей)
      if (!isEmpty(current)) {
        log.build(`На месте ${pos} стоит ${current.name}, ломаю`)
        try {
          await bot.dig(current, true)
        } catch (err) {
          log.warn(`Не удалось сломать ${current.name} в ${pos}: ${err.message}`)
          return 'skip'
        }
      }

      // Ищем опору по плану: сначала «правильные» варианты, потом любые
      let chosen = null
      let chosenIndex = -1
      for (let i = 0; i < plan.options.length; i++) {
        const opt = plan.options[i]
        const refBlock = bot.blockAt(pos.plus(DIRS[opt.ref]))
        if (isSolid(refBlock)) {
          chosen = { opt, refBlock }
          chosenIndex = i
          break
        }
      }
      if (!chosen) return 'retry'

      if (!(await this.inventory.ensureInHand(itemName, creative))) {
        log.build(`Пропуск ${name} в ${pos}: не удалось взять ${itemName} в руку`)
        return 'skip'
      }

      if (plan.preferred > 0 && chosenIndex >= plan.preferred) {
        log.build(`${name} в ${pos}: нет нужной опоры, ставлю как получится (состояние может отличаться)`)
      }

      await this.clickPlace(chosen.refBlock, chosen.opt, pos)

      // Двойная плита — ставим вторую половину
      if (plan.double) {
        const slab = bot.blockAt(pos)
        if (slab && slab.name === name && this.needsSecondSlab(entry, slab)) {
          await this.placeSecondSlab(entry, creative)
        }
      }

      return this.verify(entry)
    } catch (err) {
      if (err instanceof StopError) throw err
      // Сервер мог не ответить, но блок всё же поставить — проверяем
      const now = bot.blockAt(pos)
      if (now && now.name === name) {
        log.warn(`${name} в ${pos}: ${err.message}, но блок стоит`)
        return 'placed'
      }
      // Первая неудача — попробуем ещё раз в конце слоя (например, там стоял моб и ушёл)
      entry.attempts = (entry.attempts || 0) + 1
      if (entry.attempts < 2) {
        log.build(`${name} в ${pos}: не получилось (${err.message}), попробую позже`)
        return 'retry'
      }
      log.warn(`Не удалось поставить ${name} в ${pos}: ${err.message}`)
      return 'skip'
    }
  }

  // Клик по грани опоры с нужным поворотом и половиной грани
  async clickPlace (refBlock, opt, pos) {
    const bot = this.bot
    const faceVector = pos.minus(refBlock.position) // от опоры к цели
    const sneak = isInteractable(refBlock.name)

    if (sneak) {
      // Приседаем, чтобы не открыть сундук/дверь вместо установки блока
      bot.setControlState('sneak', true)
      await bot.waitForTicks(1)
    }
    try {
      if (opt.look) {
        // Поворачиваемся так, чтобы блок встал нужной стороной
        const yaw = opt.look.yaw !== null ? opt.look.yaw : bot.entity.yaw
        await bot.look(yaw, opt.look.pitch, true)
        await bot.waitForTicks(1)
        await bot._placeBlockWithOptions(refBlock, faceVector, { half: opt.half, forceLook: 'ignore', swingArm: 'right' })
      } else if (opt.half) {
        await bot._placeBlockWithOptions(refBlock, faceVector, { half: opt.half, swingArm: 'right' })
      } else {
        await bot.placeBlock(refBlock, faceVector)
      }
    } finally {
      if (sneak) bot.setControlState('sneak', false)
    }
  }

  needsSecondSlab (entry, block) {
    if (!entry.plan.double) return false
    const props = block.getProperties ? block.getProperties() : {}
    return props.type !== 'double'
  }

  // Вторая половина двойной плиты: клик по самой плите
  async placeSecondSlab (entry, creative) {
    const bot = this.bot
    if (!(await this.inventory.ensureInHand(entry.itemName, creative))) return 'skip'
    const slab = bot.blockAt(entry.pos)
    const props = slab.getProperties()
    const face = props.type === 'top' ? new Vec3(0, -1, 0) : new Vec3(0, 1, 0)
    await bot._genericPlace(slab, face, { swingArm: 'right' })
    await bot.waitForTicks(4)
    return this.verify(entry)
  }

  // Проверка результата: тот ли блок и то ли состояние
  verify (entry) {
    const block = this.bot.blockAt(entry.pos)
    if (!block || block.name !== entry.name) {
      log.warn(`В ${entry.pos} ожидался ${entry.name}, а стоит ${block ? block.name : 'неизвестно'}`)
      return block && block.name !== 'air' ? 'placed' : 'skip'
    }
    const diffs = stateMismatch(entry.properties, block.getProperties ? block.getProperties() : {})
    if (diffs.length > 0) {
      log.build(`${entry.name} в ${entry.pos} поставлен не совсем правильно (${diffs.join('; ')})`)
    }
    return 'placed'
  }

  // Полёт в креативе. bot.creative.flyTo летит по прямой и не обходит препятствия,
  // поэтому летим отрезками: вверх -> по горизонтали -> вниз. Так бот не задевает
  // уже поставленные блоки (они всегда ниже точки зависания).
  async flyTo (dest) {
    const bot = this.bot
    const start = bot.entity.position.clone()
    const height = Math.max(start.y, dest.y)
    const points = [
      new Vec3(start.x, height, start.z),
      new Vec3(dest.x, height, dest.z),
      dest.clone()
    ]
    for (const point of points) {
      if (point.distanceTo(bot.entity.position) < 0.01) continue
      await this.flySegment(point)
    }
  }

  // Один прямой отрезок полёта с защитой от зависания: если сервер
  // откатывает бота (врезался в блок), flyTo крутился бы бесконечно.
  async flySegment (point) {
    const bot = this.bot
    const timeoutMs = 3000 + point.distanceTo(bot.entity.position) * 200
    const timer = setTimeout(() => {
      // flyTo сравнивает позицию с этим же объектом — подменяем цель на текущую позицию,
      // и цикл внутри flyTo завершается
      log.warn(`Полёт к ${point.floored()} не удался (мешает блок?), остаюсь на месте`)
      point.set(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z)
    }, timeoutMs)
    try {
      await bot.creative.flyTo(point)
    } finally {
      clearTimeout(timer)
    }
  }

  // Перемещение к блоку: полёт в креативе, pathfinder в выживании
  async moveNear (pos, creative) {
    const bot = this.bot
    const center = pos.offset(0.5, 0.5, 0.5)
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0)
    const inside = isStandingIn(bot, pos)
    if (eye.distanceTo(center) <= REACH && !inside) return

    if (creative) {
      // Зависаем на 2 блока выше цели: так бот не мешает ставить блоки текущего слоя
      await this.flyTo(pos.offset(0.5, 2, 0.5))
      return
    }

    const goal = new goals.GoalPlaceBlock(pos, bot.world, { range: REACH, LOS: false })
    let timer
    try {
      await Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('не нашёл путь вовремя')), PATH_TIMEOUT)
        })
      ])
    } catch (err) {
      this.checkStop()
      bot.pathfinder.stop()
      log.build(`Не дошёл до ${pos}: ${err.message}`)
    } finally {
      clearTimeout(timer)
    }
  }
}

// Пустое место: воздух или жидкость (туда можно ставить без разрушения)
function isEmpty (block) {
  return ['air', 'cave_air', 'void_air', 'water', 'lava'].includes(block.name)
}

// Можно ли кликнуть по блоку как по опоре
function isSolid (block) {
  return !!block && block.boundingBox === 'block' && !['water', 'lava'].includes(block.name)
}

// Стоит ли бот (ноги или голова) в клетке pos
function isStandingIn (bot, pos) {
  const p = bot.entity.position
  const w = 0.3 // половина ширины хитбокса игрока
  const inX = p.x + w > pos.x && p.x - w < pos.x + 1
  const inZ = p.z + w > pos.z && p.z - w < pos.z + 1
  const inY = p.y < pos.y + 1 && p.y + 1.8 > pos.y
  return inX && inY && inZ
}

module.exports = { Builder }
