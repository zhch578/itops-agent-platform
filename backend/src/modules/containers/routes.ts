import { Router } from 'express';
import containerRoutes from './routes/containerRoutes';
import dockerRoutes from './routes/dockerRoutes';
import imageRoutes from './routes/imageRoutes';
import virtualMachineRoutes from './routes/virtualMachineRoutes';
import vmManagementRoutes from './routes/vmManagementRoutes';
import volumeRoutes from './routes/volumeRoutes';
import registryRoutes from './routes/registryRoutes';
import vmMigrationRoutes from './routes/vmMigrationRoutes';

const router = Router();

router.use('/containers', containerRoutes);
router.use('/docker', dockerRoutes);
router.use('/images', imageRoutes);
router.use('/virtual-machines', virtualMachineRoutes);
router.use('/vm-management', vmManagementRoutes);
router.use('/volumes', volumeRoutes);
router.use('/registries', registryRoutes);
router.use('/vm-migrations', vmMigrationRoutes);

export default router;
