import { Router } from 'express';
import reportRoutes from './routes/reportRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import monitorRoutes from './routes/monitorRoutes';
import costAnalysisRoutes from './routes/costAnalysisRoutes';

const router = Router();

router.use('/reports', reportRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/docker-monitor', monitorRoutes);
router.use('/cost-analysis', costAnalysisRoutes);

export default router;
