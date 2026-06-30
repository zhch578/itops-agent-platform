import { Router } from 'express';
import dcInfrastructureRoutes from '../../routes/dc';

const router = Router();

router.use('/dc', dcInfrastructureRoutes);
router.use('/dc-infrastructure', dcInfrastructureRoutes);

export default router;
