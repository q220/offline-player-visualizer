// Block name -> [R, G, B, A] color mapping based on Minecraft's map colors
// This is a comprehensive but not exhaustive list. Unknown blocks get a default color.
type RGBA = [number, number, number, number];

const BLOCK_COLORS: Record<string, RGBA> = {
  // Grass & dirt
  grass_block: [127, 178, 56, 255],
  short_grass: [127, 178, 56, 255],
  tall_grass: [127, 178, 56, 255],
  fern: [127, 178, 56, 255],
  large_fern: [127, 178, 56, 255],
  dirt: [151, 109, 77, 255],
  coarse_dirt: [151, 109, 77, 255],
  rooted_dirt: [151, 109, 77, 255],
  dirt_path: [173, 148, 95, 255],
  farmland: [143, 103, 72, 255],
  mud: [92, 73, 57, 255],
  muddy_mangrove_roots: [92, 73, 57, 255],
  podzol: [112, 87, 57, 255],
  mycelium: [127, 112, 120, 255],

  // Stone types
  stone: [112, 112, 112, 255],
  cobblestone: [112, 112, 112, 255],
  mossy_cobblestone: [104, 121, 89, 255],
  smooth_stone: [158, 158, 158, 255],
  granite: [153, 114, 99, 255],
  polished_granite: [153, 114, 99, 255],
  diorite: [189, 186, 183, 255],
  polished_diorite: [189, 186, 183, 255],
  andesite: [136, 136, 136, 255],
  polished_andesite: [136, 136, 136, 255],
  bedrock: [52, 52, 52, 255],
  gravel: [136, 126, 126, 255],
  calcite: [223, 224, 220, 255],
  tuff: [108, 109, 102, 255],
  dripstone_block: [134, 107, 92, 255],

  // Deepslate
  deepslate: [100, 100, 100, 255],
  cobbled_deepslate: [100, 100, 100, 255],
  polished_deepslate: [100, 100, 100, 255],
  deepslate_bricks: [100, 100, 100, 255],
  deepslate_tiles: [100, 100, 100, 255],

  // Sand
  sand: [219, 207, 163, 255],
  sandstone: [219, 207, 163, 255],
  smooth_sandstone: [219, 207, 163, 255],
  cut_sandstone: [219, 207, 163, 255],
  chiseled_sandstone: [219, 207, 163, 255],
  red_sand: [190, 102, 33, 255],
  red_sandstone: [190, 102, 33, 255],

  // Wood types
  oak_log: [143, 119, 72, 255],
  oak_wood: [143, 119, 72, 255],
  oak_planks: [162, 130, 78, 255],
  spruce_log: [80, 56, 30, 255],
  spruce_wood: [80, 56, 30, 255],
  spruce_planks: [115, 85, 49, 255],
  birch_log: [207, 203, 183, 255],
  birch_wood: [207, 203, 183, 255],
  birch_planks: [196, 179, 123, 255],
  jungle_log: [87, 67, 27, 255],
  jungle_wood: [87, 67, 27, 255],
  jungle_planks: [160, 115, 80, 255],
  acacia_log: [103, 96, 86, 255],
  acacia_wood: [103, 96, 86, 255],
  acacia_planks: [169, 92, 51, 255],
  dark_oak_log: [60, 46, 26, 255],
  dark_oak_wood: [60, 46, 26, 255],
  dark_oak_planks: [67, 43, 20, 255],
  mangrove_log: [84, 56, 40, 255],
  mangrove_wood: [84, 56, 40, 255],
  mangrove_planks: [118, 54, 48, 255],
  cherry_log: [53, 29, 37, 255],
  cherry_wood: [53, 29, 37, 255],
  cherry_planks: [226, 178, 172, 255],
  crimson_stem: [101, 48, 75, 255],
  crimson_hyphae: [101, 48, 75, 255],
  crimson_planks: [101, 48, 75, 255],
  warped_stem: [22, 124, 113, 255],
  warped_hyphae: [22, 124, 113, 255],
  warped_planks: [22, 124, 113, 255],
  bamboo_block: [155, 153, 62, 255],
  bamboo_planks: [195, 175, 89, 255],
  stripped_oak_log: [162, 130, 78, 255],
  stripped_spruce_log: [115, 85, 49, 255],
  stripped_birch_log: [196, 179, 123, 255],
  stripped_jungle_log: [160, 115, 80, 255],
  stripped_acacia_log: [169, 92, 51, 255],
  stripped_dark_oak_log: [67, 43, 20, 255],
  stripped_mangrove_log: [118, 54, 48, 255],
  stripped_cherry_log: [215, 145, 148, 255],

  // Leaves
  oak_leaves: [59, 122, 30, 255],
  spruce_leaves: [59, 98, 59, 255],
  birch_leaves: [72, 128, 42, 255],
  jungle_leaves: [42, 128, 42, 255],
  acacia_leaves: [42, 128, 42, 255],
  dark_oak_leaves: [42, 100, 42, 255],
  mangrove_leaves: [42, 128, 42, 255],
  cherry_leaves: [233, 175, 190, 255],
  azalea_leaves: [59, 122, 30, 255],
  flowering_azalea_leaves: [59, 122, 30, 255],

  // Water & ice
  water: [64, 64, 255, 200],
  lava: [255, 100, 0, 255],
  ice: [160, 160, 255, 230],
  packed_ice: [141, 180, 224, 255],
  blue_ice: [116, 167, 253, 255],
  frosted_ice: [141, 180, 224, 200],
  snow_block: [255, 255, 255, 255],
  snow: [255, 255, 255, 255],
  powder_snow: [245, 245, 255, 255],

  // Ores
  coal_ore: [112, 112, 112, 255],
  iron_ore: [112, 112, 112, 255],
  gold_ore: [112, 112, 112, 255],
  diamond_ore: [112, 112, 112, 255],
  emerald_ore: [112, 112, 112, 255],
  lapis_ore: [112, 112, 112, 255],
  redstone_ore: [112, 112, 112, 255],
  copper_ore: [112, 112, 112, 255],
  deepslate_coal_ore: [100, 100, 100, 255],
  deepslate_iron_ore: [100, 100, 100, 255],
  deepslate_gold_ore: [100, 100, 100, 255],
  deepslate_diamond_ore: [100, 100, 100, 255],
  deepslate_emerald_ore: [100, 100, 100, 255],
  deepslate_lapis_ore: [100, 100, 100, 255],
  deepslate_redstone_ore: [100, 100, 100, 255],
  deepslate_copper_ore: [100, 100, 100, 255],
  nether_gold_ore: [116, 45, 45, 255],
  nether_quartz_ore: [116, 45, 45, 255],
  ancient_debris: [97, 67, 57, 255],

  // Mineral blocks
  iron_block: [167, 167, 167, 255],
  gold_block: [249, 236, 79, 255],
  diamond_block: [98, 237, 228, 255],
  emerald_block: [0, 217, 58, 255],
  lapis_block: [37, 62, 143, 255],
  redstone_block: [170, 25, 25, 255],
  coal_block: [16, 15, 15, 255],
  copper_block: [192, 107, 79, 255],
  netherite_block: [66, 61, 63, 255],
  amethyst_block: [131, 99, 177, 255],
  raw_iron_block: [167, 137, 103, 255],
  raw_gold_block: [220, 168, 45, 255],
  raw_copper_block: [154, 105, 75, 255],

  // Nether blocks
  netherrack: [116, 45, 45, 255],
  nether_bricks: [44, 22, 26, 255],
  soul_sand: [81, 62, 50, 255],
  soul_soil: [75, 57, 46, 255],
  basalt: [72, 72, 78, 255],
  smooth_basalt: [72, 72, 78, 255],
  polished_basalt: [72, 72, 78, 255],
  blackstone: [42, 36, 41, 255],
  polished_blackstone: [42, 36, 41, 255],
  polished_blackstone_bricks: [48, 42, 47, 255],
  glowstone: [255, 218, 103, 255],
  magma_block: [130, 62, 10, 255],
  nether_wart_block: [163, 24, 24, 255],
  warped_wart_block: [22, 124, 113, 255],
  crimson_nylium: [163, 24, 24, 255],
  warped_nylium: [22, 124, 113, 255],
  shroomlight: [240, 146, 70, 255],
  crying_obsidian: [32, 10, 60, 255],
  obsidian: [15, 10, 24, 255],

  // End blocks
  end_stone: [219, 219, 163, 255],
  end_stone_bricks: [219, 219, 163, 255],
  purpur_block: [169, 125, 169, 255],
  purpur_pillar: [169, 125, 169, 255],
  chorus_plant: [90, 46, 90, 255],
  chorus_flower: [140, 96, 140, 255],

  // Terracotta
  terracotta: [152, 94, 67, 255],
  white_terracotta: [210, 178, 161, 255],
  orange_terracotta: [162, 84, 38, 255],
  magenta_terracotta: [150, 88, 109, 255],
  light_blue_terracotta: [114, 108, 138, 255],
  yellow_terracotta: [186, 133, 36, 255],
  lime_terracotta: [103, 118, 53, 255],
  pink_terracotta: [162, 78, 79, 255],
  gray_terracotta: [58, 42, 36, 255],
  light_gray_terracotta: [135, 107, 98, 255],
  cyan_terracotta: [87, 92, 92, 255],
  purple_terracotta: [118, 70, 86, 255],
  blue_terracotta: [74, 60, 91, 255],
  brown_terracotta: [77, 51, 36, 255],
  green_terracotta: [76, 83, 42, 255],
  red_terracotta: [143, 61, 47, 255],
  black_terracotta: [37, 23, 16, 255],

  // Glazed terracotta
  white_glazed_terracotta: [188, 212, 202, 255],
  orange_glazed_terracotta: [22, 154, 147, 255],
  magenta_glazed_terracotta: [213, 103, 189, 255],
  light_blue_glazed_terracotta: [93, 167, 200, 255],
  yellow_glazed_terracotta: [234, 199, 55, 255],
  lime_glazed_terracotta: [168, 200, 43, 255],
  pink_glazed_terracotta: [235, 154, 181, 255],
  gray_glazed_terracotta: [85, 111, 118, 255],
  light_gray_glazed_terracotta: [133, 167, 150, 255],
  cyan_glazed_terracotta: [38, 145, 151, 255],
  purple_glazed_terracotta: [110, 47, 150, 255],
  blue_glazed_terracotta: [47, 68, 152, 255],
  brown_glazed_terracotta: [120, 106, 85, 255],
  green_glazed_terracotta: [117, 142, 67, 255],
  red_glazed_terracotta: [183, 62, 53, 255],
  black_glazed_terracotta: [67, 30, 32, 255],

  // Concrete
  white_concrete: [207, 213, 214, 255],
  orange_concrete: [224, 97, 1, 255],
  magenta_concrete: [169, 48, 159, 255],
  light_blue_concrete: [36, 137, 199, 255],
  yellow_concrete: [241, 175, 21, 255],
  lime_concrete: [94, 169, 25, 255],
  pink_concrete: [214, 101, 143, 255],
  gray_concrete: [55, 58, 62, 255],
  light_gray_concrete: [125, 125, 115, 255],
  cyan_concrete: [21, 119, 136, 255],
  purple_concrete: [100, 32, 156, 255],
  blue_concrete: [45, 47, 143, 255],
  brown_concrete: [96, 60, 32, 255],
  green_concrete: [73, 91, 36, 255],
  red_concrete: [142, 33, 33, 255],
  black_concrete: [8, 10, 15, 255],

  // Wool
  white_wool: [234, 236, 236, 255],
  orange_wool: [241, 118, 20, 255],
  magenta_wool: [189, 68, 179, 255],
  light_blue_wool: [58, 175, 217, 255],
  yellow_wool: [249, 198, 40, 255],
  lime_wool: [112, 185, 26, 255],
  pink_wool: [238, 141, 172, 255],
  gray_wool: [63, 68, 72, 255],
  light_gray_wool: [142, 142, 135, 255],
  cyan_wool: [21, 138, 145, 255],
  purple_wool: [122, 42, 173, 255],
  blue_wool: [53, 57, 157, 255],
  brown_wool: [114, 72, 41, 255],
  green_wool: [85, 110, 27, 255],
  red_wool: [162, 39, 35, 255],
  black_wool: [21, 21, 26, 255],

  // Glass (semi-transparent)
  glass: [192, 216, 228, 100],
  white_stained_glass: [255, 255, 255, 100],
  orange_stained_glass: [216, 127, 51, 100],
  magenta_stained_glass: [178, 76, 216, 100],
  light_blue_stained_glass: [102, 153, 216, 100],
  yellow_stained_glass: [229, 229, 51, 100],
  lime_stained_glass: [127, 204, 25, 100],
  pink_stained_glass: [242, 127, 165, 100],
  gray_stained_glass: [76, 76, 76, 100],
  light_gray_stained_glass: [153, 153, 153, 100],
  cyan_stained_glass: [76, 127, 153, 100],
  purple_stained_glass: [127, 63, 178, 100],
  blue_stained_glass: [51, 76, 178, 100],
  brown_stained_glass: [102, 76, 51, 100],
  green_stained_glass: [102, 127, 51, 100],
  red_stained_glass: [153, 51, 51, 100],
  black_stained_glass: [25, 25, 25, 100],

  // Misc natural
  clay: [160, 166, 179, 255],
  moss_block: [89, 132, 49, 255],
  sculk: [13, 31, 38, 255],
  sculk_catalyst: [13, 31, 38, 255],
  sculk_sensor: [13, 31, 38, 255],
  sculk_shrieker: [13, 31, 38, 255],
  sculk_vein: [13, 31, 38, 200],
  dried_kelp_block: [45, 56, 30, 255],
  hay_block: [166, 149, 12, 255],
  melon: [111, 144, 30, 255],
  pumpkin: [206, 127, 32, 255],
  jack_o_lantern: [206, 127, 32, 255],
  cactus: [0, 124, 0, 255],
  sugar_cane: [139, 195, 74, 200],
  bamboo: [97, 140, 30, 200],

  // Flowers & plants
  dandelion: [127, 178, 56, 255],
  poppy: [127, 178, 56, 255],
  blue_orchid: [127, 178, 56, 255],
  allium: [127, 178, 56, 255],
  azure_bluet: [127, 178, 56, 255],
  red_tulip: [127, 178, 56, 255],
  orange_tulip: [127, 178, 56, 255],
  white_tulip: [127, 178, 56, 255],
  pink_tulip: [127, 178, 56, 255],
  oxeye_daisy: [127, 178, 56, 255],
  cornflower: [127, 178, 56, 255],
  lily_of_the_valley: [127, 178, 56, 255],
  sunflower: [127, 178, 56, 255],
  lilac: [127, 178, 56, 255],
  rose_bush: [127, 178, 56, 255],
  peony: [127, 178, 56, 255],
  torchflower: [127, 178, 56, 255],
  pitcher_plant: [127, 178, 56, 255],
  lily_pad: [0, 124, 0, 200],
  vine: [59, 122, 30, 200],
  glow_lichen: [127, 167, 150, 200],

  // Coral blocks
  tube_coral_block: [49, 88, 199, 255],
  brain_coral_block: [208, 95, 158, 255],
  bubble_coral_block: [165, 26, 162, 255],
  fire_coral_block: [164, 35, 37, 255],
  horn_coral_block: [216, 199, 66, 255],
  dead_tube_coral_block: [130, 124, 119, 255],
  dead_brain_coral_block: [130, 124, 119, 255],
  dead_bubble_coral_block: [130, 124, 119, 255],
  dead_fire_coral_block: [130, 124, 119, 255],
  dead_horn_coral_block: [130, 124, 119, 255],

  // Building blocks
  bricks: [150, 97, 83, 255],
  stone_bricks: [122, 122, 122, 255],
  mossy_stone_bricks: [115, 125, 100, 255],
  cracked_stone_bricks: [118, 118, 118, 255],
  chiseled_stone_bricks: [122, 122, 122, 255],
  prismarine: [99, 171, 158, 255],
  prismarine_bricks: [99, 171, 158, 255],
  dark_prismarine: [51, 91, 75, 255],
  sea_lantern: [172, 199, 190, 255],
  quartz_block: [236, 233, 226, 255],
  smooth_quartz: [236, 233, 226, 255],
  quartz_bricks: [236, 233, 226, 255],
  quartz_pillar: [236, 233, 226, 255],
  chiseled_quartz_block: [236, 233, 226, 255],

  // Rails & redstone
  rail: [127, 178, 56, 100],
  powered_rail: [127, 178, 56, 100],
  detector_rail: [127, 178, 56, 100],
  activator_rail: [127, 178, 56, 100],
  redstone_wire: [170, 25, 25, 100],
  torch: [0, 0, 0, 0],
  wall_torch: [0, 0, 0, 0],
  redstone_torch: [0, 0, 0, 0],

  // Misc
  bookshelf: [162, 130, 78, 255],
  chiseled_bookshelf: [162, 130, 78, 255],
  crafting_table: [162, 130, 78, 255],
  furnace: [112, 112, 112, 255],
  blast_furnace: [112, 112, 112, 255],
  smoker: [112, 112, 112, 255],
  chest: [143, 119, 72, 255],
  trapped_chest: [143, 119, 72, 255],
  ender_chest: [15, 10, 24, 255],
  barrel: [143, 119, 72, 255],
  anvil: [112, 112, 112, 255],
  chipped_anvil: [112, 112, 112, 255],
  damaged_anvil: [112, 112, 112, 255],
  enchanting_table: [15, 10, 24, 255],
  brewing_stand: [143, 119, 72, 100],
  cauldron: [112, 112, 112, 255],
  bell: [249, 236, 79, 255],
  lectern: [162, 130, 78, 255],
  grindstone: [112, 112, 112, 255],
  stonecutter: [112, 112, 112, 255],
  loom: [162, 130, 78, 255],
  cartography_table: [162, 130, 78, 255],
  fletching_table: [162, 130, 78, 255],
  smithing_table: [162, 130, 78, 255],
  composter: [162, 130, 78, 255],
  bee_nest: [219, 176, 73, 255],
  beehive: [181, 153, 95, 255],
  spawner: [37, 51, 62, 200],
  sponge: [196, 192, 74, 255],
  wet_sponge: [171, 181, 70, 255],
  tnt: [219, 68, 53, 255],
  slime_block: [114, 190, 77, 180],
  honey_block: [235, 150, 42, 200],
  honeycomb_block: [229, 148, 29, 255],
  note_block: [143, 119, 72, 255],
  jukebox: [143, 119, 72, 255],
  ladder: [0, 0, 0, 0],
  scaffolding: [155, 153, 62, 100],
  cobweb: [229, 229, 229, 100],

  // Beds (show as colored)
  white_bed: [234, 236, 236, 255],
  red_bed: [162, 39, 35, 255],

  // Carpets
  white_carpet: [234, 236, 236, 255],
  orange_carpet: [241, 118, 20, 255],
  magenta_carpet: [189, 68, 179, 255],
  light_blue_carpet: [58, 175, 217, 255],
  yellow_carpet: [249, 198, 40, 255],
  lime_carpet: [112, 185, 26, 255],
  pink_carpet: [238, 141, 172, 255],
  gray_carpet: [63, 68, 72, 255],
  light_gray_carpet: [142, 142, 135, 255],
  cyan_carpet: [21, 138, 145, 255],
  purple_carpet: [122, 42, 173, 255],
  blue_carpet: [53, 57, 157, 255],
  brown_carpet: [114, 72, 41, 255],
  green_carpet: [85, 110, 27, 255],
  red_carpet: [162, 39, 35, 255],
  black_carpet: [21, 21, 26, 255],
  moss_carpet: [89, 132, 49, 255],

  // Copper variants
  exposed_copper: [154, 121, 90, 255],
  weathered_copper: [109, 145, 107, 255],
  oxidized_copper: [82, 162, 132, 255],
  waxed_copper_block: [192, 107, 79, 255],
  cut_copper: [192, 107, 79, 255],
  exposed_cut_copper: [154, 121, 90, 255],
  weathered_cut_copper: [109, 145, 107, 255],
  oxidized_cut_copper: [82, 162, 132, 255],
};

