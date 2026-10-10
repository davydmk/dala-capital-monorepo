import {
  Banknote,
  Landmark,
  Briefcase,
  Building2,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/lib/types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Показывать в нижней панели на телефоне. */
  primary?: boolean;
}

/** Меню кабинета. Первые четыре пункта с `primary` попадают в нижнюю панель. */
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  INVESTOR: [
    {
      href: '/investor',
      label: 'Дашборд',
      icon: LayoutDashboard,
      primary: true,
    },
    {
      href: '/investor/campaigns',
      label: 'Кампании',
      icon: Briefcase,
      primary: true,
    },
    {
      href: '/investor/portfolio',
      label: 'Портфель',
      icon: Wallet,
      primary: true,
    },
    {
      href: '/investor/profile',
      label: 'Профиль',
      icon: UserRound,
      primary: true,
    },
    { href: '/investor/bonds', label: 'Мои бумаги', icon: Landmark },
  ],
  BORROWER: [
    {
      href: '/borrower',
      label: 'Дашборд',
      icon: LayoutDashboard,
      primary: true,
    },
    {
      href: '/borrower/loan',
      label: 'Мой займ',
      icon: Briefcase,
      primary: true,
    },
    { href: '/borrower/pay', label: 'Оплатить', icon: Banknote, primary: true },
    {
      href: '/borrower/profile',
      label: 'Профиль',
      icon: UserRound,
      primary: true,
    },
  ],
  ADMIN: [
    { href: '/admin', label: 'Дашборд', icon: LayoutDashboard, primary: true },
    {
      href: '/admin/campaigns',
      label: 'Кампании',
      icon: Briefcase,
      primary: true,
    },
    {
      href: '/admin/borrowers',
      label: 'Заёмщики',
      icon: Building2,
      primary: true,
    },
    {
      href: '/admin/investors',
      label: 'Инвесторы',
      icon: Users,
      primary: true,
    },
    { href: '/admin/bonds', label: 'Облигации', icon: Landmark },
    { href: '/admin/settings', label: 'Настройки', icon: Settings },
  ],
};
