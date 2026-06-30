import { lazy } from 'react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Reports = lazy(() => import('./pages/Reports'));
const BigScreenDashboard = lazy(() => import('./pages/BigScreenDashboard'));
const CostAnalysis = lazy(() => import('./pages/CostAnalysis'));

export const monitorRoutes = [
  { path: 'dashboard', element: Dashboard },
  { path: 'reports', element: Reports },
  { path: 'big-screen', element: BigScreenDashboard },
  { path: 'cost-analysis', element: CostAnalysis },
];
