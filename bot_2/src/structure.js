// Работа с файлами структур (.nbt, формат структурного блока Minecraft).
// Файл сжат gzip; prismarine-nbt сам распознаёт и распаковывает его.

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const nbt = require('prismarine-nbt')

// Папка со структурами: bot_2/creating/bot_structures
const STRUCTURES_DIR = path.join(__dirname, '..', 'creating', 'bot_structures')

// Блоки, которые никогда не ставим
const SKIP_BLOCKS = new Set(['air', 'cave_air', 'void_air', 'structure_void'])

// Список .nbt файлов в папке (имена без пути)
function listStructures () {
  if (!fs.existsSync(STRUCTURES_DIR)) return []
  return fs.readdirSync(STRUCTURES_DIR)
    .filter(f => f.toLowerCase().endsWith('.nbt'))
    .sort()
}

// Находит файл по имени: можно писать с .nbt или без, регистр не важен
function findStructure (name) {
  const files = listStructures()
  const wanted = name.toLowerCase().replace(/\.nbt$/, '')
  return files.find(f => f.toLowerCase().replace(/\.nbt$/, '') === wanted) || null
}

// Убирает префикс "minecraft:" из имени блока
function shortName (name) {
  return String(name).replace(/^minecraft:/, '')
}

// Читает .nbt файл и возвращает:
// { file, size: {x,y,z}, blocks: [{ x, y, z, name, properties }] }
// Координаты блоков — относительные (от угла структуры).
async function loadStructure (fileName) {
  const filePath = path.join(STRUCTURES_DIR, fileName)
  let buffer = fs.readFileSync(filePath)

  // Файл структуры сжат gzip (сигнатура 1f 8b) — распаковываем
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    buffer = zlib.gunzipSync(buffer)
  }

  const { parsed } = await nbt.parse(buffer)
  const data = nbt.simplify(parsed)

  if (!data.size || !data.blocks) {
    throw new Error('в файле нет полей size/blocks — это не файл структурного блока')
  }

  // У некоторых структур (например, кораблей) вместо palette есть palettes — берём первую
  const palette = data.palette || (data.palettes && data.palettes[0])
  if (!palette) throw new Error('в файле нет палитры блоков (palette)')

  const blocks = []
  for (const b of data.blocks) {
    const state = palette[b.state]
    if (!state) continue
    const name = shortName(state.Name)
    if (SKIP_BLOCKS.has(name)) continue // air и structure_void пропускаем
    blocks.push({
      x: b.pos[0],
      y: b.pos[1],
      z: b.pos[2],
      name,
      properties: state.Properties || {}
    })
  }

  return {
    file: fileName,
    size: { x: data.size[0], y: data.size[1], z: data.size[2] },
    blocks
  }
}

module.exports = { STRUCTURES_DIR, listStructures, findStructure, loadStructure }
