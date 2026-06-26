import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { LayoutGrid, ArrowUpRight } from 'lucide-react';

export default function DataRoom() {
  const navigate = useNavigate();

  return (
    <div className="relative w-full h-full overflow-hidden">
      <iframe
        src="/jifangdaping/index.html"
        className="w-full h-full border-0"
        title="机房数字孪生监控平台"
      />

      {/* 管理跳转悬浮入口 */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
        <Button
          type="primary"
          icon={<LayoutGrid size={14} />}
          className="flex items-center shadow-lg bg-gradient-to-r from-cyan-500 to-blue-600 border-0 hover:opacity-90"
          onClick={() => navigate('/dc-manage')}
        >
          数据中心管理
        </Button>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className="px-4 py-1.5 rounded-full bg-black/40 backdrop-blur border border-white/10 text-[11px] text-gray-400 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span>监控数据为<strong className="text-gray-300">真实+虚拟</strong>混合展示</span>
          <span className="text-gray-600">|</span>
          <span>点击右上角进入 <span className="text-cyan-400 cursor-pointer" onClick={() => navigate('/dc-manage')}>数据中心管理 <ArrowUpRight size={10} className="inline" /></span></span>
        </div>
      </div>
    </div>
  );
}