const DEFAULT_COLOR: RGBA = [180, 180, 180, 255];

// Cache for fast lookups (blocks with prefixes like stairs, slabs, walls, etc.)
const colorCache = new Map<string, RGBA>();

export function getBlockColor(blockName: string): RGBA {
  const cached = colorCache.get(blockName);
  if (cached) return cached;

  // Direct lookup
  let color = BLOCK_COLORS[blockName];
  if (color) {
    colorCache.set(blockName, color);
    return color;
  }

  // Try stripping common suffixes (stairs, slab, wall, fence, etc.)
  const suffixes = [
    '_stairs',
    '_slab',
    '_wall',
    '_fence',
    '_fence_gate',
    '_door',
    '_trapdoor',
    '_button',
    '_pressure_plate',
    '_sign',
    '_wall_sign',
    '_hanging_sign',
    '_wall_hanging_sign',
  ];

  for (const suffix of suffixes) {
    if (blockName.endsWith(suffix)) {
      const base = blockName.slice(0, -suffix.length);
      // Try base + common block forms
      color =
        BLOCK_COLORS[base] ||
        BLOCK_COLORS[base + '_block'] ||
        BLOCK_COLORS[base + '_planks'] ||
        BLOCK_COLORS[base + 's']; // e.g., brick -> bricks
      if (color) {
        colorCache.set(blockName, color);
        return color;
      }
    }
  }

  // Transparent blocks that shouldn't show
  const transparent = [
    'air',
    'cave_air',
    'void_air',
    'barrier',
    'light',
    'structure_void',
  ];
  if (transparent.includes(blockName)) {
    const c: RGBA = [0, 0, 0, 0];
    colorCache.set(blockName, c);
    return c;
  }

  colorCache.set(blockName, DEFAULT_COLOR);
  return DEFAULT_COLOR;
}
