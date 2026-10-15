// One emoji "cluster" at the start of a name: a pictograph plus any variation
// selector / skin-tone modifier, chained by zero-width joiners (❤\uFE0F\u200D🩹, 🤦🏻\u200D♂\uFE0F).
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)*)\s*/u;

/** Split a leading emoji off a category name: "🍕 Dining out" → 🍕 + "Dining out". */
export function splitLeadingEmoji(name: string): { emoji: string | null; label: string } {
  const match = name.match(LEADING_EMOJI);
  if (!match) return { emoji: null, label: name };
  const label = name.slice(match[0].length).trim();
  // A name that is *only* an emoji keeps it as the label too.
  return { emoji: match[1], label: label || name };
}
