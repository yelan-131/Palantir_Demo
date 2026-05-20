import { create } from 'zustand';

interface UserInfo {
  id: number;
  username: string;
  display_name: string;
  email: string;
  is_admin: boolean;
  roles: { name: string; label: string }[];
}

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
  restore: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  login: (token, user) => {
    localStorage.setItem('mf_token', token);
    localStorage.setItem('mf_user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('mf_token');
    localStorage.removeItem('mf_user');
    set({ token: null, user: null, isAuthenticated: false });
  },

  restore: () => {
    const token = localStorage.getItem('mf_token');
    const userStr = localStorage.getItem('mf_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ token, user, isAuthenticated: true });
      } catch {
        set({ token: null, user: null, isAuthenticated: false });
      }
    }
  },
}));

// Permission helpers
export function hasRole(user: UserInfo | null, roleName: string): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  return user.roles.some((r) => r.name === roleName);
}

export function isAdmin(user: UserInfo | null): boolean {
  return user?.is_admin ?? false;
}

export function getVisibleMenus(user: UserInfo | null) {
  const adminOnly = new Set(['system-admin']);
  const techMenus = new Set(['data-sources', 'ontology', 'graph', 'pipeline']);

  return (menu: { key: string }) => {
    if (!user) return false;
    if (user.is_admin) return true;
    if (adminOnly.has(menu.key)) return false;
    if (techMenus.has(menu.key) && !user.roles.some((r) => r.name === 'admin')) return false;
    return true;
  };
}

export function getAdminMenus(user: UserInfo | null) {
  if (!user?.is_admin) return [];
  return [
    { key: '/workflow', label: '审批流程设计' },
    { key: '/pipeline', label: '数据管线' },
    { key: '/data-sources', label: '数据源管理' },
    { key: '/ontology', label: '本体建模' },
    { key: '/graph', label: '关系图谱' },
    { key: '/system-admin', label: '系统管理' },
  ];
}
