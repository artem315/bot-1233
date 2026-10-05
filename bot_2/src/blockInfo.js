// Знания о блоках: какой предмет нужен для блока, какие блоки нельзя
// поставить руками, и как правильно ставить блок с учётом его состояния
// (facing, half, axis, type).

const { Vec3 } = require('vec3')

// ---------- Направления ----------

const DIRS = {
  down: new Vec3(0, -1, 0),
  up: new Vec3(0, 1, 0),
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  west: new Vec3(-1, 0, 0),
  east: new Vec3(1, 0, 0)
}
const ALL_DIRS = ['down', 'north', 'south', 'west', 'east', 'up']
const HORIZONTAL = ['north', 'south', 'west', 'east']

const OPPOSITE = {
  down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west'
}
// Поворот против часовой стрелки (нужен для наковальни)
const COUNTER_CLOCKWISE = { north: 'west', west: 'south', south: 'east', east: 'north' }

// Углы обзора в mineflayer: yaw 0 — смотрим на север (-Z), растёт против часовой.
// pitch > 0 — смотрим вверх, < 0 — вниз.
const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 }

// ---------- Блоки, которые не ставим ----------

// Жидкости, порталы и технические блоки — руками их не поставить
const UNPLACEABLE = new Set([
  'water', 'lava', 'fire', 'soul_fire', 'nether_portal', 'end_portal', 'end_gateway',
  'piston_head', 'moving_piston', 'bubble_column', 'frosted_ice'
])

// Возвращает причину, если блок не нужно ставить отдельно, иначе null.
// auto = true — блок появится сам (верхняя половина двери, изголовье кровати),
// его не считаем ни поставленным, ни пропущенным.
function skipReason (name, props) {
  if (UNPLACEABLE.has(name)) return { auto: false, reason: 'такой блок нельзя поставить руками' }
  if (props.half === 'upper') return { auto: true, reason: 'верхняя половина появится сама' }
  if (/_bed$/.test(name) && props.part === 'head') return { auto: true, reason: 'изголовье кровати появится само' }
  return null
}

// ---------- Блок -> предмет ----------

// Блоки, у которых предмет называется иначе
const ITEM_ALIASES = {
  wall_torch: 'torch',
  soul_wall_torch: 'soul_torch',
  redstone_wall_torch: 'redstone_torch',
  redstone_wire: 'redstone',
  tripwire: 'string',
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  cocoa: 'cocoa_beans',
  pumpkin_stem: 'pumpkin_seeds',
  attached_pumpkin_stem: 'pumpkin_seeds',
  melon_stem: 'melon_seeds',
  attached_melon_stem: 'melon_seeds',
  sweet_berry_bush: 'sweet_berries',
  cave_vines: 'glow_berries',
  cave_vines_plant: 'glow_berries',
  kelp_plant: 'kelp',
  twisting_vines_plant: 'twisting_vines',
  weeping_vines_plant: 'weeping_vines',
  tall_seagrass: 'seagrass',
  bamboo_sapling: 'bamboo',
  big_dripleaf_stem: 'big_dripleaf',
  pitcher_crop: 'pitcher_pod',
  torchflower_crop: 'torchflower_seeds',
  skeleton_wall_skull: 'skeleton_skull',
  wither_skeleton_wall_skull: 'wither_skeleton_skull'
}

// Имя предмета для блока или null, если предмета нет в этой версии игры
function itemNameForBlock (registry, blockName) {
  const candidates = [blockName]
  if (ITEM_ALIASES[blockName]) candidates.unshift(ITEM_ALIASES[blockName])
  // oak_wall_sign -> oak_sign, creeper_wall_head -> creeper_head, tube_coral_wall_fan -> tube_coral_fan
  const wall = blockName.match(/^(.*)_wall_(torch|sign|hanging_sign|banner|head|skull|fan)$/)
  if (wall) candidates.push(`${wall[1]}_${wall[2]}`)
  for (const name of candidates) {
    if (registry.itemsByName[name]) return name
  }
  return null
}

// ---------- Как ставить блок с учётом состояния ----------

// Блоки, которые повёрнуты «по взгляду игрока» (а не к игроку лицом)
function facesLikeLook (name) {
  return /_stairs$|_door$|_fence_gate$|_bed$|^observer$/.test(name)
}

// Блоки, у которых facing = сторона, к которой их прикрепили
function isAttachedToFace (name) {
  return /wall_torch$|_wall_sign$|_wall_hanging_sign$|_wall_banner$|_wall_fan$|_wall_head$|_wall_skull$|^ladder$|^tripwire_hook$|^end_rod$|^lightning_rod$|amethyst_cluster$|_amethyst_bud$/.test(name)
}

// Блоки, по которым клик правой кнопкой открывает меню или что-то переключает.
// Если ставим блок на такой, нужно приседать.
function isInteractable (name) {
  return /chest$|barrel$|furnace$|smoker$|crafting_table$|_door$|_trapdoor$|_fence_gate$|_button$|^lever$|_bed$|anvil$|shulker_box$|^hopper$|^dispenser$|^dropper$|enchanting_table$|^beacon$|brewing_stand$|^repeater$|^comparator$|^note_block$|^jukebox$|^loom$|^stonecutter$|^grindstone$|cartography_table$|smithing_table$|^lectern$|^bell$|_sign$|command_block$|^crafter$|^cake$|^daylight_detector$|^respawn_anchor$|^composter$|^cauldron$|^decorated_pot$|^chiseled_bookshelf$/.test(name)
}

