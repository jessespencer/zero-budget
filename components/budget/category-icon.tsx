import {
  Baby,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Camera,
  Car,
  CircleDollarSign,
  Coffee,
  CreditCard,
  Dog,
  Droplets,
  Dumbbell,
  Film,
  Fuel,
  Gift,
  GraduationCap,
  HandHeart,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Leaf,
  Music,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shield,
  Shirt,
  ShoppingCart,
  Smartphone,
  Tent,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { splitLeadingEmoji } from "@/lib/emoji";

export { splitLeadingEmoji };

// First match wins, so more specific words sit above broader ones
// ("car wash" before "car", "insurance" before "home").
const KEYWORD_ICONS: [RegExp, LucideIcon][] = [
  [/\binsurance\b/i, Shield],
  [/\b(gas|fuel)\b/i, Fuel],
  [/\b(car|auto|vehicle|truck|jeep|toyota|parking|registration|oil)\b/i, Car],
  [/\b(transit|train|uber|lyft|bus)\b/i, Bus],
  [/\b(motorcycle|bike|cycling)\b/i, Bike],
  [/\b(grocer|costco|supplies)/i, ShoppingCart],
  [/\b(coffee|cafe)\b/i, Coffee],
  [/\b(drinks?|bar|wine|beer)\b/i, Wine],
  [/\b(dining|restaurant|food|meat|lunch)\b/i, Utensils],
  [/\b(utilit|electric|xcel|power)/i, Zap],
  [/\bwater\b/i, Droplets],
  [/\b(phone|mobile)\b/i, Smartphone],
  [/\b(internet|wifi)\b/i, Wifi],
  [/\b(rent|mortgage|home|house|hoa|property)\b/i, House],
  [/\b(maintenance|repair|hvac|filters?)\b/i, Wrench],
  [/\b(garden|lawn|flowers?|plants?)\b/i, Leaf],
  [/\b(camping|outdoor|trails?)\b/i, Tent],
  [/\b(medical|health|doctor|dental|chiro|counsel)/i, HeartPulse],
  [/\b(pharmacy|medicine|supplements?)\b/i, Pill],
  [/\b(gym|fitness)\b/i, Dumbbell],
  [/\b(haircut|personal care|hygiene|salon)\b/i, Scissors],
  [/\b(cloth|apparel)/i, Shirt],
  [/\b(baby|diapers?|kids?|kiddos?|child)/i, Baby],
  [/\b(school|tuition|homeschool|education)\b/i, GraduationCap],
  [/\b(books?|toys?)\b/i, BookOpen],
  [/\b(pets?|dog|cat|vet)\b/i, Dog],
  [/\b(travel|vacation|flights?|trip)\b/i, Plane],
  [/\b(gifts?|birthdays?|christmas|holidays?|anniversary)\b/i, Gift],
  [/\b(photo|camera)/i, Camera],
  [/\b(music|spotify|splice|suno)\b/i, Music],
  [/\b(movies?|entertainment|netflix|streaming)\b/i, Film],
  [/\b(tech|computer|laptop|software|urls?|figma|dropbox|1password)/i, Laptop],
  [/\b(giving|tithe|generosity|charity|non-?profits?|donations?)\b/i, HandHeart],
  [/\b(tax|taxes)\b/i, Landmark],
  [/\b(emergency|savings?|fund)\b/i, PiggyBank],
  [/\b(invest|ira|401k|brokerage|roth)/i, TrendingUp],
  [/\b(debt|loan|card|freedom)\b/i, CreditCard],
  [/\b(work|business|reimburs)/i, Briefcase],
  [/\b(allowance|spending money)\b/i, Wallet],
  [/\b(bills?|fees?)\b/i, Receipt],
];

function iconForText(text: string): LucideIcon | null {
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(text)) return icon;
  }
  return null;
}

function iconForGroup(groupName: string): LucideIcon {
  if (/subscription/i.test(groupName)) return Repeat;
  return iconForText(groupName) ?? CircleDollarSign;
}

type CategoryIconProps = {
  name: string;
  groupName: string;
  className?: string;
};

/**
 * Avatar for a category in the simple budget view. Categories have no stored
 * icon, so it's derived: the name's own leading emoji wins, then a keyword
 * match on the name, then the group's icon.
 */
export function CategoryIcon({ name, groupName, className }: CategoryIconProps) {
  const { emoji, label } = splitLeadingEmoji(name);
  const Icon = emoji ? null : (iconForText(label) ?? iconForGroup(groupName));
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 h-10 w-10 rounded-full bg-accent/60 flex items-center justify-center text-foreground/70",
        className
      )}
    >
      {Icon ? (
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      ) : (
        <span className="text-[20px] leading-none">{emoji}</span>
      )}
    </div>
  );
}
