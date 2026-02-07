import {
  ClipboardList,
  Blocks,
  Palette,
  Cog,
  FlaskConical,
  Rocket,
  Sparkles,
  BarChart3,
  Bot,
  User,
  Code,
  Database,
  Shield,
  Zap,
  type LucideIcon,
} from "lucide-react";

// Map icon names to Lucide components
const iconMap: Record<string, LucideIcon> = {
  "clipboard-list": ClipboardList,
  "blocks": Blocks,
  "palette": Palette,
  "cog": Cog,
  "flask-conical": FlaskConical,
  "rocket": Rocket,
  "sparkles": Sparkles,
  "bar-chart-3": BarChart3,
  "bot": Bot,
  "user": User,
  "code": Code,
  "database": Database,
  "shield": Shield,
  "zap": Zap,
};

interface RoleIconProps {
  icon: string;
  className?: string;
}

export function RoleIcon({ icon, className = "w-6 h-6" }: RoleIconProps) {
  const IconComponent = iconMap[icon] || Bot;
  return <IconComponent className={className} />;
}

export { iconMap };