// Направление взгляда: по горизонтали (yaw) и/или по вертикали (pitch)
function lookFor (dir) {
  if (dir === 'up') return { yaw: null, pitch: Math.PI / 2 }
  if (dir === 'down') return { yaw: null, pitch: -Math.PI / 2 }
  return { yaw: YAW[dir], pitch: 0 }
}

// Строит план установки: список вариантов по приоритету.
// Каждый вариант: { ref, half, look }
//   ref  — в какой стороне от цели стоит блок-опора, по которому кликаем
//   half — в какую половину грани кликать ('top' / 'bottom' / null)
//   look — куда повернуть бота перед кликом (или null — пусть смотрит на грань)
// Возвращает также double = true для двойной плиты (её ставим дважды).
function placementPlan (name, props) {
  const options = []
  let look = null
  let double = false
  const facing = props.facing

  if (props.axis && ['x', 'y', 'z'].includes(props.axis)) {
    // Брёвна, колонны: ось задаётся гранью, по которой кликнули
    const axisRefs = { y: ['down', 'up'], x: ['west', 'east'], z: ['north', 'south'] }[props.axis]
    for (const ref of axisRefs) options.push({ ref, half: null })
  } else if (/_slab$/.test(name)) {
    // Плиты: верхняя — клик по низу блока сверху или по верхней половине боковой грани
    const top = props.type === 'top'
    double = props.type === 'double'
    if (top) {
      options.push({ ref: 'up', half: null })
      for (const ref of HORIZONTAL) options.push({ ref, half: 'top' })
    } else {
      options.push({ ref: 'down', half: null })
      for (const ref of HORIZONTAL) options.push({ ref, half: 'bottom' })
    }
  } else if (/_stairs$/.test(name)) {
    // Ступеньки: смотрят туда же, куда смотрит игрок; half — по точке клика
    if (HORIZONTAL.includes(facing)) look = lookFor(facing)
    const top = props.half === 'top'
    options.push({ ref: top ? 'up' : 'down', half: null })
    for (const ref of HORIZONTAL) options.push({ ref, half: top ? 'top' : 'bottom' })
  } else if (/_trapdoor$/.test(name) && HORIZONTAL.includes(facing)) {
    // Люки: при клике по боковой грани facing = эта грань, half — по точке клика.
    // При клике сверху/снизу facing = противоположно взгляду.
    const top = props.half === 'top'
    options.push({ ref: OPPOSITE[facing], half: top ? 'top' : 'bottom' })
    options.push({ ref: top ? 'up' : 'down', half: null, look: lookFor(OPPOSITE[facing]) })
  } else if (props.face && facing) {
    // Кнопки, рычаги, точило: прикреплены к полу, стене или потолку
    if (props.face === 'floor') options.push({ ref: 'down', half: null, look: lookFor(facing) })
    else if (props.face === 'ceiling') options.push({ ref: 'up', half: null, look: lookFor(facing) })
    else options.push({ ref: OPPOSITE[facing], half: null })
  } else if (facing && isAttachedToFace(name)) {
    // Факелы на стене, лестницы, таблички на стене: опора — позади блока
    options.push({ ref: OPPOSITE[facing], half: null })
  } else if (name === 'hopper' && facing) {
    // Воронка смотрит в сторону блока, по которому кликнули
    options.push({ ref: facing === 'down' ? 'down' : facing, half: null })
  } else if (facing && DIRS[facing]) {
    // Остальные блоки с facing: печки, сундуки, поршни, раздатчики, тыквы...
    if (name === 'anvil' || /_anvil$/.test(name)) {
      look = lookFor(COUNTER_CLOCKWISE[facing] || 'north')
    } else if (facesLikeLook(name)) {
      look = lookFor(facing)
    } else {
      look = lookFor(OPPOSITE[facing]) // блок «смотрит» на игрока
    }
  }

  // Запасные варианты: любая соседняя опора (состояние может получиться другим)
  const used = new Set(options.map(o => o.ref))
  const preferred = options.length
  for (const ref of ALL_DIRS) {
    if (!used.has(ref)) options.push({ ref, half: null })
  }

  // Общий поворот применяется ко всем вариантам, где свой не задан
  for (const o of options) {
    if (o.look === undefined) o.look = look
  }

  return { options, preferred, double }
}

// Свойства, которые проверяем после установки
const CHECKED_PROPS = ['facing', 'half', 'axis', 'type', 'face']

// Сравнивает желаемые свойства с фактическими, возвращает список расхождений
function stateMismatch (wanted, actual) {
  const diffs = []
  if (!actual) return diffs
  for (const key of CHECKED_PROPS) {
    if (wanted[key] === undefined || actual[key] === undefined) continue
    if (String(wanted[key]) !== String(actual[key])) {
      diffs.push(`${key}: нужно ${wanted[key]}, получилось ${actual[key]}`)
    }
  }
  return diffs
}

module.exports = {
  DIRS,
  OPPOSITE,
  skipReason,
  itemNameForBlock,
  isInteractable,
  placementPlan,
  stateMismatch
}
