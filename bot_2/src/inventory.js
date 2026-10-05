// Работа с инвентарём: подсчёт нужных блоков, выдача блоков в креативе,
// взятие нужного блока в руку.

// Слоты инвентаря игрока (номера окна инвентаря):
// 9..35 — основной инвентарь, 36..44 — хотбар
const MAIN_START = 9
const HOTBAR_START = 36
const HOTBAR_END = 44

function createInventory (bot) {
  const Item = require('prismarine-item')(bot.registry)
  let nextHotbar = 0 // какой слот хотбара перезаписывать следующим в креативе

  // Сколько предметов каждого вида есть у бота: { имя: количество }
  function countItems () {
    const counts = {}
    for (const item of bot.inventory.items()) {
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    return counts
  }

  // Креатив: кладёт в пустые слоты инвентаря по стаку каждого нужного предмета.
  // Если видов больше, чем свободных слотов, остальные возьмём при стройке.
  async function giveCreativeItems (itemNames) {
    let given = 0
    const have = new Set(bot.inventory.items().map(i => i.name))
    const freeSlots = []
    for (let slot = HOTBAR_START; slot <= HOTBAR_END; slot++) {
      if (!bot.inventory.slots[slot]) freeSlots.push(slot)
    }
    for (let slot = MAIN_START; slot < HOTBAR_START; slot++) {
      if (!bot.inventory.slots[slot]) freeSlots.push(slot)
    }
    for (const name of itemNames) {
      if (have.has(name)) continue
      const slot = freeSlots.shift()
      if (slot === undefined) break
      const def = bot.registry.itemsByName[name]
      if (!def) continue
      try {
        await bot.creative.setInventorySlot(slot, new Item(def.id, Math.min(64, def.stackSize || 64)))
        given++
      } catch (err) {
        console.warn(`Не удалось взять ${name} из креативного инвентаря: ${err.message}`)
      }
    }
    return given
  }

  // Берёт предмет в руку. В креативе при нехватке — достаёт из креативного инвентаря.
  // Возвращает true, если предмет в руке.
  async function ensureInHand (itemName, creative) {
    if (bot.heldItem && bot.heldItem.name === itemName) return true

    // 1) Предмет уже есть в хотбаре — просто выбираем этот слот
    for (let slot = HOTBAR_START; slot <= HOTBAR_END; slot++) {
      const item = bot.inventory.slots[slot]
      if (item && item.name === itemName) {
        bot.setQuickBarSlot(slot - HOTBAR_START)
        await bot.waitForTicks(1)
        return true
      }
    }

    if (creative) {
      // 2) Креатив: кладём предмет прямо в слот хотбара и выбираем его
      const def = bot.registry.itemsByName[itemName]
      if (!def) return false
      const index = nextHotbar
      nextHotbar = (nextHotbar + 1) % 9
      await bot.creative.setInventorySlot(HOTBAR_START + index, new Item(def.id, Math.min(64, def.stackSize || 64)))
      bot.setQuickBarSlot(index)
      await bot.waitForTicks(1)
      return !!(bot.heldItem && bot.heldItem.name === itemName)
    }

    // 3) Выживание: ищем в инвентаре и экипируем
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) return false
    await bot.equip(item, 'hand')
    return !!(bot.heldItem && bot.heldItem.name === itemName)
  }

  return { countItems, giveCreativeItems, ensureInHand }
}

module.exports = { createInventory }
