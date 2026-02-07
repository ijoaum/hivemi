import {
  // Original 24
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
  Network,
  Globe,
  Server,
  Wrench,
  Target,
  Lightbulb,
  Package,
  Layers,
  GitBranch,
  Terminal,
  // New additions
  Hexagon,
  Brain,
  Cpu,
  Cloud,
  Lock,
  Eye,
  Bell,
  Mail,
  Calendar,
  Search,
  Settings,
  Heart,
  Star,
  Flag,
  Bookmark,
  Compass,
  Map,
  Anchor,
  Crown,
  Diamond,
  Award,
  Trophy,
  Gauge,
  Activity,
  Atom,
  Microscope,
  Telescope,
  Satellite,
  Radio,
  Wifi,
  Plug,
  Power,
  Briefcase,
  Building,
  Home,
  Hammer,
  Flame,
  Leaf,
  type LucideIcon,
} from "lucide-react";

// Map icon names to Lucide components
const iconMap: Record<string, LucideIcon> = {
  // Development & Tech
  "clipboard-list": ClipboardList,
  "blocks": Blocks,
  "palette": Palette,
  "cog": Cog,
  "flask-conical": FlaskConical,
  "rocket": Rocket,
  "sparkles": Sparkles,
  "bar-chart-3": BarChart3,
  "bot": Bot,
  "code": Code,
  "database": Database,
  "terminal": Terminal,
  "git-branch": GitBranch,
  "cpu": Cpu,
  "server": Server,
  "cloud": Cloud,
  "plug": Plug,
  "settings": Settings,

  // People & Roles
  "user": User,
  "briefcase": Briefcase,
  "crown": Crown,
  "award": Award,
  "trophy": Trophy,
  "star": Star,

  // Security & Access
  "shield": Shield,
  "lock": Lock,
  "eye": Eye,
  "power": Power,

  // Communication
  "bell": Bell,
  "mail": Mail,
  "radio": Radio,
  "wifi": Wifi,

  // Science & Analysis
  "brain": Brain,
  "atom": Atom,
  "microscope": Microscope,
  "telescope": Telescope,
  "satellite": Satellite,
  "lightbulb": Lightbulb,
  "activity": Activity,
  "gauge": Gauge,

  // Navigation & Discovery
  "globe": Globe,
  "network": Network,
  "compass": Compass,
  "map": Map,
  "anchor": Anchor,
  "target": Target,
  "search": Search,
  "flag": Flag,
  "bookmark": Bookmark,

  // Infrastructure & Building
  "wrench": Wrench,
  "hammer": Hammer,
  "building": Building,
  "home": Home,
  "package": Package,
  "layers": Layers,

  // Nature & Energy
  "zap": Zap,
  "flame": Flame,
  "leaf": Leaf,
  "diamond": Diamond,
  "hexagon": Hexagon,

  // Misc
  "heart": Heart,
  "calendar": Calendar,
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
