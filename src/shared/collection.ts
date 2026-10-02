export const rarities = [
  "普通",
  "清新",
  "珍稀",
  "史诗",
  "传说",
  "典藏",
] as const;
export const rarityColors = [
  "#a9aaa1",
  "#82a886",
  "#76a3c2",
  "#a18bb7",
  "#c6a15a",
  "#ba6d64",
];
export const weights = [5000, 2800, 1400, 600, 180, 20];
export const salePrices = [1, 2, 4, 8, 20, 60];
export const catalog = [
  ["pebble", "听雨白石", "静静积累，每一步都算数"],
  ["shell", "拾光贝壳", "收好沿途的小小光亮"],
  ["sprout", "春生嫩芽", "日有所长"],
  ["mushroom", "森林小伞", "雨后总有新生"],
  ["crystal", "澄海晶簇", "澄澈而坚定"],
  ["bottle", "晴海漂流瓶", "把心愿送往远方"],
  ["moon", "月桂之约", "折桂有期"],
  ["star", "许愿星灯", "所愿皆有回响"],
  ["chest", "满载宝匣", "满载而归"],
  ["sun", "朝阳金轮", "前程似锦"],
  ["koi", "跃龙门锦鲤", "一跃龙门，顺利上岸"],
  ["scroll", "金榜题名卷", "金榜题名，得偿所愿"],
].map(([id, name, meaning], index) => ({
  id,
  name,
  meaning,
  rarity: Math.floor(index / 2),
  sellPoints: salePrices[Math.floor(index / 2)],
  model: `assets/Collection/${id}.glb`,
  thumbnail: `assets/Collection/${id}.svg`,
  assetVersion: 1,
}));
export type Collectible = {
  id: string;
  catalog_id: string;
  rarity_snapshot: number;
  sell_points_snapshot: number;
  state: "warehouse" | "display" | "sold";
  slot_index: number | null;
  tank_index: number | null;
  drop_event_id: number;
  created_at: string;
};
