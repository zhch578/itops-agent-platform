import { lazy } from 'react';

const Scripts = lazy(() => import('./pages/Scripts'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const ConfigTemplates = lazy(() => import('./pages/ConfigTemplates'));
const ToolLinks = lazy(() => import('./pages/ToolLinks'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Tools = lazy(() => import('./pages/Tools'));

export const infraRoutes = [
  { path: 'scripts', element: Scripts },
  { path: 'audit', element: AuditLogs },
  { path: 'notifications', element: Notifications },
  { path: 'settings', element: Settings },
  { path: 'config-templates', element: ConfigTemplates },
  { path: 'tool-links', element: ToolLinks },
  { path: 'approvals', element: Approvals },
  { path: 'tools', element: Tools },
];
