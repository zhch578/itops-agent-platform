import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { LayoutGrid, ArrowUpRight } from 'lucide-react';
import DataRoom3D from '../components/DataRoom3D';

export default function DataRoom() {
  const navigate = useNavigate();

  return (
    <div className="relative w-full h-full overflow-hidden">
      <DataRoom3D />

      {/* 右上角管理入口 — 轻量不遮挡 */}
      <div className="absolute top-3 right-3 z-20">
        <Button
          type="primary"
          size="small"
          icon={<LayoutGrid size={12} />}
          className="flex items-center shadow-lg bg-gradient-to-r from-cyan-500 to-blue-600 border-0 hover:opacity-90 text-xs h-7"
          onClick={() => navigate('/dc-manage')}
        >
          数据中心管理
        </Button>
      </div>
    </div>
  );
}
